import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import type { CropRect, JobMeta } from "@/lib/types";
import { ApiError } from "@/lib/types";

// ---------------------------------------------------------------------------
// On-disk layout: <dataDir>/jobs/<id>/{video.*, preview.jpg, lines/NNNN.png,
// result.pdf, result.zip}. Path helpers live in config.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ffmpeg binary resolution: env override → bundled ffmpeg-static → $PATH.
// ---------------------------------------------------------------------------

let cachedFfmpeg: string | null = null;

export function resolveFfmpeg(): string {
  if (cachedFfmpeg) return cachedFfmpeg;
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return (cachedFfmpeg = fromEnv);
  if (ffmpegStatic && fs.existsSync(ffmpegStatic))
    return (cachedFfmpeg = ffmpegStatic);
  // Fall back to a system-installed ffmpeg on PATH. If it is missing, the
  // spawn call will fail with a clear error.
  return (cachedFfmpeg = "ffmpeg");
}



function tailLines(s: string, n = 4): string {
  const lines = s
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(-n).join(" — ") || "no output";
}

interface RunResult {
  stderr: string;
  code: number | null;
}

function runFfmpeg(args: string[], allowNonZero = false): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpeg(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
      if (err.length > 16000) err = err.slice(-16000);
    });
    child.on("error", (e: Error & { code?: string }) =>
      reject(
        new ApiError(
          500,
          e.code === "ENOENT" ? "FFMPEG_MISSING" : "FFMPEG_SPAWN_FAILED",
          e.code === "ENOENT"
            ? "ffmpeg was not found. The desktop build bundles it; for local development set FFMPEG_PATH or install ffmpeg."
            : `Could not start ffmpeg: ${e.message}`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code === 0 || allowNonZero) resolve({ stderr: err, code });
      else
        reject(
          new ApiError(
            422,
            "FFMPEG_FAILED",
            `ffmpeg exited with code ${code}: ${tailLines(err)}`,
          ),
        );
    });
  });
}

// ---------------------------------------------------------------------------
// Metadata probing — parses `ffmpeg -i` output (no ffprobe dependency).
// ---------------------------------------------------------------------------

export async function probeVideo(file: string): Promise<JobMeta> {
  const { stderr } = await runFfmpeg(
    ["-hide_banner", "-nostdin", "-i", file],
    true,
  );
  const durM = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  const videoLine = stderr
    .split(/\r?\n/)
    .find((l) => /Stream.*Video:/.test(l));

  let width = 0;
  let height = 0;
  if (videoLine) {
    const dimRe = /(\d{1,5})x(\d{1,5})/g;
    let m: RegExpExecArray | null;
    while ((m = dimRe.exec(videoLine)) !== null) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (w >= 16 && h >= 16 && w < 30000 && h < 30000) {
        width = w;
        height = h;
        break;
      }
    }
  }
  const fpsM = videoLine && /(\d+(?:\.\d+)?)\s*fps/.exec(videoLine);

  if (!durM || !width || !height) {
    throw new ApiError(
      422,
      "PROBE_FAILED",
      "Could not read the video. The file may be corrupted, DRM-protected, or in an unsupported format.",
    );
  }
  const duration =
    Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3]);
  const fps = fpsM ? Number(fpsM[1]) : 30;
  return {
    width,
    height,
    fps,
    duration,
    frameCount: Math.max(1, Math.round(duration * fps)),
  };
}

// ---------------------------------------------------------------------------
// Preview frame extraction (used for the interactive crop selection).
// ---------------------------------------------------------------------------

export async function extractPreviewFrame(
  videoPath: string,
  tSeconds: number,
  outPath: string,
): Promise<void> {
  const t = Math.max(0, tSeconds).toFixed(2);
  await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    t,
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outPath,
  ]);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new ApiError(
      422,
      "PREVIEW_FAILED",
      "Failed to extract a preview frame from the video.",
    );
  }
}

// ---------------------------------------------------------------------------
// Frame sampler — the streaming heart of the pipeline.
//
// ffmpeg does all heavy lifting (seek, decode, crop, every-Nth-frame
// selection, RGB conversion) and feeds raw rgb24 frames to stdout. We slice
// the stream into fixed-size frames with zero wasted copies and hand each
// frame to the consumer synchronously, so backpressure is automatic.
// ---------------------------------------------------------------------------

