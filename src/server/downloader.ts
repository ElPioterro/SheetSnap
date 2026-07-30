import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ApiError, CancelledError } from "@/lib/types";

/**
 * YouTube ingestion via yt-dlp. The desktop build ships the yt-dlp binary as
 * a bundled resource; in local development it must be on PATH (or YTDLP_PATH).
 */

function resolveYtDlp(): string {
  const fromEnv = process.env.YTDLP_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return "yt-dlp";
}

function missingError(): ApiError {
  return new ApiError(
    500,
    "YTDLP_MISSING",
    "yt-dlp is not available on this machine. The packaged desktop app bundles it automatically — for local development, install yt-dlp or set the YTDLP_PATH environment variable. File upload works without it.",
  );
}

interface SpawnOptions {
  log(msg: string): void;
  shouldStop(): boolean;
  onChild?(kill: () => void): void;
}

function runYtDlp(
  args: string[],
  opts: SpawnOptions & { onLine?(line: string): void },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlp(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    opts.onChild?.(() => child.kill("SIGKILL"));
    let stdout = "";
    let stderrTail = "";
    let stopped = false;
    const handle = (chunk: Buffer, isErr: boolean) => {
      const s = chunk.toString();
      if (isErr) stderrTail = (stderrTail + s).slice(-4000);
      else stdout += s;
      for (const line of s.split(/\r?\n/)) {
        if (line.trim()) opts.onLine?.(line.trim());
      }
    };
    child.stdout.on("data", (c: Buffer) => handle(c, false));
    child.stderr.on("data", (c: Buffer) => handle(c, true));
    child.on("error", (e: Error & { code?: string }) => {
      if (e.code === "ENOENT") reject(missingError());
      else reject(new ApiError(500, "YTDLP_SPAWN_FAILED", e.message));
    });
    const stopCheck = setInterval(() => {
      if (opts.shouldStop() && !stopped) {
        stopped = true;
        child.kill("SIGKILL");
      }
    }, 250);
    child.on("close", (code) => {
      clearInterval(stopCheck);
      if (stopped || opts.shouldStop()) reject(new CancelledError());
      else if (code === 0) resolve({ stdout, stderr: stderrTail });
      else if (/Unsupported URL|is not a valid URL/i.test(stderrTail))
        reject(
          new ApiError(422, "BAD_URL", "This URL is not a supported video URL."),
        );
      else if (/Private video|Sign in|confirm you're not a bot|HTTP Error 4/i.test(stderrTail))
        reject(
          new ApiError(
            422,
            "VIDEO_UNAVAILABLE",
            "The video could not be downloaded (it may be private, age-restricted, or blocked). Try another video or download it manually and use file upload.",
          ),
        );
      else
        reject(
          new ApiError(
            502,
            "DOWNLOAD_FAILED",
            `yt-dlp failed (exit ${code}). ${stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" — ") || ""}`,
          ),
        );
    });
  });
}

export async function getYouTubeTitle(url: string): Promise<string | null> {
  try {
    const { stdout } = await runYtDlp(
      ["--no-playlist", "--skip-download", "--get-title", url],
      { log: () => {}, shouldStop: () => false },
    );
    const title = stdout.trim().split(/\r?\n/)[0]?.trim();
    return title || null;
  } catch (e) {
    // Surface missing-binary errors, tolerate metadata hiccups.
    if (e instanceof ApiError && e.code === "YTDLP_MISSING") throw e;
    if (e instanceof CancelledError) throw e;
    return null;
  }
}

export async function downloadYouTube(
  url: string,
  outDir: string,
  opts: SpawnOptions & { onPercent(p: number): void },
): Promise<string> {
  const pctRe = /\[download\]\s+([\d.]+)%/;
  await runYtDlp(
    [
      "--no-playlist",
      "--newline",
      "--no-color",
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format",
      "mp4",
      "-o",
      path.join(outDir, "video.%(ext)s"),
      url,
    ],
    {
      ...opts,
      onLine: (line) => {
        const m = pctRe.exec(line);
        if (m) opts.onPercent(Math.min(0.99, Number(m[1]) / 100));
        else if (/\[Merger\]/.test(line)) opts.log("Merging audio & video…");
        else if (/ERROR/.test(line)) opts.log(line.replace(/^ERROR:\s*/, ""));
      },
    },
  );
  const file = fs
    .readdirSync(outDir)
    .find((f) => /^video\.(mp4|mkv|webm|mov|m4v)$/i.test(f));
  if (!file) {
    throw new ApiError(
      502,
      "DOWNLOAD_FAILED",
      "The download finished but no video file was produced.",
    );
  }
  return path.join(outDir, file);
}
