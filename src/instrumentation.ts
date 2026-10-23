/**
 * Next.js startup hook. Starts background jobs in the Node.js server only, and only in
 * production (or when explicitly enabled), never during `next build` or in the browser.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const enabled = process.env.LEFTOVERS_ENV === "production" || process.env.JOBS_ENABLED === "true";
  if (!enabled || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler();
}
