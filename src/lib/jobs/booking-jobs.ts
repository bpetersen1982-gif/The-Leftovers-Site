import type { PrismaClient } from "@/generated/prisma/client";
import { type BandEvent, notifyBand } from "../booking/notifications";
import { logger } from "../logger";

/**
 * Periodic booking maintenance (requirements BOOK-17, BOOK-24):
 * - remind Admins when an accepted quote waits 24h / 72h for confirmation
 * - warn Admins a day before a manual hold expires
 * - delete unfinished wizard drafts older than 90 days (personal data minimization)
 *
 * Safe to run from several app instances at once: a transaction-scoped Postgres advisory
 * lock lets only one run do the work, and items are marked before notifying, so each
 * reminder is sent at most once.
 */

const JOB_LOCK_KEY = 4_281_337; // Arbitrary, unique to this job.
const HOUR = 3_600_000;
const DRAFT_RETENTION_DAYS = 90;

export interface BookingJobResult {
  readonly ran: boolean;
  readonly reminders24: number;
  readonly reminders72: number;
  readonly holdWarnings: number;
  readonly draftsPurged: number;
}

export async function runBookingJobs(prisma: PrismaClient, now: Date = new Date()): Promise<BookingJobResult> {
  const work = await prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${JOB_LOCK_KEY}) AS locked`;
    if (!lock?.locked) return null;

    const due72 = await tx.bookingRequest.findMany({
      where: { status: "ACCEPTED", respondedAt: { lte: new Date(now.getTime() - 72 * HOUR) }, reminder72SentAt: null },
      select: { id: true },
    });
    // A request that's already 72h old (e.g. after downtime) gets only the 72h reminder.
    await tx.bookingRequest.updateMany({
      where: { id: { in: due72.map((row) => row.id) } },
      data: { reminder72SentAt: now, reminder24SentAt: now },
    });
    const due24 = await tx.bookingRequest.findMany({
      where: { status: "ACCEPTED", respondedAt: { lte: new Date(now.getTime() - 24 * HOUR) }, reminder24SentAt: null },
      select: { id: true },
    });
    await tx.bookingRequest.updateMany({ where: { id: { in: due24.map((row) => row.id) } }, data: { reminder24SentAt: now } });

    const expiring = await tx.dateClaim.findMany({
      where: { kind: "PENDING", expiresAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) }, expiryWarnedAt: null },
      select: { id: true, requestId: true },
    });
    await tx.dateClaim.updateMany({ where: { id: { in: expiring.map((row) => row.id) } }, data: { expiryWarnedAt: now } });

    const purged = await tx.bookingRequest.deleteMany({
      where: { status: "IN_PROGRESS", createdAt: { lt: new Date(now.getTime() - DRAFT_RETENTION_DAYS * 24 * HOUR) } },
    });

    return {
      notifications: [
        ...due72.map((row) => ({ event: "REMINDER_72H" as BandEvent, requestId: row.id })),
        ...due24.map((row) => ({ event: "REMINDER_24H" as BandEvent, requestId: row.id })),
        ...expiring.map((row) => ({ event: "HOLD_EXPIRING" as BandEvent, requestId: row.requestId })),
      ],
      counts: { reminders24: due24.length, reminders72: due72.length, holdWarnings: expiring.length, draftsPurged: purged.count },
    };
  });

  if (!work) return { ran: false, reminders24: 0, reminders72: 0, holdWarnings: 0, draftsPurged: 0 };
  // Outside the transaction: email/push can be slow and must never hold the lock or roll back marks.
  for (const item of work.notifications) await notifyBand(prisma, item.event, item.requestId);
  if (work.notifications.length > 0 || work.counts.draftsPurged > 0) logger.info(work.counts, "booking jobs ran");
  return { ran: true, ...work.counts };
}
