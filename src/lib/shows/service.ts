import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { EventType, ShowStatus } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { BAND_TIME_ZONE, fromUtc, isIsoDate, toDbDate } from "../dates";
import { can } from "../permissions";
import { slugify } from "../photos/albums";

/**
 * Shows (requirements EVT-1..EVT-4, BOOK-20): the band's gigs. Public shows appear on
 * /shows and in Google event results; private ones (weddings, parties) are band-only.
 * A confirmed booking becomes a show in one click, prefilled from the request.
 */

export type ShowErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "BOOKING_NOT_CONFIRMED";

const MESSAGES: Record<ShowErrorCode, string> = {
  FORBIDDEN: "Only Admins can manage shows.",
  NOT_FOUND: "That show no longer exists.",
  CONFLICT: "Someone else changed this show while you were looking at it. Reload and try again.",
  BOOKING_NOT_CONFIRMED: "Only confirmed bookings with a date can become a show.",
};

export class ShowError extends Error {
  override readonly name = "ShowError";
  constructor(readonly code: ShowErrorCode) {
    super(MESSAGES[code]);
  }
}

export const SHOW_STATUS_LABELS: Record<ShowStatus, string> = {
  SCHEDULED: "Scheduled",
  SOLD_OUT: "Sold out",
  CANCELLED: "Cancelled",
};

/** BOOK-20: weddings and private parties are private by default. */
const PRIVATE_BY_DEFAULT: ReadonlySet<EventType> = new Set(["WEDDING", "PRIVATE_PARTY", "GRADUATION", "CORPORATE"]);

