import path from "node:path";
import sharp from "sharp";
import type { JobMeta, ProcessParams, ResultImage } from "@/lib/types";
import { ApiError, CancelledError } from "@/lib/types";
import { ensureDir } from "./config";
import { streamSampledFrames } from "./ffmpeg";

/**
 * Sheet-music line extraction pipeline.
 *
 * This is a faithful TypeScript port of the original Python/OpenCV script:
 *   sample every Nth frame → crop → (optionally) Otsu-binarize → group by
 *   template similarity → bitwise-AND each group → one PNG per unique line.
 *
 * Differences (documented, intentional):
 *  - Similarity uses normalized cross-correlation on a small down-sampled
 *    descriptor grid instead of full-frame cv2.matchTemplate. Metric is the
 *    same (TM_CCOEFF_NORMED equivalent), but ~100x cheaper per comparison.
 *  - In B&W mode, duplicate merging uses a running AND-accumulator, which is
 *    mathematically identical to merging the whole group at the end
 *    (bitwise AND is associative) but uses O(1) memory per group.
 *  - Near-blank frames (constant image → undefined NCC) are skipped.
 */

const DESC_W = 160; // descriptor grid width (height derived from crop aspect)

export interface ExtractCallbacks {
  log(msg: string): void;
  progress(percent: number, framesSampled: number, linesFound: number): void;
  shouldStop(): boolean;
  onChild?(kill: () => void): void;
}

export interface ExtractOutput {
  images: ResultImage[];
  framesSampled: number;
  elapsedMs: number;
}

// --- numeric kernels ------------------------------------------------------

/** Convert rgb24 frame to grayscale in-place destination buffer. */
function rgbToGray(src: Buffer, dst: Uint8Array): void {
  for (let i = 0, j = 0; i < dst.length; i++, j += 3) {
    // integer approximation of luma coefficients
    dst[i] = (src[j] * 77 + src[j + 1] * 150 + src[j + 2] * 29) >> 8;
  }
}

/** Otsu's method — optimal global threshold from the gray histogram. */
function otsuThreshold(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      threshold = t;
    }
  }
  return threshold;
}

/** In-place binarization: > t → 255, else 0 (matches cv2.THRESH_BINARY). */
function binarize(gray: Uint8Array, t: number): void {
  const th = Math.max(0, Math.min(255, t));
  for (let i = 0; i < gray.length; i++) gray[i] = gray[i] > th ? 255 : 0;
}

/**
 * Down-sampled descriptor on a DESC_W x DESC_H grid, then zero-mean/
 * unit-norm normalized. Returns null for near-blank frames (NCC undefined).
 */
function normalizeDescriptor(vec: Float32Array): Float32Array | null {
  const n = vec.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += vec[i];
  mean /= n;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = vec[i] - mean;
    vec[i] = d;
    sumSq += d * d;
  }
  const norm = Math.sqrt(sumSq);
  // per-pixel standard deviation — near-blank (constant) frames carry no
  // usable structure, and NCC is undefined for them anyway
  if (norm / Math.sqrt(n) < 0.012) return null;
  for (let i = 0; i < n; i++) vec[i] /= norm;
  return vec;
}

function descriptorFromGray(
  gray: Uint8Array,
  w: number,
  h: number,
  dw: number,
  dh: number,
): Float32Array | null {
  const vec = new Float32Array(dw * dh);
  for (let gy = 0; gy < dh; gy++) {
    const sy = Math.min(h - 1, Math.floor(((gy + 0.5) / dh) * h));
    const rowOff = gy * dw;
    const srcRow = sy * w;
    for (let gx = 0; gx < dw; gx++) {
      const sx = Math.min(w - 1, Math.floor(((gx + 0.5) / dw) * w));
      vec[rowOff + gx] = gray[srcRow + sx] / 255;
    }
  }
  return normalizeDescriptor(vec);
}

function descriptorFromRgb(
  rgb: Buffer,
  w: number,
  h: number,
  dw: number,
  dh: number,
): Float32Array | null {
  const vec = new Float32Array(dw * dh);
  for (let gy = 0; gy < dh; gy++) {
    const sy = Math.min(h - 1, Math.floor(((gy + 0.5) / dh) * h));
    const rowOff = gy * dw;
    const srcRow = sy * w * 3;
    for (let gx = 0; gx < dw; gx++) {
      const sx = Math.min(w - 1, Math.floor(((gx + 0.5) / dw) * w));
      const o = srcRow + sx * 3;
      vec[rowOff + gx] =
        (0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2]) / 255;
    }
  }
  return normalizeDescriptor(vec);
}

