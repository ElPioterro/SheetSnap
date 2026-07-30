import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import sharp from "sharp";
import type {
  JobDTO,
  JobLive,
  JobMeta,
  ProcessParams,
  ResultImage,
  StoredJob,
} from "@/lib/types";
import { ApiError, CancelledError, DEFAULT_SETTINGS } from "@/lib/types";
import { ensureDir, jobDir } from "./config";
import { downloadYouTube, getYouTubeTitle } from "./downloader";
import { extractPreviewFrame, probeVideo } from "./ffmpeg";
import { buildPdf } from "./pdf";
import { runExtraction } from "./pipeline";
import {
  createJobRecord,
  findVideoFile,
  listStoredJobs,
  loadJob,
  updateJob,
} from "./store";

/**
 * Job orchestration.
 *
 * Durable state lives on the filesystem (data/jobs/<id>/job.json + artifact
 * files — see store.ts). Live progress of the one currently-running job
 * lives in memory (single-process server — this is a local desktop-style
 * app, so at most one heavy job runs at a time).
 */

interface LiveState extends JobLive {
  kill?: (() => void) | null;
}

const g = globalThis as typeof globalThis & {
  __sheetsnapLive?: Map<string, LiveState>;
  __sheetsnapBusy?: boolean;
};
const liveMap = (g.__sheetsnapLive ??= new Map<string, LiveState>());

function isBusy(): boolean {
  return g.__sheetsnapBusy === true;
}
function setBusy(v: boolean): void {
  g.__sheetsnapBusy = v;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function logLine(lv: LiveState | undefined, msg: string): void {
  if (!lv) return;
  lv.logs.push(`[${stamp()}] ${msg}`);
  if (lv.logs.length > 300) lv.logs.splice(0, lv.logs.length - 300);
}

function newLive(phase: string): LiveState {
  return {
    phase,
    percent: 0,
    framesSampled: 0,
    linesFound: 0,
    logs: [`[${stamp()}] ${phase}`],
    cancelRequested: false,
    kill: null,
  };
}

// --- mapping ----------------------------------------------------------------

function toDTO(job: StoredJob, lv?: LiveState | undefined): JobDTO {
  return {
    ...job,
    live: lv
      ? {
          phase: lv.phase,
          percent: lv.percent,
          framesSampled: lv.framesSampled,
          linesFound: lv.linesFound,
          logs: lv.logs.slice(-200),
          cancelRequested: lv.cancelRequested,
        }
      : null,
  };
}

// --- reads --------------------------------------------------------------------

export function getJobDTO(id: string): JobDTO {
  return toDTO(loadJob(id), liveMap.get(id));
}

export function listJobs(): JobDTO[] {
  return listStoredJobs().map((r) => toDTO(r, liveMap.get(r.id)));
}

/** Title lookup used by the artifact download route. */
export function getJobTitle(id: string): string {
  try {
    return loadJob(id).title;
  } catch {
    return "sheet-music";
  }
}

// --- shared: probe + preview after a source file exists ------------------------

async function finalizeSource(id: string, videoPath: string): Promise<void> {
  const lv = liveMap.get(id);
  if (lv) lv.phase = "Reading video";
  logLine(lv, "Reading video metadata…");
  const meta = await probeVideo(videoPath);
  logLine(
    lv,
    `${meta.width}×${meta.height} · ${meta.fps} fps · ${meta.duration.toFixed(1)} s`,
  );

  const dir = ensureDir(jobDir(id));
  const preview = path.join(dir, "preview.jpg");
  let t =
    meta.duration > 30
      ? Math.min(11, meta.duration / 5)
      : Math.max(0.1, meta.duration / 2);
  await extractPreviewFrame(videoPath, t, preview);
  try {
    // If the frame is essentially blank, retry from the middle of the video.
    const stats = await sharp(preview).stats();
    const mean =
      stats.channels.reduce((a, c) => a + c.mean, 0) / stats.channels.length;
    if ((mean > 252 || mean < 3) && t < meta.duration / 2) {
      logLine(lv, "Preview frame looked blank — sampling later in the video.");
      t = meta.duration / 2;
      await extractPreviewFrame(videoPath, t, preview);
    }
  } catch {
    /* preview inspection is best-effort */
  }

  updateJob(id, { meta, status: "pending" });
}

function failRow(id: string, err: unknown, canceled = false): void {
  const message =
    err instanceof Error
      ? err.message
      : "Unexpected error while preparing the video.";
  updateJob(id, {
    status: canceled ? "canceled" : "error",
    error: canceled ? null : message,
  });
}

// --- upload flow ---------------------------------------------------------------

function cleanTitle(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/\s*\[[^\]]+\]\s*$/, "").trim() || "Untitled video";
}

