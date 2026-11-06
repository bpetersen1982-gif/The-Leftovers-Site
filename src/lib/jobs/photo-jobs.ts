import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { BAND_TIME_ZONE, todayInBandTimeZone } from "../dates";
import { env } from "../env";
import { logger } from "../logger";
import { sendEmail } from "../mail/mailer";
import { emailLayout, escapeHtml } from "../mail/templates";
import { can } from "../permissions";
import { releaseStalledFanPhotos } from "../fan/service";
import { removePrivateFiles } from "../photos/files";
import type { ObjectStorage } from "../storage";

/**
 * Periodic photo maintenance:
 * - abandoned uploads (URL expired, file never completed) are deleted with any bytes sent
 * - photos stuck in PROCESSING (the app restarted mid-way) are marked FAILED so the
 *   uploader sees it and can retry
 * - FAILED records are removed after a week (their files are already gone)
 * - fan posts whose photo upload never finished go to moderation as text only
 * - once a day, each band member gets one email listing what's waiting on them: Members
 *   see fan posts; Admins also see photos to review and photos Members took down (APR-10)
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
  /** Fan posts whose photo never arrived, sent to moderation as text only. */
  readonly fanPhotosReleased: number;
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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface DigestCounts {
  /** Band members' photos waiting for an Admin. */
  readonly photos: number;
  readonly oldestPhotoDays: number;
  /** Published photos band members took off the site. */
  readonly removals: number;
  /** Fan Wall posts waiting for a band member. */
  readonly fanPosts: number;
}

/** One email per person per day listing what's waiting on them (requirements APR-10). */
export function reviewDigestEmail(to: string, counts: DigestCounts, appUrl: string) {
  const lines: { text: string; url: string; subject: string }[] = [];
  if (counts.fanPosts > 0) {
    lines.push({
      text: `${plural(counts.fanPosts, "fan post is", "fan posts are")} waiting on the Fan Wall.`,
      url: `${appUrl}/admin/fan-wall`,
      subject: `${plural(counts.fanPosts, "fan post", "fan posts")} to review`,
    });
  }
  if (counts.photos > 0) {
    const age = counts.oldestPhotoDays >= 1 ? ` The oldest has waited ${plural(counts.oldestPhotoDays, "day", "days")}.` : "";
    lines.push({
      text: `${plural(counts.photos, "photo is", "photos are")} waiting for your review.${age}`,
      url: `${appUrl}/admin/photos#review`,
      subject: `${plural(counts.photos, "photo", "photos")} to review`,
    });
  }
  if (counts.removals > 0) {
    const them = counts.removals === 1 ? "it" : "them";
    lines.push({
      text: `Band members took ${plural(counts.removals, "photo", "photos")} off the site. Delete ${them} for good or put ${them} back.`,
      url: `${appUrl}/admin/photos#removed`,
      subject: `${plural(counts.removals, "photo", "photos")} taken off the site`,
    });
  }
  const single = lines.length === 1 ? lines[0] : undefined;
  const subject = single ? single.subject : `${plural(lines.length, "thing", "things")} to review`;
  const url = single ? single.url : `${appUrl}/admin`;
  const footer = "You get this once a day while something needs the band. Nothing fans or band members send is public until it's approved.";
  const text = lines.map((line) => `${line.text}\n${line.url}`).join("\n\n");
  const body = lines.map((line) => escapeHtml(line.text)).join("<br><br>");
  return {
    to,
    subject: `${subject}: The Leftovers`,
    text: `${text}\n\n${footer}\n`,
    html: emailLayout({ heading: "Waiting for the band", body, actionLabel: single ? "Review" : "Open the band site", actionUrl: url, footer }),
  };
}

async function sendDigest(prisma: PrismaClient, now: Date): Promise<number> {
  const [photosPending, removals, fanPosts, oldest, users] = await Promise.all([
    prisma.photo.count({ where: { status: "PENDING_REVIEW" } }),
    // Admin removals don't need a reminder: the Admin who did it already knows.
    prisma.photo.count({ where: { status: "DELETION_REQUESTED", removalRequestedByRole: "MEMBER" } }),
    prisma.fanPost.count({ where: { status: "PENDING" } }),
    prisma.photo.findFirst({ where: { status: "PENDING_REVIEW" }, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
    prisma.user.findMany({ where: { deactivatedAt: null }, select: { email: true, role: true } }),
  ]);
  const oldestPhotoDays = oldest?.submittedAt ? Math.floor((now.getTime() - oldest.submittedAt.getTime()) / (24 * 60 * MINUTE)) : 0;
  const appUrl = env().APP_URL;
  let sent = 0;
  for (const user of users) {
    // Admins: everything. Members: fan content only (APR-10).
    const reviewsPhotos = can(user.role, "photos:review");
    const counts: DigestCounts = {
      photos: reviewsPhotos ? photosPending : 0,
      oldestPhotoDays,
      removals: reviewsPhotos ? removals : 0,
      fanPosts: can(user.role, "fan:moderate") ? fanPosts : 0,
    };
    if (counts.photos + counts.removals + counts.fanPosts === 0) continue;
    try {
      await sendEmail(reviewDigestEmail(user.email, counts, appUrl), { kind: "review-digest" });
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
  if (!work) return { ran: false, abandonedRemoved: 0, stuckFailed: 0, failedPurged: 0, digestsSent: 0, fanPhotosReleased: 0 };

  // Outside the transaction: storage and email are slow and must not hold the lock.
  if (storage) for (const photoId of work.removeFilesOf) await removePrivateFiles(storage, photoId);
  const fanPhotosReleased = await releaseStalledFanPhotos({ prisma, storage }, now);
  const digestsSent = work.digestDue ? await sendDigest(prisma, now) : 0;

  const result = { ran: true, abandonedRemoved: work.abandoned, stuckFailed: work.stuck, failedPurged: work.purged, digestsSent, fanPhotosReleased };
  if (work.abandoned + work.stuck + work.purged + digestsSent + fanPhotosReleased > 0) logger.info(result, "photo jobs ran");
  return result;
}
