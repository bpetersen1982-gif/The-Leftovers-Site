import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { BAND_TIME_ZONE, todayInBandTimeZone } from "../dates";
import { env } from "../env";
import { logger } from "../logger";
import { sendEmail } from "../mail/mailer";
import { emailLayout, escapeHtml } from "../mail/templates";
import { can } from "../permissions";
import { removePrivateFiles } from "../photos/files";
import type { ObjectStorage } from "../storage";

/**
 * Periodic photo maintenance:
 * - abandoned uploads (URL expired, file never completed) are deleted with any bytes sent
 * - photos stuck in PROCESSING (the app restarted mid-way) are marked FAILED so the
 *   uploader sees it and can retry
 * - FAILED records are removed after a week (their files are already gone)
 * - once a day, Admins get a digest of photos waiting for review (requirements APR-10)
 *
 * Runs under a Postgres advisory lock, so only one app instance does the work.
 */

const JOB_LOCK_KEY = 4_281_338; // Arbitrary, unique to this job (booking jobs use ...337).
const MINUTE = 60_000;
const ABANDONED_GRACE_MS = 60 * MINUTE;
const STUCK_PROCESSING_MS = 15 * MINUTE;
const FAILED_RETENTION_MS = 7 * 24 * 60 * MINUTE;
/** Digest goes out on the first run at or after this hour, band time. */
export const DIGEST_HOUR = 9;
const DIGEST_JOB = "photo-review-digest";
const BATCH = 200;

export interface PhotoJobResult {
  readonly ran: boolean;
  readonly abandonedRemoved: number;
  readonly stuckFailed: number;
  readonly failedPurged: number;
  readonly digestsSent: number;
}

function bandHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: BAND_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(hour);
}

/** True when today's digest is due and hasn't gone out yet. Claims it in the same transaction. */
async function claimDigest(tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
  if (bandHour(now) < DIGEST_HOUR) return false;
  const state = await tx.jobState.findUnique({ where: { name: DIGEST_JOB } });
  if (state && todayInBandTimeZone(state.lastRunAt) === todayInBandTimeZone(now)) return false;
  await tx.jobState.upsert({ where: { name: DIGEST_JOB }, create: { name: DIGEST_JOB, lastRunAt: now }, update: { lastRunAt: now } });
  return true;
}

export function reviewDigestEmail(to: string, pending: number, oldestDays: number, appUrl: string) {
  const noun = pending === 1 ? "photo is" : "photos are";
  const age = oldestDays >= 1 ? ` The oldest has waited ${oldestDays} day${oldestDays === 1 ? "" : "s"}.` : "";
  const summary = `${pending} ${noun} waiting for your review.${age}`;
  const url = `${appUrl}/admin/photos#review`;
  const footer = "You get this once a day while band members' photos are waiting. Nothing is public until an Admin approves it.";
  return {
    to,
    subject: `${pending} ${pending === 1 ? "photo" : "photos"} to review: The Leftovers`,
    text: `${summary}\n\nReview them:\n${url}\n\n${footer}\n`,
    html: emailLayout({ heading: "Photos to review", body: escapeHtml(summary), actionLabel: "Review photos", actionUrl: url, footer }),
  };
}

async function sendDigest(prisma: PrismaClient, now: Date): Promise<number> {
  const [pending, oldest, admins] = await Promise.all([
    prisma.photo.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.photo.findFirst({ where: { status: "PENDING_REVIEW" }, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
    prisma.user.findMany({ where: { deactivatedAt: null }, select: { email: true, role: true } }),
  ]);
  if (pending === 0) return 0;
  const oldestDays = oldest?.submittedAt ? Math.floor((now.getTime() - oldest.submittedAt.getTime()) / (24 * 60 * MINUTE)) : 0;
  const appUrl = env().APP_URL;
  let sent = 0;
  for (const admin of admins.filter((user) => can(user.role, "photos:review"))) {
    try {
      await sendEmail(reviewDigestEmail(admin.email, pending, oldestDays, appUrl), { kind: "photo-review-digest" });
      sent += 1;
    } catch {
      // sendEmail already logged the failure with context; keep going for the others.
    }
  }
  return sent;
}

export async function runPhotoJobs(prisma: PrismaClient, storage: ObjectStorage | null, now: Date = new Date()): Promise<PhotoJobResult> {
  const work = await prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${JOB_LOCK_KEY}) AS locked`;
    if (!lock?.locked) return null;

    const abandoned = await tx.photo.findMany({
      where: { status: "UPLOADING", uploadExpiresAt: { lt: new Date(now.getTime() - ABANDONED_GRACE_MS) } },
      select: { id: true },
      take: BATCH,
    });
    await tx.photo.deleteMany({ where: { id: { in: abandoned.map((row) => row.id) }, status: "UPLOADING" } });

    const stuck = await tx.photo.findMany({
      where: { status: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_MS) } },
      select: { id: true },
      take: BATCH,
    });
    await tx.photo.updateMany({
      where: { id: { in: stuck.map((row) => row.id) }, status: "PROCESSING" },
      data: { status: "FAILED", failureReason: "Processing was interrupted. Try uploading this photo again.", variants: [], version: { increment: 1 } },
    });

    const purged = await tx.photo.deleteMany({
      where: { status: "FAILED", updatedAt: { lt: new Date(now.getTime() - FAILED_RETENTION_MS) } },
    });
    const digestDue = await claimDigest(tx, now);
    return { removeFilesOf: [...abandoned, ...stuck].map((row) => row.id), abandoned: abandoned.length, stuck: stuck.length, purged: purged.count, digestDue };
  });
  if (!work) return { ran: false, abandonedRemoved: 0, stuckFailed: 0, failedPurged: 0, digestsSent: 0 };

  // Outside the transaction: storage and email are slow and must not hold the lock.
  if (storage) for (const photoId of work.removeFilesOf) await removePrivateFiles(storage, photoId);
  const digestsSent = work.digestDue ? await sendDigest(prisma, now) : 0;

  const result = { ran: true, abandonedRemoved: work.abandoned, stuckFailed: work.stuck, failedPurged: work.purged, digestsSent };
  if (work.abandoned + work.stuck + work.purged + digestsSent > 0) logger.info(result, "photo jobs ran");
  return result;
}