export async function createUploadJob(
  id: string,
  videoPath: string,
  originalName: string,
): Promise<JobDTO> {
  createJobRecord({ id, title: cleanTitle(originalName), sourceType: "upload" });
  try {
    await finalizeSource(id, videoPath);
  } catch (e) {
    failRow(id, e);
  }
  return getJobDTO(id);
}

// --- YouTube flow (runs in the background, client polls) --------------------------

export async function createYouTubeJob(url: string): Promise<JobDTO> {
  if (isBusy()) {
    throw new ApiError(
      409,
      "BUSY",
      "Another job is currently running. Wait for it to finish or cancel it first.",
    );
  }
  const id = crypto.randomUUID();
  setBusy(true);
  createJobRecord({
    id,
    title: "YouTube video",
    sourceType: "youtube",
    sourceUrl: url,
  });
  const lv = newLive("Connecting to YouTube…");
  liveMap.set(id, lv);

  void (async () => {
    try {
      const dir = ensureDir(jobDir(id));
      const title = await getYouTubeTitle(url);
      if (title) {
        updateJob(id, { title: title.slice(0, 140) });
        logLine(lv, `Found: "${title}"`);
      }
      lv.phase = "Downloading video";
      const file = await downloadYouTube(url, dir, {
        log: (m) => logLine(lv, m),
        onPercent: (p) => {
          lv.percent = p;
        },
        shouldStop: () => lv.cancelRequested,
        onChild: (kill) => {
          lv.kill = kill;
        },
      });
      if (lv.cancelRequested) throw new CancelledError();
      logLine(lv, "Download complete.");
      lv.phase = "Preparing preview";
      lv.percent = 1;
      await finalizeSource(id, file);
      lv.phase = "Ready";
    } catch (e) {
      if (e instanceof CancelledError || lv.cancelRequested) {
        logLine(lv, "Canceled.");
        failRow(id, e, true);
      } else {
        logLine(lv, e instanceof Error ? e.message : String(e));
        failRow(id, e);
      }
    } finally {
      setBusy(false);
    }
  })();

  return getJobDTO(id);
}

// --- processing flow ----------------------------------------------------------------

export function normalizeParams(input: unknown, meta: JobMeta): ProcessParams {
  const p = (input ?? {}) as Partial<ProcessParams>;
  const c = p.crop ?? ({} as Partial<ProcessParams["crop"]>);
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  // Default crop: ~6% inset on each side — a sensible sheet-music starting point.
  const insetX = Math.round(meta.width * 0.06);
  const insetY = Math.round(meta.height * 0.06);
  let x = Math.round(num(c.x, insetX));
  let y = Math.round(num(c.y, insetY));
  let w = Math.round(num(c.width, meta.width - 2 * insetX));
  let h = Math.round(num(c.height, meta.height - 2 * insetY));
  x = Math.min(Math.max(0, x), meta.width - 16);
  y = Math.min(Math.max(0, y), meta.height - 16);
  w = Math.min(Math.max(1, w), meta.width - x);
  h = Math.min(Math.max(1, h), meta.height - y);
  if (w < 16 || h < 16) {
    throw new ApiError(
      400,
      "CROP_TOO_SMALL",
      "The crop region is too small (minimum 16×16 px).",
    );
  }
  const frameSkip = Math.min(
    600,
    Math.max(1, Math.round(num(p.frameSkip, DEFAULT_SETTINGS.frameSkip))),
  );
  const similarityThreshold = Math.min(
    0.999,
    Math.max(0.5, num(p.similarityThreshold, DEFAULT_SETTINGS.similarityThreshold)),
  );
  const startTime = Math.min(
    Math.max(0, num(p.startTime, DEFAULT_SETTINGS.startTime)),
    Math.max(0, meta.duration - 0.5),
  );
  const thresholdBias = Math.round(
    Math.min(
      40,
      Math.max(-40, num(p.thresholdBias, DEFAULT_SETTINGS.thresholdBias)),
    ),
  );
  const topTrim = Math.round(
    Math.min(
      Math.max(1, h - 1),
      Math.max(0, num(p.topTrim, DEFAULT_SETTINGS.topTrim)),
    ),
  );
  const title =
    (typeof p.title === "string" && p.title.trim().slice(0, 140)) || "Sheet music";
  return {
    crop: { x, y, width: w, height: h },
    frameSkip,
    similarityThreshold,
    bw: p.bw !== false,
    startTime,
    title,
    thresholdBias,
    topTrim,
  };
}

