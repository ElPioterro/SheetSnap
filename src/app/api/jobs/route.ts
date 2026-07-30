import { errorResponse } from "@/server/http";
import { listJobs } from "@/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs — recent projects, newest first. */
export async function GET() {
  try {
    return Response.json({ jobs: await listJobs() });
  } catch (e) {
    return errorResponse(e);
  }
}
