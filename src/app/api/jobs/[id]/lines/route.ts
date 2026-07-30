import type { NextRequest } from "next/server";
import { deleteLine } from "@/server/jobs";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/jobs/[id]/lines?name=NNNN.png
 *
 * Removes one extracted line, drops it from `result.images`, and rebuilds
 * the PDF/ZIP so the next download reflects the change.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const name = req.nextUrl.searchParams.get("name") ?? "";
    const job = await deleteLine(id, name);
    return Response.json({ job });
  } catch (e) {
    return errorResponse(e);
  }
}
