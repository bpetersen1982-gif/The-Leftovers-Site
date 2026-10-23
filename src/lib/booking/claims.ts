import type { Prisma } from "@/generated/prisma/client";
import { type IsoDate, toDbDate } from "../dates";

/**
 * Date claims (one per date, enforced by a unique index). Manual Admin holds carry an
 * expiry (BOOK-17). Expired holds are ignored by every reader and deleted lazily by the
 * next writer for that date, so no background job is needed for correctness.
 */

/** Prisma filter for claims that still count. */
export function liveClaimWhere(now: Date): Prisma.DateClaimWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/**
 * Deletes the claim for a date if it's an expired hold, and notes it on the request's
 * history. Call inside the same transaction that's about to claim the date.
 */
export async function purgeExpiredClaim(tx: Prisma.TransactionClient, date: IsoDate, now: Date): Promise<void> {
  const claim = await tx.dateClaim.findUnique({ where: { date: toDbDate(date) } });
  if (!claim?.expiresAt || claim.expiresAt > now) return;
  await tx.dateClaim.delete({ where: { id: claim.id } });
  await tx.bookingEvent.create({
    data: { requestId: claim.requestId, kind: "NOTE", body: "Hold expired; the date was released.", createdAt: now },
  });
}

/** The live claim for a date (after purging an expired hold), or null. */
export async function liveClaimFor(tx: Prisma.TransactionClient, date: IsoDate, now: Date) {
  await purgeExpiredClaim(tx, date, now);
  return tx.dateClaim.findUnique({ where: { date: toDbDate(date) } });
}