export interface SampledStreamOptions {
  crop: CropRect;
  frameSkip: number;
  startTime: number;
  /** Called once per sampled frame. `frame` is reused — copy it to keep it. */
  onFrame(frame: Buffer, sampledIndex: number): void;
  shouldStop(): boolean;
  /** Register the live process for cancellation. */
  onChild?(kill: () => void): void;
}

export interface SampledStreamResult {
  sampled: number;
  stopped: boolean;
}

export function streamSampledFrames(
  videoPath: string,
  opts: SampledStreamOptions,
): Promise<SampledStreamResult> {
  // Force whole-pixel crop coordinates with Math.round so ffmpeg never
  // receives fractional values that could round differently per frame and
  // cause the crop to drift by a pixel between samples.
  const w = Math.round(opts.crop.width);
  const h = Math.round(opts.crop.height);
  const x = Math.round(opts.crop.x);
  const y = Math.round(opts.crop.y);
  const frameSize = w * h * 3;
  const skip = Math.max(1, Math.floor(opts.frameSkip));
  // IMPORTANT — start-time seeking (`-ss`):
  //
  //   `-ss T` placed BEFORE `-i` is a fast *input-level* seek that jumps
  //   to the nearest keyframe using the container index. Since ffmpeg 2.1
  //   `-accurate_seek` is on by default, so ffmpeg then decode-and-discards
  //   frames up to T, giving frame accuracy with almost no wasted decoding.
  //
  //   `-ss T` placed AFTER `-i` decodes *from frame 0* and discards output
  //   until T — precise but O(N) slow. For long piano tutorials (30+ min)
  //   this can add minutes to processing before the first sample arrives.
  //
  //   Placing `-ss` before `-i` also matters for the `select` filter's `n`
  //   counter: the filter sees frames starting at the seek point, so
  //   `not(mod(n,K))` samples relative to `startTime` — which is what
  //   users intuitively expect (frame 0 is "the moment they set").
  //
  //   `-noaccurate_seek` is deliberately NOT passed — we want accuracy.
  const startArgs =
    opts.startTime > 0 ? ["-ss", opts.startTime.toFixed(3)] : [];
  const vf = `crop=${w}:${h}:${x}:${y},select=not(mod(n\\,${skip})),format=rgb24`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    ...startArgs,
    "-i",
    videoPath,
    "-an",
    "-vf",
    vf,
    // `vfr` (not `passthrough`) so variable-framerate containers don't feed
    // the select filter frames at inconsistent decode offsets.
    "-fps_mode",
    "vfr",
    "-f",
    "rawvideo",
    "pipe:1",
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(resolveFfmpeg(), args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      reject(e);
      return;
    }
    opts.onChild?.(() => child.kill("SIGKILL"));

    let sampled = 0;
    let failed = false;
    let stopped = false;
    const frameBuf = Buffer.allocUnsafe(frameSize);
    let filled = 0;
    let stderrTail = "";

    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      stopped = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      reject(e);
    };

    child.stdout.on("data", (c: Buffer) => {
      let off = 0;
      while (off < c.length) {
        const take = Math.min(frameSize - filled, c.length - off);
        c.copy(frameBuf, filled, off, off + take);
        filled += take;
        off += take;
        if (filled === frameSize) {
          filled = 0;
          try {
            opts.onFrame(frameBuf, sampled);
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          sampled += 1;
          if (opts.shouldStop()) {
            stopped = true;
            child.kill("SIGKILL");
            return;
          }
        }
      }
    });

    child.stderr.on("data", (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-4000);
    });

    child.on("error", (e: Error & { code?: string }) => {
      fail(
        new ApiError(
          500,
          e.code === "ENOENT" ? "FFMPEG_MISSING" : "FFMPEG_SPAWN_FAILED",
          e.code === "ENOENT"
            ? "ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH."
            : `Could not start ffmpeg: ${e.message}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (failed) return; // reject already called
      if (stopped) resolve({ sampled, stopped: true });
      else if (code === 0) resolve({ sampled, stopped: false });
      else
        reject(
          new ApiError(
            422,
            "FFMPEG_FAILED",
            `ffmpeg failed while reading the video (exit ${code}). ${tailLines(stderrTail)}`,
          ),
        );
    });
  });
}
