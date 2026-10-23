/** Liveness check for Railway: the process is up and serving requests. */
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
