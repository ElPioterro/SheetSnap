import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ApiError } from "@/lib/types";
import { jobDir } from "@/server/config";
import { errorResponse } from "@/server/http";
import { getJobTitle } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = /^(preview\.jpg|result\.pdf|result\.zip|lines\/\d{4}\.png)$/;
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

/**
 * GET /api/jobs/[id]/file?name=<artifact>[&download=1] — streams job
 * artifacts (preview frame, extracted lines, PDF, ZIP) with strict
 * allow-listing so nothing outside the whitelist can be read.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const rel = url.searchParams.get("name") ?? "";
    const dir = jobDir(id);
    const abs = path.resolve(dir, rel);
    if (
      !ALLOWED.test(rel) ||
      abs !== path.join(dir, rel) ||
      !fs.existsSync(abs)
    ) {
      throw new ApiError(404, "NOT_FOUND", "File not found.");
    }
    const stat = fs.statSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const headers = new Headers({
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
    if (url.searchParams.get("download") === "1") {
      const base =
        getJobTitle(id)
          .replace(/[^\w\- ()]+/g, "")
          .trim()
          .slice(0, 80) || "sheet-music";
      const stem = ext === ".png" ? `-${path.basename(abs, ext)}` : "";
      headers.set(
        "Content-Disposition",
        `attachment; filename="${base}${stem}${ext}"`,
      );
    }
    const stream = Readable.toWeb(
      fs.createReadStream(abs),
    ) as unknown as BodyInit;
    return new Response(stream, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
