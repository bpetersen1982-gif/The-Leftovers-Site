import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { BookingStatus, Role } from "@/generated/prisma/enums";
import { type IsoDate, fromUtc } from "../dates";
import { can } from "../permissions";
import { EVENT_TYPE_LABELS, type IneligibleReason, INELIGIBLE_REASON_LABELS } from "./eligibility";

/**
 * Booking inbox reads (requirements BOOK-12, BOOK-14). Financial fields are removed at
 * the query layer for viewers without booking:viewFinancials, not hidden in the UI.
 */

export const STATUS_LABELS: Record<BookingStatus, string> = {
  IN_PROGRESS: "Unfinished",
  AWAITING_CONTACT: "Needs contact",
  QUOTED: "Quoted",
  ACCEPTED: "Accepted: confirm",
  DECLINED_BY_PROSPECT: "Declined by them",
  CONTACTED: "Contacted",
  CONFIRMED: "Booked",
  DECLINED_BY_BAND: "Declined by band",
  WITHDRAWN: "Withdrawn",
  RELEASED: "Released",
  CANCELLED: "Cancelled",
};

export const INBOX_FILTERS = {
  active: { label: "Needs action", statuses: ["ACCEPTED", "AWAITING_CONTACT", "CONTACTED"] },
  quoted: { label: "Quoted", statuses: ["QUOTED"] },
  booked: { label: "Booked", statuses: ["CONFIRMED"] },
  closed: { label: "Closed", statuses: ["DECLINED_BY_PROSPECT", "DECLINED_BY_BAND", "WITHDRAWN", "RELEASED", "CANCELLED"] },
  unfinished: { label: "Unfinished", statuses: ["IN_PROGRESS"] },
} as const satisfies Record<string, { label: string; statuses: readonly BookingStatus[] }>;

export type InboxFilter = keyof typeof INBOX_FILTERS;

export function isInboxFilter(value: string): value is InboxFilter {
  return value in INBOX_FILTERS;
}

export interface InboxRow {
  readonly id: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly statusLabel: string;
  readonly isConflict: boolean;
  readonly eventDate: IsoDate | null;
  readonly eventTypeLabel: string;
  readonly sets: number | null;
  readonly contactName: string;
  readonly organization: string;
  readonly place: string;
  readonly createdAt: Date;
  /** Null unless the viewer may see money. */
  readonly totalCents: number | null;
  readonly quoteExpired: boolean;
}

export async function listInbox(prisma: PrismaClient, viewer: { role: Role }, filter: InboxFilter, now: Date = new Date()): Promise<InboxRow[]> {
  const showMoney = can(viewer.role, "booking:viewFinancials");
  const where: Prisma.BookingRequestWhereInput = { status: { in: [...INBOX_FILTERS[filter].statuses] } };
  const rows = await prisma.bookingRequest.findMany({
    where,
    orderBy: [{ eventDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    include: { quotes: { where: { supersededAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return rows.map((row) => {
    const quote = row.quotes[0];
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      isConflict: row.isConflict,
      eventDate: row.eventDate ? fromUtc(row.eventDate) : null,
      eventTypeLabel: row.eventType ? EVENT_TYPE_LABELS[row.eventType] : "—",
      sets: row.sets,
      contactName: row.contactName,
      organization: row.organization,
      place: [row.city, row.state].filter(Boolean).join(", "),
      createdAt: row.createdAt,
      totalCents: showMoney && quote ? quote.totalCents : null,
      quoteExpired: row.status === "QUOTED" && quote !== undefined && quote.expiresAt <= now,
    };
  });
}

export interface InboxDetail extends InboxRow {
  readonly kind: "WIZARD" | "DATE_CONTACT";
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly email: string;
  readonly phone: string;
  readonly street: string;
  readonly zip: string;
  readonly attendance: number | null;
  readonly setting: string | null;
  readonly soundProvided: string | null;
  readonly message: string;
  readonly responseNote: string;
  readonly distanceMiles: number | null;
  readonly ineligibleReasons: readonly string[];
  readonly quote: { ratePerSetCents: number; sets: number; totalCents: number; expiresAt: Date } | null;
  readonly claim: { kind: "PENDING" | "BOOKED" } | null;
  readonly sameDate: readonly { id: string; reference: string; statusLabel: string; contactName: string; eventTypeLabel: string }[];
  readonly timeline: readonly { id: string; kind: string; body: string; fromStatus: string | null; toStatus: string | null; authorName: string; createdAt: Date }[];
}

export async function getInboxDetail(prisma: PrismaClient, viewer: { role: Role }, id: string, now: Date = new Date()): Promise<InboxDetail | null> {
  const showMoney = can(viewer.role, "booking:viewFinancials");
  const row = await prisma.bookingRequest.findUnique({
    where: { id },
    include: {
      quotes: { where: { supersededAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
      claim: { select: { kind: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) return null;

  const authorIds = [...new Set(row.events.map((event) => event.authorId).filter((value): value is string => value !== null))];
  const [authors, sameDate] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }),
    row.eventDate
      ? prisma.bookingRequest.findMany({
          where: { eventDate: row.eventDate, id: { not: row.id }, status: { not: "IN_PROGRESS" } },
          orderBy: { createdAt: "asc" },
          select: { id: true, reference: true, status: true, contactName: true, eventType: true },
        })
      : Promise.resolve([]),
  ]);
  const names = new Map(authors.map((author) => [author.id, author.name]));
  const quote = row.quotes[0];

  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    isConflict: row.isConflict,
    eventDate: row.eventDate ? fromUtc(row.eventDate) : null,
    eventTypeLabel: row.eventType ? EVENT_TYPE_LABELS[row.eventType] : "—",
    sets: row.sets,
    startTime: row.startTime,
    endTime: row.endTime,
    contactName: row.contactName,
    organization: row.organization,
    email: row.email,
    phone: row.phone,
    street: row.street,
    zip: row.zip,
    place: [row.city, row.state].filter(Boolean).join(", "),
    attendance: row.attendance,
    setting: row.setting,
    soundProvided: row.soundProvided,
    message: row.message,
    responseNote: row.responseNote,
    distanceMiles: row.distanceMiles,
    ineligibleReasons: row.ineligibleReasons.map((reason) => INELIGIBLE_REASON_LABELS[reason as IneligibleReason] ?? reason),
    createdAt: row.createdAt,
    totalCents: showMoney && quote ? quote.totalCents : null,
    quote: showMoney && quote ? { ratePerSetCents: quote.ratePerSetCents, sets: quote.sets, totalCents: quote.totalCents, expiresAt: quote.expiresAt } : null,
    quoteExpired: row.status === "QUOTED" && quote !== undefined && quote.expiresAt <= now,
    claim: row.claim,
    sameDate: sameDate.map((other) => ({
      id: other.id,
      reference: other.reference,
      statusLabel: STATUS_LABELS[other.status],
      contactName: other.contactName,
      eventTypeLabel: other.eventType ? EVENT_TYPE_LABELS[other.eventType] : "—",
    })),
    timeline: row.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      body: event.body,
      fromStatus: event.fromStatus ? STATUS_LABELS[event.fromStatus] : null,
      toStatus: event.toStatus ? STATUS_LABELS[event.toStatus] : null,
      authorName: event.authorId ? (names.get(event.authorId) ?? "Former member") : "Prospect / system",
      createdAt: event.createdAt,
    })),
  };
}

/** Counts for the admin home badge. */
export async function countNeedsAction(prisma: PrismaClient): Promise<number> {
  return prisma.bookingRequest.count({ where: { status: { in: [...INBOX_FILTERS.active.statuses] } } });
}

