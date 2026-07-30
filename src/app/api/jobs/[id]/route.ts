import { errorResponse } from "@/server/http";
import { getJobDTO } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs/[id] — full job state, merged with live progress. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    return Response.json({ job: await getJobDTO(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