const oneLine = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer`));

const optionalTime = z
  .string()
  .trim()
  .refine((value) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), "Use a time like 21:00.")
  .transform((value) => value || null);

export const showInputSchema = z
  .strictObject({
    date: z.string().trim().refine(isIsoDate, "Pick a date."),
    startTime: optionalTime,
    endTime: optionalTime,
    venueName: oneLine(120, "Venue").pipe(z.string().min(1, "Enter the venue.")),
    street: oneLine(120, "Street"),
    city: oneLine(80, "City").pipe(z.string().min(1, "Enter the city.")),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Use the 2-letter state, like NE."),
    ticketUrl: z
      .string()
      .trim()
      .max(500)
      .refine((value) => value === "" || /^https:\/\/[^\s]+$/.test(value), "Ticket links must start with https://")
      .refine((value) => value === "" || URL.canParse(value), "That link doesn't look right.")
      .transform((value) => value || null),
    priceText: oneLine(60, "Price"),
    description: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n").trim())
      .pipe(z.string().max(1000, "Description must be 1000 characters or fewer")),
    status: z.enum(["SCHEDULED", "SOLD_OUT", "CANCELLED"]),
    isPublic: z.boolean(),
  })
  .refine((value) => value.endTime === null || value.startTime !== null, { path: ["startTime"], message: "Add a start time too." });
export type ShowInput = z.input<typeof showInputSchema>;

export const showRefSchema = z.strictObject({ id: z.uuid(), version: z.coerce.number().int().min(1) });
export type ShowRef = z.infer<typeof showRefSchema>;

function assertCanManage(actor: AuditActor): void {
  if (!can(actor.role, "shows:manage")) throw new ShowError("FORBIDDEN");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

interface Meta {
  readonly requestId?: string | null;
}

function dataFrom(show: z.infer<typeof showInputSchema>) {
  return {
    date: toDbDate(show.date),
    startTime: show.startTime,
    endTime: show.endTime,
    venueName: show.venueName,
    street: show.street,
    city: show.city,
    state: show.state,
    ticketUrl: show.ticketUrl,
    priceText: show.priceText,
    description: show.description,
    status: show.status,
    isPublic: show.isPublic,
  };
}

/** Creates a show with a stable slug ("2026-11-14-zoo-bar", "-2" on a clash). */
async function insertShow(
  prisma: PrismaClient,
  actor: AuditActor,
  show: z.infer<typeof showInputSchema>,
  extra: { bookingRequestId?: string },
  meta: Meta,
): Promise<string> {
  const base = `${show.date}-${slugify(show.venueName)}`.slice(0, 70).replace(/-+$/, "");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = new Set((await prisma.show.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((row) => row.slug));
    let slug = base;
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.show.create({ data: { ...dataFrom(show), slug, createdById: actor.id, ...extra } });
        await writeAudit(tx, {
          actor,
          action: "show.create",
          targetType: "show",
          targetId: created.id,
          after: { slug, date: show.date, venue: show.venueName, isPublic: show.isPublic, bookingRequestId: extra.bookingRequestId ?? null },
          requestId: meta.requestId,
        });
        return created.id;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either the slug was just taken (retry) or this booking already has a show.
      if (extra.bookingRequestId) {
        const existing = await prisma.show.findUnique({ where: { bookingRequestId: extra.bookingRequestId }, select: { id: true } });
        if (existing) return existing.id;
      }
    }
  }
  throw new ShowError("CONFLICT");
}

export async function createShow(prisma: PrismaClient, actor: AuditActor, input: ShowInput, meta: Meta = {}): Promise<string> {
  assertCanManage(actor);
  return insertShow(prisma, actor, showInputSchema.parse(input), {}, meta);
}

export async function updateShow(prisma: PrismaClient, actor: AuditActor, ref: ShowRef, input: ShowInput, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = showRefSchema.parse(ref);
  const show = showInputSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    const before = await tx.show.findUnique({ where: { id: parsedRef.id }, select: { venueName: true, status: true, isPublic: true } });
    if (!before) throw new ShowError("NOT_FOUND");
    const updated = await tx.show.updateMany({ where: { id: parsedRef.id, version: parsedRef.version }, data: { ...dataFrom(show), version: { increment: 1 } } });
    if (updated.count !== 1) throw new ShowError("CONFLICT");
    await writeAudit(tx, {
      actor,
      action: "show.update",
      targetType: "show",
      targetId: parsedRef.id,
      before,
      after: { venueName: show.venueName, status: show.status, isPublic: show.isPublic },
      requestId: meta.requestId,
    });
  });
}

/** Deletes the show; linked albums and videos stay, just unlinked. */
export async function deleteShow(prisma: PrismaClient, actor: AuditActor, ref: ShowRef, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = showRefSchema.parse(ref);
  await prisma.$transaction(async (tx) => {
    const show = await tx.show.findUnique({ where: { id: parsedRef.id }, select: { slug: true, venueName: true } });
    if (!show) throw new ShowError("NOT_FOUND");
    const deleted = await tx.show.deleteMany({ where: { id: parsedRef.id, version: parsedRef.version } });
    if (deleted.count !== 1) throw new ShowError("CONFLICT");
    await writeAudit(tx, { actor, action: "show.delete", targetType: "show", targetId: parsedRef.id, before: show, requestId: meta.requestId });
  });
}

/**
 * BOOK-20: turns a confirmed booking into a show, prefilled from the request. Private by
 * default for weddings and parties. Calling it again returns the same show.
 */
export async function createShowFromBooking(prisma: PrismaClient, actor: AuditActor, bookingRequestId: string, meta: Meta = {}): Promise<string> {
  assertCanManage(actor);
  const id = z.uuid().parse(bookingRequestId);
  const existing = await prisma.show.findUnique({ where: { bookingRequestId: id }, select: { id: true } });
  if (existing) return existing.id;
  const booking = await prisma.bookingRequest.findUnique({ where: { id } });
  if (!booking || booking.status !== "CONFIRMED" || !booking.eventDate) throw new ShowError("BOOKING_NOT_CONFIRMED");
  const isPrivate = booking.eventType !== null && PRIVATE_BY_DEFAULT.has(booking.eventType);
  const show = showInputSchema.parse({
    date: fromUtc(booking.eventDate),
    startTime: booking.startTime ?? "",
    endTime: booking.endTime ?? "",
    venueName: booking.organization || (isPrivate ? "Private event" : booking.contactName),
    // Never copy a private client's street address into a show.
    street: isPrivate ? "" : booking.street,
    city: booking.city || "Lincoln",
    state: /^[A-Za-z]{2}$/.test(booking.state) ? booking.state : "NE",
    ticketUrl: "",
    priceText: "",
    description: "",
    status: "SCHEDULED",
    isPublic: !isPrivate,
  });
  return insertShow(prisma, actor, show, { bookingRequestId: id }, meta);
}

// ---------------------------------------------------------------- time helpers

function localAsUtc(date: string, time: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** The zone's UTC offset in minutes at an instant (e.g. -360 for CST, -300 for CDT). */
function offsetMinutesAt(instant: number, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

/** UTC instant for a local date and time in a time zone (handles daylight saving). */
export function zonedToUtc(date: string, time: string, timeZone: string = BAND_TIME_ZONE): Date {
  const wall = localAsUtc(date, time);
  // Two passes settle the offset when the date is near a daylight-saving change.
  const first = wall - offsetMinutesAt(wall, timeZone) * 60_000;
  return new Date(wall - offsetMinutesAt(first, timeZone) * 60_000);
}

/** ISO 8601 with the local offset, e.g. "2026-11-14T21:00:00-06:00" (for structured data). */
export function zonedIso(date: string, time: string, timeZone: string = BAND_TIME_ZONE): string {
  const offset = Math.round((localAsUtc(date, time) - zonedToUtc(date, time, timeZone).getTime()) / 60_000);
  const abs = Math.abs(offset);
  const sign = offset < 0 ? "-" : "+";
  return `${date}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Show end instant: the end time (after midnight rolls to the next day), or start + 3 hours. */
export function showEndUtc(date: string, startTime: string, endTime: string | null, timeZone: string = BAND_TIME_ZONE): Date {
  const start = zonedToUtc(date, startTime, timeZone);
  if (!endTime) return new Date(start.getTime() + 3 * 3_600_000);
  let end = zonedToUtc(date, endTime, timeZone);
  if (end <= start) end = new Date(end.getTime() + 24 * 3_600_000);
  return end;
}