/** Per-row prefix sums of squares: sqPrefix[r] = Σ desc[row<r]². */
function rowSqPrefix(desc: Float32Array, w: number, dh: number): Float64Array {
  const prefix = new Float64Array(dh + 1);
  for (let gy = 0; gy < dh; gy++) {
    let s = 0;
    const off = gy * w;
    for (let gx = 0; gx < w; gx++) {
      const v = desc[off + gx];
      s += v * v;
    }
    prefix[gy + 1] = prefix[gy] + s;
  }
  return prefix;
}

/**
 * Vertical-shift-tolerant NCC. Scrolling notation drifts a pixel or two
 * between frames; a position-sensitive NCC would treat each drifted frame as
 * a brand-new line (the "300+ duplicates" failure). We compare `b` against
 * `a` at every whole-descriptor-row offset in [-maxRows, +maxRows] and keep
 * the best score, renormalizing over the overlapping rows so the result stays
 * on the same scale as the plain NCC threshold.
 *
 * Returns both the best match score and the shift offset `s` that achieved it.
 */
function nccBestShift(
  a: Float32Array,
  aSq: Float64Array,
  b: Float32Array,
  bSq: Float64Array,
  w: number,
  dh: number,
  maxRows: number,
): { score: number; shift: number } {
  let best = -Infinity;
  let bestShift = 0;
  for (let s = -maxRows; s <= maxRows; s++) {
    const g0 = Math.max(0, -s);
    const g1 = Math.min(dh, dh - s);
    if (g1 <= g0) continue;
    const normA = Math.sqrt(aSq[g1] - aSq[g0]);
    const normB = Math.sqrt(bSq[g1 + s] - bSq[g0 + s]);
    if (normA < 1e-9 || normB < 1e-9) continue;
    let dot = 0;
    for (let gy = g0; gy < g1; gy++) {
      const offA = gy * w;
      const offB = (gy + s) * w;
      for (let gx = 0; gx < w; gx++) dot += a[offA + gx] * b[offB + gx];
    }
    const score = dot / (normA * normB);
    if (score > best) {
      best = score;
      bestShift = s;
    }
  }
  return { score: best, shift: bestShift };
}

interface Group {
  rep: Float32Array;
  /** Per-row squared-norm prefix of `rep`, for fast shift-tolerant NCC. */
  sqPrefix: Float64Array;
  /** B&W mode: running bitwise-AND of all frames in the group. */
  bin: Uint8Array | null;
  /** Color mode: copy of the first (representative) frame, rgb24. */
  rgb: Buffer | null;
  count: number;
}

// --- main entry -----------------------------------------------------------

