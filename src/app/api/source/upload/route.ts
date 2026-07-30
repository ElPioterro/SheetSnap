import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/types";
import { MAX_UPLOAD_BYTES, ensureDir, jobDir } from "@/server/config";
import { errorResponse } from "@/server/http";
import { createUploadJob } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ts",
]);

/**
 * PUT /api/source/upload?filename=song.mp4
 * Streams the request body straight to disk (constant memory), then probes
 * the video and extracts the preview frame for the crop step.
 */
export async function PUT(req: NextRequest) {
  const id = crypto.randomUUID();
  try {
    const rawName = req.nextUrl.searchParams.get("filename") ?? "video.mp4";
    const filename =
      path
        .basename(rawName)
        .replace(/[^\w.\- ()[\]]+/g, "_")
        .slice(-120) || "video.mp4";
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw new ApiError(
        415,
        "BAD_TYPE",
        "Unsupported file type. Please upload an MP4, MOV, MKV, WEBM or AVI video.",
      );
    }
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        413,
        "TOO_LARGE",
        `The file is too large (limit ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
      );
    }
    if (!req.body) throw new ApiError(400, "EMPTY", "No file was received.");

    const dir = ensureDir(jobDir(id));
    const videoPath = path.join(dir, `video${ext}`);
    const src = Readable.fromWeb(
      req.body as unknown as import("node:stream/web").ReadableStream,
    );
    let received = 0;
    src.on("data", (c: Buffer) => {
      received += c.length;
      if (received > MAX_UPLOAD_BYTES) {
        src.destroy(
          new ApiError(413, "TOO_LARGE", "The file exceeded the upload limit."),
        );
      }
    });
    await pipeline(src, fs.createWriteStream(videoPath));
    if (fs.statSync(videoPath).size === 0) {
      throw new ApiError(400, "EMPTY", "The uploaded file is empty.");
    }

    const job = await createUploadJob(id, videoPath, filename);
    return Response.json({ job });
  } catch (e) {
    try {
      fs.rmSync(jobDir(id), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    return errorResponse(e);
  }
}