async function buildZip(dir: string, images: ResultImage[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(path.join(dir, "result.zip"));
    const zip = new ZipArchive({ zlib: { level: 9 } });
    out.on("close", () => resolve());
    out.on("error", reject);
    zip.on("error", reject);
    zip.pipe(out);
    for (const img of images) {
      zip.file(path.join(dir, img.name), { name: path.basename(img.name) });
    }
    void zip.finalize();
  });
}

export function startProcessing(id: string, rawParams: unknown): JobDTO {
  const job = loadJob(id);
  if (job.status === "processing" || job.status === "preparing") {
    throw new ApiError(409, "ALREADY_RUNNING", "This job is already running.");
  }
  if (!job.meta) {
    throw new ApiError(400, "NOT_READY", "The video source is not ready yet.");
  }
  if (isBusy()) {
    throw new ApiError(
      409,
      "BUSY",
      "Another job is currently running. Wait for it to finish or cancel it first.",
    );
  }
  const params = normalizeParams(rawParams, job.meta);
  setBusy(true);
  updateJob(id, {
    params,
    status: "processing",
    error: null,
    result: null,
  });
  const lv = newLive("Starting analysis…");
  liveMap.set(id, lv);
  void runProcess(id);
  return getJobDTO(id);
}

async function runProcess(id: string): Promise<void> {
  const lv = liveMap.get(id);
  try {
    const job = loadJob(id);
    const params = job.params;
    const meta = job.meta;
    if (!params || !meta) throw new ApiError(400, "NOT_READY", "Missing job state.");

    const videoPath = findVideoFile(id);
    if (!videoPath) {
      throw new ApiError(
        422,
        "VIDEO_MISSING",
        "The source video file is no longer on disk. Please upload it again.",
      );
    }

    const dir = ensureDir(jobDir(id));
    const linesOut = path.join(dir, "lines");
    if (fs.existsSync(linesOut)) fs.rmSync(linesOut, { recursive: true, force: true });

    if (params.startTime > 0)
      logLine(
        lv,
        `Seeking to ${params.startTime.toFixed(3)} s (skipping the first ${params.startTime.toFixed(1)} s).`,
      );
    logLine(
      lv,
      `Crop ${params.crop.width}×${params.crop.height} at (${params.crop.x}, ${params.crop.y}) · every ${params.frameSkip} frame(s) · similarity ≥ ${params.similarityThreshold.toFixed(3)}${params.bw ? ` · B&W merge (bias ${params.thresholdBias >= 0 ? "+" : ""}${params.thresholdBias})` : " · color"} · top-trim ${params.topTrim}px`,
    );
    lv!.phase = "Analyzing frames";

    const { images, framesSampled, elapsedMs } = await runExtraction(
      videoPath,
      dir,
      params,
      meta,
      {
        log: (m) => logLine(lv, m),
        progress: (p, sampled, lines) => {
          if (!lv) return;
          lv.percent = p;
          lv.framesSampled = sampled;
          lv.linesFound = lines;
        },
        shouldStop: () => lv?.cancelRequested ?? true,
        onChild: (kill) => {
          if (lv) lv.kill = kill;
        },
      },
    );

    if (lv?.phase !== undefined) lv.phase = "Rendering PDF";
    logLine(lv, "Rendering PDF…");
    await buildPdf(
      images.map((img) => ({
        absPath: path.join(dir, img.name),
        width: img.width,
        height: img.height,
      })),
      params.title,
      path.join(dir, "result.pdf"),
    );
    if (lv) lv.percent = 0.99;

    logLine(lv, "Packaging PNG archive…");
    await buildZip(dir, images);

    updateJob(id, {
      status: "done",
      error: null,
      result: {
        lineCount: images.length,
        framesSampled,
        elapsedMs,
        images,
      },
    });
    if (lv) {
      lv.phase = "Done";
      lv.percent = 1;
    }
    logLine(
      lv,
      `Finished in ${(elapsedMs / 1000).toFixed(1)} s — ${images.length} line${images.length === 1 ? "" : "s"} extracted.`,
    );
  } catch (e) {
    if (e instanceof CancelledError || liveMap.get(id)?.cancelRequested) {
      if (lv) lv.phase = "Canceled";
      logLine(lv, "Canceled by user.");
      updateJob(id, { status: "canceled" });
    } else {
      if (lv) lv.phase = "Failed";
      const message = e instanceof Error ? e.message : String(e);
      logLine(lv, message);
      updateJob(id, { status: "error", error: message });
    }
  } finally {
    setBusy(false);
  }
}