export async function runExtraction(
  videoPath: string,
  outDir: string,
  params: ProcessParams,
  meta: JobMeta,
  cb: ExtractCallbacks,
): Promise<ExtractOutput> {
  const startedAt = Date.now();
  // Integer crop (Math.round, matching ffmpeg.ts) so the coordinates handed
  // to ffmpeg and the buffer math below are always whole pixels.
  const crop = {
    x: Math.round(params.crop.x),
    y: Math.round(params.crop.y),
    width: Math.round(params.crop.width),
    height: Math.round(params.crop.height),
  };
  const W = crop.width;
  const H = crop.height;
  const pixels = W * H;
  const dh = Math.max(8, Math.round((DESC_W * H) / W));
  const threshold = params.similarityThreshold;
  // Vertical alignment tolerance for the NCC comparison, in whole descriptor
  // rows — ~4px of real drift maps to ceil(4*dh/H) rows (always at least 1).
  const maxShiftRows = Math.min(6, Math.max(1, Math.round((4 * dh) / H)));
  const groups: Group[] = [];
  const grayScratch = params.bw ? new Uint8Array(pixels) : null;
  const estSampled = Math.max(
    1,
    ((meta.duration - params.startTime) * meta.fps) / params.frameSkip,
  );

  cb.log(
    `Crop (integer px): ${W}×${H} at x=${crop.x}, y=${crop.y} · drift tolerance ±${maxShiftRows} row(s)`,
  );

  let sampled = 0;
  let blanksSkipped = 0;

  const { stopped } = await streamSampledFrames(videoPath, {
    crop,
    frameSkip: params.frameSkip,
    startTime: params.startTime,
    shouldStop: cb.shouldStop,
    onChild: cb.onChild,
    onFrame: (frame) => {
      sampled += 1;
      let desc: Float32Array | null;
      if (grayScratch) {
        rgbToGray(frame, grayScratch);
        // Phase 1 — pure Otsu binarization for the NCC descriptor.
        // The group-matching comparison must be independent of the
        // user's thresholdBias, otherwise a bias of +12 (Clean preset)
        // causes frames that *should* match the same group to diverge.
        const otsu = otsuThreshold(grayScratch);
        binarize(grayScratch, otsu);
        desc = descriptorFromGray(grayScratch, W, H, DESC_W, dh);
        // Phase 2 — re-binarize with user bias for the output image.
        // This happens AFTER the descriptor is built so that bias only
        // controls final appearance, never grouping behavior.
        if (desc) {
          binarize(grayScratch, otsu - params.thresholdBias);
        }
      } else {
        desc = descriptorFromRgb(frame, W, H, DESC_W, dh);
      }
      if (desc) {
        const descPrefix = rowSqPrefix(desc, DESC_W, dh);
        let matched: Group | null = null;
        let matchedShift = 0;
        let bestScore = -Infinity;
        for (const g of groups) {
          const res = nccBestShift(
            g.rep,
            g.sqPrefix,
            desc,
            descPrefix,
            DESC_W,
            dh,
            maxShiftRows,
          );
          if (res.score >= threshold && res.score > bestScore) {
            matched = g;
            matchedShift = res.shift;
            bestScore = res.score;
          }
        }
        if (matched) {
          matched.count += 1;

          // Update the group representative descriptor with an exponential moving average
          const alpha = 0.15;
          for (let i = 0; i < matched.rep.length; i++) {
            matched.rep[i] = (1 - alpha) * matched.rep[i] + alpha * desc[i];
          }
          normalizeDescriptor(matched.rep);
          matched.sqPrefix = rowSqPrefix(matched.rep, DESC_W, dh);

          if (matched.bin && grayScratch) {
            const acc = matched.bin;
            // Align the candidate frame to the representative frame's coordinate
            // system before performing the pixel-by-pixel AND operation.
            // This prevents vertical "black smearing" and extra black lines at boundaries
            // caused by merging unaligned frames across different vertical offsets.
            const s = Math.round((matchedShift * H) / dh);
            for (let y = 0; y < H; y++) {
              const cy = y + s;
              if (cy >= 0 && cy < H) {
                const destOff = y * W;
                const srcOff = cy * W;
                for (let x = 0; x < W; x++) {
                  acc[destOff + x] &= grayScratch[srcOff + x];
                }
              }
            }
          }
        } else {
          groups.push({
            rep: desc,
            sqPrefix: descPrefix,
            bin: grayScratch ? Uint8Array.from(grayScratch) : null,
            rgb: grayScratch ? null : Buffer.from(frame),
            count: 1,
          });
          cb.log(`Detected line ${groups.length} at frame sample #${sampled}`);
        }
      } else {
        blanksSkipped += 1;
      }
      cb.progress(Math.min(0.97, sampled / estSampled), sampled, groups.length);
    },
  });

  if (stopped || cb.shouldStop()) throw new CancelledError();

  if (groups.length === 0) {
    throw new ApiError(
      422,
      "NO_LINES",
      blanksSkipped > 0
        ? `No sheet-music lines were detected (${blanksSkipped} sampled frames were near-blank). Check that the crop region covers the notation and that the start time is correct.`
        : "No frames matched the current sampling settings. Try lowering the frame skip or adjusting the crop region.",
    );
  }

  cb.log(
    `Analysis complete — ${sampled} frames sampled, ${groups.length} unique line${groups.length === 1 ? "" : "s"}` +
      (blanksSkipped > 0 ? `, ${blanksSkipped} near-blank skipped` : "") +
      ". Writing images…",
  );

  // Top-trim is applied HERE — after the AND-merge — so it removes only
  // the top edge of the final composite image (the actual black-border
  // artifact from scrolling notation software), not per-frame content
  // that might otherwise be useful for the merge.
  const topTrim = Math.max(0, Math.min(params.topTrim, H - 1));
  const outH = H - topTrim;
  const linesDir = ensureDir(path.join(outDir, "lines"));
  const images: ResultImage[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const name = `${String(i).padStart(4, "0")}.png`;
    const abs = path.join(linesDir, name);
    if (g.bin) {
      const rowStride = W;
      const src = g.bin.subarray(topTrim * rowStride, H * rowStride);
      await sharp(Buffer.from(src.buffer, src.byteOffset, src.length), {
        raw: { width: W, height: outH, channels: 1 },
      })
        .png()
        .toFile(abs);
    } else if (g.rgb) {
      const rowStride = W * 3;
      const src = g.rgb.subarray(topTrim * rowStride, H * rowStride);
      await sharp(src, { raw: { width: W, height: outH, channels: 3 } })
        .png()
        .toFile(abs);
    }
    images.push({ name: `lines/${name}`, width: W, height: outH });
  }

  if (topTrim > 0) cb.log(`Trimmed ${topTrim}px from the top of each line.`);
  return { images, framesSampled: sampled, elapsedMs: Date.now() - startedAt };
}
