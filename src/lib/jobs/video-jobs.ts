import { logger } from "../logger";
import { lockOnStream, syncFromStream, type VideoDeps } from "../video/service";

/**
 * Periodic video maintenance:
 * - polls Stream for uploads still in progress, in case a webhook was missed (or can't
 *   reach the app, e.g. locally)
 * - fails and deletes uploads that never finished before their upload URL expired
 * - re-locks any video that's public on Stream but not published here (a failed API call)
 * - removes FAILED records after a week (their Stream copies are already deleted)
 *
 * Runs under a Postgres advisory lock so only one app instance does the work.
 */

const JOB_LOCK_KEY = 4_281_339; // Arbitrary, unique to this job.
const MINUTE = 60_000;
/** Don't poll videos the webhook may be about to update. */
const POLL_AFTER_MS = 2 * MINUTE;
/** Give an in-flight publish time to finish before treating the flag as drift. */
const DRIFT_AFTER_MS = 5 * MINUTE;
const FAILED_RETENTION_MS = 7 * 24 * 60 * MINUTE;
const BATCH = 50;

export interface VideoJobResult {
  readonly ran: boolean;
  readonly polled: number;
  readonly expired: number;
  readonly relocked: number;
  readonly failedPurged: number;
}

export async function runVideoJobs(deps: VideoDeps, now: Date = new Date()): Promise<VideoJobResult> {
  const { prisma, stream } = deps;
  // The transaction only holds the advisory lock (released when it ends); the work below
  // uses ordinary queries so Stream calls never run inside a database transaction's writes.
  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${JOB_LOCK_KEY}) AS locked`;
      if (!lock?.locked) return { ran: false, polled: 0, expired: 0, relocked: 0, failedPurged: 0 };

      let polled = 0;
      let expired = 0;
      const pending = await prisma.video.findMany({
        where: { status: { in: ["UPLOADING", "PROCESSING"] }, updatedAt: { lt: new Date(now.getTime() - POLL_AFTER_MS) } },
        orderBy: { updatedAt: "asc" },
        take: BATCH,
      });
      for (const video of pending) {
        try {
          const reported = await stream.getVideo(video.streamUid);
          const stillWaiting = !reported || reported.status.state === "pendingupload";
          if (stillWaiting && video.status === "UPLOADING" && video.uploadExpiresAt < now) {
            await prisma.video.updateMany({
              where: { id: video.id, status: "UPLOADING" },
              data: { status: "FAILED", failureReason: "The upload didn't finish in time. Try again.", version: { increment: 1 } },
            });
            await stream.deleteVideo(video.streamUid);
            expired += 1;
          } else if (reported) {
            await syncFromStream(deps, video.id, reported);
            polled += 1;
          }
        } catch (error) {
          logger.warn({ err: error, videoId: video.id }, "video poll failed; will retry");
        }
      }

      const drifted = await prisma.video.findMany({
        where: { streamPublic: true, status: { not: "PUBLISHED" }, updatedAt: { lt: new Date(now.getTime() - DRIFT_AFTER_MS) } },
        select: { id: true, streamUid: true },
        take: BATCH,
      });
      let relocked = 0;
      for (const video of drifted) if (await lockOnStream(deps, video)) relocked += 1;

      const purged = await prisma.video.deleteMany({ where: { status: "FAILED", updatedAt: { lt: new Date(now.getTime() - FAILED_RETENTION_MS) } } });

      const result = { ran: true, polled, expired, relocked, failedPurged: purged.count };
      if (polled + expired + relocked + purged.count > 0) logger.info(result, "video jobs ran");
      return result;
    },
    // Stream calls inside: allow a few minutes for a full batch.
    { timeout: 5 * MINUTE, maxWait: 10_000 },
  );
}

