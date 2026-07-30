import { errorResponse } from "@/server/http";
import { startProcessing } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/[id]/process { crop, frameSkip, similarityThreshold, bw,
 * startTime, title } — kicks off the extraction pipeline in the background.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const job = await startProcessing(id, body);
    return Response.json({ job });
  } catch (e) {
    return errorResponse(e);
  }
}
