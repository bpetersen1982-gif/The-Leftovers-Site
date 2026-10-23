import type { PrismaClient } from "@/generated/prisma/client";
import type { BookingStatus } from "@/generated/prisma/enums";
import { type IsoDate, fromUtc } from "../dates";
import { EVENT_TYPE_LABELS } from "./eligibility";

/**
 * Booking funnel (requirements FUN-1..FUN-4, Admin only): prospects who declined a quote,
 * let it expire, or left the form after giving contact details, so the band can follow up
 * or rethink pricing.
 */

export interface FunnelRow {
  readonly id: string;
  readonly reference: string;
  readonly eventDate: IsoDate | null;
  readonly eventTypeLabel: string;
  readonly contactName: string;
  readonly email: string;
  readonly phone: string;
  readonly organization: string;
  readonly totalCents: number | null;
  readonly note: string;
  readonly at: Date;
}

/** Unfinished wizards older than this count as abandoned (the person isn't mid-form). */
const ABANDONED_AFTER_MS = 60 * 60_000;
const MONTHS = 6;

export interface MonthSummary {
  readonly month: string;
  readonly requests: number;
  readonly quoted: number;
  readonly accepted: number;
  readonly declined: number;
  readonly confirmed: number;
  readonly abandoned: number;
}

const ACCEPTED_OR_LATER: readonly BookingStatus[] = ["ACCEPTED", "CONFIRMED", "CANCELLED", "RELEASED"];

export async function getFunnel(prisma: PrismaClient, now: Date = new Date()) {
  const include = { quotes: { orderBy: { createdAt: "desc" as const }, take: 1 } };
  const [declined, quoted, abandoned, recent] = await Promise.all([
    prisma.bookingRequest.findMany({ where: { status: "DECLINED_BY_PROSPECT" }, orderBy: { respondedAt: "desc" }, take: 100, include }),
    prisma.bookingRequest.findMany({ where: { status: "QUOTED" }, orderBy: { updatedAt: "desc" }, take: 200, include }),
    prisma.bookingRequest.findMany({
      where: { status: "IN_PROGRESS", createdAt: { lt: new Date(now.getTime() - ABANDONED_AFTER_MS) } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include,
    }),
    prisma.bookingRequest.findMany({
      where: { createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1)) } },
      select: { status: true, createdAt: true, quotes: { select: { id: true }, take: 1 } },
    }),
  ]);

  const toRow = (row: (typeof declined)[number], at: Date | null): FunnelRow => ({
    id: row.id,
    reference: row.reference,
    eventDate: row.eventDate ? fromUtc(row.eventDate) : null,
    eventTypeLabel: row.eventType ? EVENT_TYPE_LABELS[row.eventType] : "—",
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    organization: row.organization,
    totalCents: row.quotes[0]?.totalCents ?? null,
    note: row.responseNote,
    at: at ?? row.updatedAt,
  });

  const expired = quoted.filter((row) => row.quotes[0] && row.quotes[0].expiresAt <= now);

  const months = new Map<string, { requests: number; quoted: number; accepted: number; declined: number; confirmed: number; abandoned: number }>();
  for (let offset = MONTHS - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.set(date.toISOString().slice(0, 7), { requests: 0, quoted: 0, accepted: 0, declined: 0, confirmed: 0, abandoned: 0 });
  }
  for (const row of recent) {
    const bucket = months.get(row.createdAt.toISOString().slice(0, 7));
    if (!bucket) continue;
    if (row.status === "IN_PROGRESS") {
      bucket.abandoned += 1;
      continue;
    }
    bucket.requests += 1;
    if (row.quotes.length > 0) bucket.quoted += 1;
    if (ACCEPTED_OR_LATER.includes(row.status)) bucket.accepted += 1;
    if (row.status === "DECLINED_BY_PROSPECT") bucket.declined += 1;
    if (row.status === "CONFIRMED") bucket.confirmed += 1;
  }

  return {
    declined: declined.map((row) => toRow(row, row.respondedAt)),
    expired: expired.map((row) => toRow(row, row.quotes[0]?.expiresAt ?? null)),
    abandoned: abandoned.map((row) => toRow(row, row.createdAt)),
    months: [...months.entries()].map(([month, counts]): MonthSummary => ({ month, ...counts })),
  };
}
