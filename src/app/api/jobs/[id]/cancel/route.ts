import { errorResponse } from "@/server/http";
import { cancelJob } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/jobs/[id]/cancel — ask a running job to stop. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    return Response.json({ job: await cancelJob(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
