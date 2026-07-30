import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/types";
import { errorResponse } from "@/server/http";
import { createYouTubeJob } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/source/youtube { url } — starts a background download job via
 * yt-dlp. The client polls /api/jobs/[id] until the status becomes "pending".
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw new ApiError(400, "BAD_URL", "Paste a video URL first.");
    if (
      !/^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(url)
    ) {
      throw new ApiError(400, "BAD_URL", "That doesn't look like a YouTube URL.");
    }
    const job = await createYouTubeJob(url);
    return Response.json({ job });
  } catch (e) {
    return errorResponse(e);
  }
}