// --- cancellation -----------------------------------------------------------------

export function cancelJob(id: string): JobDTO {
  const job = loadJob(id);
  const lv = liveMap.get(id);
  if (lv && (job.status === "processing" || job.status === "preparing")) {
    lv.cancelRequested = true;
    logLine(lv, "Cancel requested — stopping…");
    try {
      lv.kill?.();
    } catch {
      /* process may already be gone */
    }
  } else if (job.status === "processing" || job.status === "preparing") {
    updateJob(id, { status: "canceled" });
  }
  return getJobDTO(id);
}

// --- line deletion -----------------------------------------------------------------

const LINE_NAME_RE = /^\d{4}\.png$/;

/**
 * Rebuild result.pdf and result.zip from the current `result.images` list
 * on disk. This is deliberately *not* part of `deleteLine` — regenerating
 * the PDF/ZIP takes >1s, so it runs on demand via the `/rebuild` endpoint
 * (the UI calls it in the background after the user finishes pruning) to
 * keep individual deletions instant.
 */
export async function rebuildArtifacts(id: string): Promise<void> {
  const job = loadJob(id);
  if (!job.result || !job.params) {
    throw new ApiError(400, "NOT_READY", "Job has no result artifacts yet.");
  }
  const dir = jobDir(id);
  await buildPdf(
    job.result.images.map((img) => ({
      absPath: path.join(dir, img.name),
      width: img.width,
      height: img.height,
    })),
    job.params.title,
    path.join(dir, "result.pdf"),
  );
  await buildZip(dir, job.result.images);
}

/**
 * Delete one extracted line from a finished job. This does exactly three
 * things and returns immediately:
 *   1. remove the PNG from disk,
 *   2. drop it from `result.images` in job.json,
 *   3. return the updated job.
 * It deliberately does NOT regenerate the PDF/ZIP (that's slow) — the UI
 * triggers `/rebuild` separately once the user is done pruning.
 */
export async function deleteLine(id: string, name: string): Promise<JobDTO> {
  // Only the basename is accepted — keep the surface tiny and auditable.
  if (!LINE_NAME_RE.test(name)) {
    throw new ApiError(
      400,
      "BAD_LINE",
      "Line name must be of the form 0000.png.",
    );
  }
  const job = loadJob(id);
  if (job.status !== "done") {
    throw new ApiError(
      409,
      "NOT_FINISHED",
      "Lines can only be deleted after processing has finished.",
    );
  }
  if (!job.result) {
    throw new ApiError(400, "NOT_READY", "Job has no result artifacts yet.");
  }
  const before = job.result.images;
  const idx = before.findIndex((i) => i.name === `lines/${name}`);
  if (idx === -1) {
    throw new ApiError(404, "NOT_FOUND", "That line isn't part of this job.");
  }
  if (before.length <= 1) {
    throw new ApiError(
      400,
      "LAST_LINE",
      "Cannot delete the last remaining line.",
    );
  }

  const file = path.join(jobDir(id), "lines", name);
  try {
    if (fs.existsSync(file)) fs.rmSync(file);
  } catch (e) {
    throw new ApiError(
      500,
      "DELETE_FAILED",
      `Could not remove the line file: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  const remaining = before.filter((i) => i.name !== `lines/${name}`);
  updateJob(id, {
    result: {
      ...job.result,
      images: remaining,
      lineCount: remaining.length,
    },
  });

  // Done — the PDF/ZIP are intentionally left as-is here; the client calls
  // POST /api/jobs/[id]/rebuild to refresh them (see rebuildArtifacts).
  return getJobDTO(id);
}
