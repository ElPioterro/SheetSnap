import { JOBS_DIR, ensureDir } from "@/server/config";

export const dynamic = "force-dynamic";

/**
 * Health check — no external services involved: the app is healthy when
 * its data directory is usable.
 */
export async function GET() {
  try {
    ensureDir(JOBS_DIR);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
