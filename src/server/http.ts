import { ApiError } from "@/lib/types";

/** Uniform JSON error shape for all API routes: { error: { code, message } }. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error("[api]", err);
  return Response.json(
    { error: { code: "INTERNAL", message } },
    { status: 500 },
  );
}
