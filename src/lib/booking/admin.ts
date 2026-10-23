import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { BookingStatus } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { type IsoDate, fromUtc, toDbDate } from "../dates";
import { can } from "../permissions";
import { liveClaimFor } from "./claims";
import { dayCategoryOf } from "./eligibility";
import { getPricing } from "./pricing";
import { eventDateSchema, timeSchema } from "./validation";

/**
 * Band-side booking actions (requirements BOOK-10, BOOK-13, BOOK-15, BOOK-17, BOOK-18,
 * OVR-1..OVR-4). All writes are optimistic-concurrency checked against the request's
 * version (two Admins acting at once can't both succeed), and every claim change happens
 * in the same transaction as the status change.
 */

export type BookingAdminErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID_STATE" | "NEEDS_OVERRIDE" | "NO_DATE" | "FORBIDDEN";

export class BookingAdminError extends Error {
  override readonly name = "BookingAdminError";
  constructor(
    readonly code: BookingAdminErrorCode,
    message: string,
    /** For NEEDS_OVERRIDE: the request currently holding the date. */
    readonly holder?: { id: string; reference: string; contactName: string; status: BookingStatus },
  ) {
    super(message);
  }
}

const STALE = "Someone else updated this request while you were looking at it. Reload and try again.";

interface Meta {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly version: number;
  readonly httpRequestId?: string | null;
}

type Tx = Prisma.TransactionClient;

async function loadForUpdate(tx: Tx, input: Meta) {
  const request = await tx.bookingRequest.findUnique({ where: { id: input.requestId }, include: { claim: true } });
  if (!request) throw new BookingAdminError("NOT_FOUND", "That request no longer exists.");
  if (request.version !== input.version) throw new BookingAdminError("CONFLICT", STALE);
  return request;
}

