import { errorResponse } from "@/server/http";
import { getJobDTO, rebuildArtifacts } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/[id]/rebuild
 *
 * Regenerate result.pdf and result.zip from the lines currently on disk.
 * Kept separate from DELETE /lines so that deleting a line stays instant —
 * the UI fires this in the background once the user pauses pruning.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    await rebuildArtifacts(id);
    return Response.json({ job: getJobDTO(id) });
  } catch (e) {
    return errorResponse(e);
  }
}