/** Bumps the version only if nobody else did first. */
async function updateVersioned(tx: Tx, input: Meta, data: Prisma.BookingRequestUpdateManyMutationInput): Promise<void> {
  const updated = await tx.bookingRequest.updateMany({
    where: { id: input.requestId, version: input.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new BookingAdminError("CONFLICT", STALE);
}

async function statusEvent(tx: Tx, requestId: string, actorId: string, from: BookingStatus, to: BookingStatus, body = "", now = new Date()) {
  await tx.bookingEvent.create({ data: { requestId, kind: "STATUS", fromStatus: from, toStatus: to, body, authorId: actorId, createdAt: now } });
}

/**
 * Makes `requestId` the holder of `date`. If another request holds it, either refuse
 * (NEEDS_OVERRIDE) or, with an override reason, release that request in this transaction.
 */
async function takeDate(
  tx: Tx,
  input: { actor: AuditActor; requestId: string; date: IsoDate; kind: "PENDING" | "BOOKED"; expiresAt: Date | null; overrideReason?: string; now: Date; httpRequestId?: string | null },
): Promise<{ releasedRequestId: string | null }> {
  let releasedRequestId: string | null = null;
  const existing = await liveClaimFor(tx, input.date, input.now);
  if (existing && existing.requestId !== input.requestId) {
    const holder = await tx.bookingRequest.findUniqueOrThrow({ where: { id: existing.requestId } });
    if (!input.overrideReason) {
      throw new BookingAdminError(
        "NEEDS_OVERRIDE",
        `This date is already ${existing.kind === "BOOKED" ? "booked" : "pending"} for ${holder.contactName} (${holder.reference}). Override to replace it.`,
        { id: holder.id, reference: holder.reference, contactName: holder.contactName, status: holder.status },
      );
    }
    // OVR-1/OVR-4: release the other request and take the date in one transaction.
    await tx.dateClaim.delete({ where: { id: existing.id } });
    await tx.bookingRequest.update({ where: { id: holder.id }, data: { status: "RELEASED", isConflict: true, version: { increment: 1 } } });
    await statusEvent(tx, holder.id, input.actor.id, holder.status, "RELEASED", `Released by override: ${input.overrideReason}`, input.now);
    await writeAudit(tx, {
      actor: input.actor,
      action: "booking.override",
      targetType: "bookingRequest",
      targetId: input.requestId,
      before: { holder: holder.reference, holderStatus: holder.status },
      after: { date: input.date, reason: input.overrideReason },
      requestId: input.httpRequestId,
    });
    releasedRequestId = holder.id;
  }
  // If this request held a different date (date changed), let that one go.
  await tx.dateClaim.deleteMany({ where: { requestId: input.requestId, date: { not: toDbDate(input.date) } } });
  await tx.dateClaim.upsert({
    where: { date: toDbDate(input.date) },
    create: { date: toDbDate(input.date), kind: input.kind, requestId: input.requestId, expiresAt: input.expiresAt, createdById: input.actor.id },
    update: { kind: input.kind, requestId: input.requestId, expiresAt: input.expiresAt },
  });
  return { releasedRequestId };
}

// ---------------------------------------------------------------- notes & contact log

export async function addBookingNote(
  prisma: PrismaClient,
  input: { actor: AuditActor; requestId: string; kind: "NOTE" | "CONTACTED"; body: string },
  now: Date = new Date(),
): Promise<void> {
  if (!can(input.actor.role, "booking:addNote")) throw new BookingAdminError("FORBIDDEN", "Not allowed.");
  await prisma.$transaction(async (tx) => {
    const request = await tx.bookingRequest.findUnique({ where: { id: input.requestId }, select: { status: true } });
    if (!request) throw new BookingAdminError("NOT_FOUND", "That request no longer exists.");
    await tx.bookingEvent.create({ data: { requestId: input.requestId, kind: input.kind, body: input.body, authorId: input.actor.id, createdAt: now } });
    // Logging contact moves "needs contact" forward so nobody double-calls (BOOK-13).
    if (input.kind === "CONTACTED" && request.status === "AWAITING_CONTACT") {
      await tx.bookingRequest.update({ where: { id: input.requestId }, data: { status: "CONTACTED", version: { increment: 1 } } });
      await statusEvent(tx, input.requestId, input.actor.id, "AWAITING_CONTACT", "CONTACTED", "", now);
    }
  });
}

/** Records an email sent to the prospect from the site in the request's history. */
export async function recordEmail(prisma: PrismaClient, input: { actorId: string; requestId: string; subject: string; body: string }): Promise<void> {
  await prisma.bookingEvent.create({
    data: { requestId: input.requestId, kind: "EMAIL", body: `${input.subject}\n\n${input.body}`, authorId: input.actorId },
  });
}

// ---------------------------------------------------------------- confirm

export function confirmInputSchema(today: IsoDate) {
  return z.strictObject({
    eventDate: eventDateSchema(today),
    startTime: timeSchema,
    endTime: timeSchema,
    loadInTime: z.union([z.literal(""), timeSchema]).transform((value) => value || null),
    sets: z.coerce.number().int().min(1, "At least 1 set").max(8, "At most 8 sets"),
    agreedPrice: z
      .string()
      .trim()
      .transform((value) => value.replace(/[$,\s]/g, ""))
      .refine((value) => /^\d{1,6}$/.test(value), "Whole dollars (e.g. 1200)")
      .transform((value) => Number(value) * 100),
    note: z.string().trim().max(1_000).default(""),
    overrideReason: z.string().trim().max(300).optional(),
  });
}

export type ConfirmInput = z.infer<ReturnType<typeof confirmInputSchema>>;

const CONFIRMABLE: readonly BookingStatus[] = ["ACCEPTED", "AWAITING_CONTACT", "CONTACTED", "QUOTED", "CONFIRMED"];

/** BOOK-15: only Admins confirm. Marks the date Booked. Re-confirming a booking edits its details. */
export async function confirmBooking(
  prisma: PrismaClient,
  input: Meta & { details: ConfirmInput },
  now: Date = new Date(),
): Promise<{ releasedRequestId: string | null }> {
  if (!can(input.actor.role, "booking:manage")) throw new BookingAdminError("FORBIDDEN", "Only Admins can confirm bookings.");
  return prisma.$transaction(async (tx) => {
    const request = await loadForUpdate(tx, input);
    if (!CONFIRMABLE.includes(request.status)) {
      throw new BookingAdminError("INVALID_STATE", "This request is closed. Reopen it by sending a new quote first.");
    }
    const { details } = input;
    const result = await takeDate(tx, {
      actor: input.actor,
      requestId: request.id,
      date: details.eventDate,
      kind: "BOOKED",
      expiresAt: null,
      overrideReason: details.overrideReason || undefined,
      now,
      httpRequestId: input.httpRequestId,
    });
    await updateVersioned(tx, input, {
      status: "CONFIRMED",
      eventDate: toDbDate(details.eventDate),
      startTime: details.startTime,
      endTime: details.endTime,
      loadInTime: details.loadInTime,
      sets: details.sets,
      agreedPriceCents: details.agreedPrice,
      confirmedAt: now,
      confirmedById: input.actor.id,
    });
    await statusEvent(tx, request.id, input.actor.id, request.status, "CONFIRMED", details.note, now);
    await writeAudit(tx, {
      actor: input.actor,
      action: "booking.confirm",
      targetType: "bookingRequest",
      targetId: request.id,
      before: { status: request.status, eventDate: request.eventDate ? fromUtc(request.eventDate) : null },
      after: { status: "CONFIRMED", eventDate: details.eventDate, sets: details.sets, agreedPriceCents: details.agreedPrice },
      requestId: input.httpRequestId,
    });
    return result;
  });
}

// ---------------------------------------------------------------- decline / cancel

const DECLINABLE: readonly BookingStatus[] = ["AWAITING_CONTACT", "CONTACTED", "QUOTED", "ACCEPTED"];

/** BOOK-18: Admin declines; frees the date if this request held it. The email is sent by the caller. */
export async function declineByBand(prisma: PrismaClient, input: Meta & { reason: string }, now: Date = new Date()): Promise<void> {
  if (!can(input.actor.role, "booking:manage")) throw new BookingAdminError("FORBIDDEN", "Only Admins can decline requests.");
  await prisma.$transaction(async (tx) => {
    const request = await loadForUpdate(tx, input);
    if (!DECLINABLE.includes(request.status)) throw new BookingAdminError("INVALID_STATE", "This request can't be declined in its current state.");
    await tx.dateClaim.deleteMany({ where: { requestId: request.id } });
    await tx.quote.updateMany({ where: { requestId: request.id, supersededAt: null }, data: { supersededAt: now } });
    await updateVersioned(tx, input, { status: "DECLINED_BY_BAND" });
    await statusEvent(tx, request.id, input.actor.id, request.status, "DECLINED_BY_BAND", input.reason, now);
    await writeAudit(tx, { actor: input.actor, action: "booking.decline", targetType: "bookingRequest", targetId: request.id, before: { status: request.status }, after: { status: "DECLINED_BY_BAND" }, requestId: input.httpRequestId });
  });
}

/** Cancels a confirmed booking and frees the date. */
export async function cancelBooking(prisma: PrismaClient, input: Meta & { reason: string }, now: Date = new Date()): Promise<void> {
  if (!can(input.actor.role, "booking:manage")) throw new BookingAdminError("FORBIDDEN", "Only Admins can cancel bookings.");
  await prisma.$transaction(async (tx) => {
    const request = await loadForUpdate(tx, input);
    if (request.status !== "CONFIRMED") throw new BookingAdminError("INVALID_STATE", "Only confirmed bookings can be cancelled.");
    await tx.dateClaim.deleteMany({ where: { requestId: request.id } });
    await updateVersioned(tx, input, { status: "CANCELLED" });
    await statusEvent(tx, request.id, input.actor.id, "CONFIRMED", "CANCELLED", input.reason, now);
    await writeAudit(tx, { actor: input.actor, action: "booking.cancel", targetType: "bookingRequest", targetId: request.id, before: { status: "CONFIRMED" }, after: { status: "CANCELLED", reason: input.reason }, requestId: input.httpRequestId });
  });
}

// ---------------------------------------------------------------- manual / revised quote

export function manualQuoteSchema(today: IsoDate) {
  return z.strictObject({
    eventDate: eventDateSchema(today),
    sets: z.coerce.number().int().min(1, "At least 1 set").max(8, "At most 8 sets"),
    ratePerSet: z
      .string()
      .trim()
      .transform((value) => value.replace(/[$,\s]/g, ""))
      .refine((value) => /^\d{1,6}$/.test(value) && Number(value) >= 1, "Whole dollars, at least $1")
      .transform((value) => Number(value) * 100),
    validHours: z.coerce.number().int().min(1, "At least 1 hour").max(720, "At most 30 days"),
  });
}

export type ManualQuoteInput = z.infer<ReturnType<typeof manualQuoteSchema>>;

const QUOTABLE: readonly BookingStatus[] = ["AWAITING_CONTACT", "CONTACTED", "QUOTED", "DECLINED_BY_PROSPECT"];

/**
 * BOOK-10: Admin sends a quote by hand (contact-path requests, short notice, distant venues)
 * or revises one. Ignores the instant-quote rules on purpose. Older quotes are superseded.
 */
export async function sendManualQuote(prisma: PrismaClient, input: Meta & { quote: ManualQuoteInput }, now: Date = new Date()): Promise<{ expiresAt: Date; totalCents: number }> {
  if (!can(input.actor.role, "booking:manage")) throw new BookingAdminError("FORBIDDEN", "Only Admins can send quotes.");
  const pricing = await getPricing(prisma);
  return prisma.$transaction(async (tx) => {
    const request = await loadForUpdate(tx, input);
    if (!QUOTABLE.includes(request.status)) throw new BookingAdminError("INVALID_STATE", "This request can't be quoted in its current state.");
    const claim = await liveClaimFor(tx, input.quote.eventDate, now);
    if (claim && claim.requestId !== request.id) {
      throw new BookingAdminError("NEEDS_OVERRIDE", "That date is already taken. Free it (or pick another date) before quoting.");
    }
    const expiresAt = new Date(now.getTime() + input.quote.validHours * 3_600_000);
    const totalCents = input.quote.ratePerSet * input.quote.sets;
    await tx.quote.updateMany({ where: { requestId: request.id, supersededAt: null }, data: { supersededAt: now } });
    await tx.quote.create({
      data: {
        requestId: request.id,
        eventType: request.eventType ?? "OTHER",
        dayCategory: dayCategoryOf(input.quote.eventDate, new Set(pricing.specialDates.map((special) => special.date))),
        ratePerSetCents: input.quote.ratePerSet,
        sets: input.quote.sets,
        totalCents,
        expiresAt,
        createdById: input.actor.id,
      },
    });
    await updateVersioned(tx, input, { status: "QUOTED", eventDate: toDbDate(input.quote.eventDate), sets: input.quote.sets, responseNote: "", respondedAt: null });
    await statusEvent(tx, request.id, input.actor.id, request.status, "QUOTED", "", now);
    await writeAudit(tx, { actor: input.actor, action: "booking.quote", targetType: "bookingRequest", targetId: request.id, after: { totalCents, sets: input.quote.sets, expiresAt: expiresAt.toISOString() }, requestId: input.httpRequestId });
    return { expiresAt, totalCents };
  });
}

// ---------------------------------------------------------------- holds

export const HOLD_DAYS_DEFAULT = 7;

const HOLDABLE: readonly BookingStatus[] = ["AWAITING_CONTACT", "CONTACTED", "QUOTED"];

/** BOOK-17: Admin holds the date (shows Pending) while negotiating; expires automatically. */
export async function placeHold(
  prisma: PrismaClient,
  input: Meta & { days: number; overrideReason?: string },
  now: Date = new Date(),
): Promise<{ expiresAt: Date; releasedRequestId: string | null }> {
  if (!can(input.actor.role, "booking:manage")) throw new BookingAdminError("FORBIDDEN", "Only Admins can hold dates.");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 30) throw new BookingAdminError("INVALID_STATE", "Hold for 1 to 30 days.");
  return prisma.$transaction(async (tx) => {
    const request = await loadForUpdate(tx, input);
    if (!HOLDABLE.includes(request.status)) throw new BookingAdminError("INVALID_STATE", "This request can't be held in its current state.");
    if (!request.eventDate) throw new BookingAdminError("NO_DATE", "Add a date first (send a quote with the date) before holding it.");
    const expiresAt = new Date(now.getTime() + input.days * 86_400_000);
    const result = await takeDate(tx, {
      actor: input.actor,
      requestId: request.id,
      date: fromUtc(request.eventDate),
      kind: "PENDING",
      expiresAt,
      overrideReason: input.overrideReason,
      now,
      httpRequestId: input.httpRequestId,
    });
    await updateVersioned(tx, input, {});
    await tx.bookingEvent.create({ data: { requestId: request.id, kind: "NOTE", body: `Date held for ${input.days} day${input.days === 1 ? "" : "s"}.`, authorId: input.actor.id, createdAt: now } });
    await writeAudit(tx, { actor: input.actor, action: "booking.hold", targetType: "bookingRequest", targetId: request.id, after: { date: fromUtc(request.eventDate), expiresAt: expiresAt.toISOString() }, requestId: input.httpRequestId });
    return { expiresAt, releasedRequestId: result.releasedRequestId };
  });
}

export async function releaseHold(prisma: PrismaClient, input: Meta, now: Date = new Date()): Promise<void> {
  if (!can(input.actor.role, "booking:manage")) throw new BookingAdminError("FORBIDDEN", "Only Admins can release holds.");
  await prisma.$transaction(async (tx) => {
    const request = await loadForUpdate(tx, input);
    if (!request.claim || request.claim.expiresAt === null) throw new BookingAdminError("INVALID_STATE", "There's no hold to release.");
    await tx.dateClaim.delete({ where: { id: request.claim.id } });
    await updateVersioned(tx, input, {});
    await tx.bookingEvent.create({ data: { requestId: request.id, kind: "NOTE", body: "Hold released.", authorId: input.actor.id, createdAt: now } });
    await writeAudit(tx, { actor: input.actor, action: "booking.releaseHold", targetType: "bookingRequest", targetId: request.id, requestId: input.httpRequestId });
  });
}
