import { randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { BookingStatus, DayCategory, EventType } from "@/generated/prisma/enums";
import { type PublicDayState, publicDayState } from "../availability/service";
import { type IsoDate, fromUtc, toDbDate, todayInBandTimeZone } from "../dates";
import { generateToken, hashToken, isWellFormedToken } from "../tokens";
import { type IneligibleReason, evaluateEligibility } from "./eligibility";
import { getPricing } from "./pricing";
import type { ContactInput, DateContactInput, DetailsInput, WhenInput } from "./validation";
import { milesBetweenZips } from "./zip-distance";

/**
 * Booking requests from the public (requirements §6.3–6.6).
 *
 * Prospects are identified only by the random token in their private link (stored hashed).
 * Every state change is a conditional update or a unique-constraint insert, so double
 * clicks and simultaneous accepts resolve to exactly one outcome.
 */

/** Statuses that still compete for a date (used for the CONFLICT flag). */
export const OPEN_STATUSES: readonly BookingStatus[] = ["AWAITING_CONTACT", "QUOTED", "ACCEPTED", "CONTACTED"];

/** Non-ambiguous characters (no 0/O, 1/I/L). */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateReference(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `LO-${code}`;
}

export class BookingError extends Error {
  override readonly name = "BookingError";
  constructor(
    readonly code: "DATE_UNAVAILABLE" | "NOT_FOUND" | "NOT_QUOTED" | "EXPIRED" | "ALREADY_RESPONDED",
    message: string,
  ) {
    super(message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Creates a row with a fresh reference, retrying on the (very unlikely) reference collision. */
async function withUniqueReference<T>(create: (reference: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await create(generateReference());
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not generate a unique booking reference");
}

async function hasCompetingActivity(
  tx: Prisma.TransactionClient,
  date: IsoDate,
  excludeRequestId?: string,
): Promise<boolean> {
  const [claim, others] = await Promise.all([
    tx.dateClaim.findUnique({ where: { date: toDbDate(date) }, select: { requestId: true } }),
    tx.bookingRequest.count({
      where: { eventDate: toDbDate(date), status: { in: [...OPEN_STATUSES] }, ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}) },
    }),
  ]);
  return (claim !== null && claim.requestId !== excludeRequestId) || others > 0;
}

// ---------------------------------------------------------------- wizard

export interface DraftResult {
  readonly token: string;
}

/**
 * FUN-2: saves contact details after wizard step 2 so Admins can follow up on abandoned
 * requests. The returned token authorizes finishing this same draft (and later becomes
 * the private link). Calling again with the token updates the draft.
 */
export async function saveDraft(
  prisma: PrismaClient,
  input: { token?: string; when: WhenInput; contact: ContactInput },
): Promise<DraftResult> {
  const data = {
    eventDate: input.when.flexible || !input.when.eventDate ? null : toDbDate(input.when.eventDate),
    startTime: input.when.startTime,
    endTime: input.when.endTime,
    sets: input.when.sets,
    eventType: input.when.eventType,
    ...input.contact,
  };
  if (input.token && isWellFormedToken(input.token)) {
    const updated = await prisma.bookingRequest.updateMany({
      where: { accessTokenHash: hashToken(input.token), status: "IN_PROGRESS" },
      data,
    });
    if (updated.count === 1) return { token: input.token };
  }
  const token = generateToken();
  await withUniqueReference((reference) =>
    prisma.bookingRequest.create({
      data: { ...data, reference, kind: "WIZARD", status: "IN_PROGRESS", accessTokenHash: hashToken(token) },
    }),
  );
  return { token };
}

export interface QuoteView {
  readonly eventType: EventType;
  readonly dayCategory: DayCategory;
  readonly ratePerSetCents: number;
  readonly sets: number;
  readonly totalCents: number;
  readonly expiresAt: Date;
}

export interface SubmitResult {
  readonly reference: string;
  /** Private-link token; shown once in the prospect's email and result page. */
  readonly token: string;
  readonly requestId: string;
  readonly outcome: "QUOTED" | "AWAITING_CONTACT";
  readonly quote: QuoteView | null;
  readonly isConflict: boolean;
  readonly ineligibleReasons: readonly IneligibleReason[];
}

/**
 * Submits the wizard: evaluates eligibility, snapshots a quote if eligible, flags conflicts.
 * Band-wide unavailable dates are refused; Pending/Booked dates never get a quote.
 */
export async function submitWizard(
  prisma: PrismaClient,
  input: { draftToken?: string; when: WhenInput; contact: ContactInput; details: DetailsInput },
  now: Date = new Date(),
): Promise<SubmitResult> {
  const today = todayInBandTimeZone(now);
  const date = input.when.flexible ? null : (input.when.eventDate ?? null);
  const pricing = await getPricing(prisma);

  let dayState: PublicDayState | null = null;
  if (date) {
    dayState = await publicDayState(prisma, date, today);
    if (dayState === "unavailable" || dayState === "past") {
      throw new BookingError("DATE_UNAVAILABLE", "That date isn't available. Pick another date, or choose “flexible”.");
    }
  }
  const distanceMiles = await milesBetweenZips(pricing.settings.originZip, input.contact.zip);

  const eligibility = date
    ? evaluateEligibility({
        date,
        today,
        eventType: input.when.eventType,
        sets: input.when.sets,
        distanceMiles,
        dateIsOpen: dayState === "available" || dayState === "limited",
        rules: pricing.settings,
        rates: pricing.rates,
        specialDates: new Set(pricing.specialDates.map((special) => special.date)),
      })
    : null;
  const quoted = eligibility?.eligible === true ? eligibility : null;
  const reasons: IneligibleReason[] = eligibility && !eligibility.eligible ? [...eligibility.reasons] : [];
  const status: BookingStatus = quoted ? "QUOTED" : "AWAITING_CONTACT";
  const token = input.draftToken && isWellFormedToken(input.draftToken) ? input.draftToken : generateToken();

  const data = {
    kind: "WIZARD" as const,
    status,
    eventDate: date ? toDbDate(date) : null,
    startTime: input.when.startTime,
    endTime: input.when.endTime,
    sets: input.when.sets,
    eventType: input.when.eventType,
    ...input.contact,
    attendance: input.details.attendance,
    setting: input.details.setting,
    soundProvided: input.details.soundProvided,
    message: input.details.message,
    distanceMiles,
    ineligibleReasons: reasons,
    submittedAt: now,
  };

  return prisma.$transaction(async (tx) => {
    // Reuse the step-2 draft if this browser has one; otherwise create fresh.
    const draft = await tx.bookingRequest.findFirst({
      where: { accessTokenHash: hashToken(token), status: "IN_PROGRESS" },
      select: { id: true },
    });
    const isConflict = date ? await hasCompetingActivity(tx, date, draft?.id) : false;
    const request = draft
      ? await tx.bookingRequest.update({ where: { id: draft.id }, data: { ...data, isConflict }, select: { id: true, reference: true } })
      : await withUniqueReference((reference) =>
          tx.bookingRequest.create({
            data: { ...data, isConflict, reference, accessTokenHash: hashToken(token) },
            select: { id: true, reference: true },
          }),
        );

    let quote: QuoteView | null = null;
    if (quoted) {
      quote = {
        eventType: input.when.eventType,
        dayCategory: quoted.dayCategory,
        ratePerSetCents: quoted.ratePerSetCents,
        sets: input.when.sets,
        totalCents: quoted.totalCents,
        expiresAt: new Date(now.getTime() + pricing.settings.quoteValidityHours * 3_600_000),
      };
      await tx.quote.create({ data: { requestId: request.id, ...quote } });
    }
    await tx.bookingEvent.create({
      data: { requestId: request.id, kind: "STATUS", fromStatus: draft ? "IN_PROGRESS" : null, toStatus: status, createdAt: now },
    });

    return { reference: request.reference, token, requestId: request.id, outcome: quoted ? "QUOTED" : "AWAITING_CONTACT", quote, isConflict, ineligibleReasons: reasons };
  });
}

// ---------------------------------------------------------------- date contact

export async function createDateContact(
  prisma: PrismaClient,
  input: DateContactInput,
  now: Date = new Date(),
): Promise<{ reference: string; token: string; requestId: string; isConflict: boolean }> {
  const token = generateToken();
  const date = input.eventDate || null;
  return prisma.$transaction(async (tx) => {
    const isConflict = date ? await hasCompetingActivity(tx, date) : false;
    const request = await withUniqueReference((reference) =>
      tx.bookingRequest.create({
        data: {
          reference,
          kind: "DATE_CONTACT",
          status: "AWAITING_CONTACT",
          eventDate: date ? toDbDate(date) : null,
          eventType: input.eventType,
          contactName: input.contactName,
          email: input.email,
          phone: input.phone,
          organization: input.organization,
          message: input.message,
          isConflict,
          accessTokenHash: hashToken(token),
          submittedAt: now,
        },
        select: { id: true, reference: true },
      }),
    );
    await tx.bookingEvent.create({ data: { requestId: request.id, kind: "STATUS", toStatus: "AWAITING_CONTACT", createdAt: now } });
    return { reference: request.reference, token, requestId: request.id, isConflict };
  });
}

// ---------------------------------------------------------------- prospect view

export type ProspectStatus =
  | "QUOTED"
  | "EXPIRED"
  | "ACCEPTED"
  | "DECLINED_BY_PROSPECT"
  | "AWAITING_CONTACT"
  | "CONFIRMED"
  | "CLOSED";

export interface ProspectRequestView {
  readonly id: string;
  readonly reference: string;
  readonly status: ProspectStatus;
  readonly eventDate: IsoDate | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly sets: number | null;
  readonly eventType: EventType | null;
  readonly contactName: string;
  readonly city: string;
  readonly state: string;
  readonly quote: QuoteView | null;
  readonly responseNote: string;
  /** BOOK-27: they tried to accept but someone else got the date first. */
  readonly dateTaken: boolean;
}

/** What the prospect sees on their private page. Expiry is evaluated at read time. */
function toProspectStatus(status: BookingStatus, quote: QuoteView | null, now: Date): ProspectStatus {
  switch (status) {
    case "QUOTED":
      return quote && quote.expiresAt > now ? "QUOTED" : "EXPIRED";
    case "ACCEPTED":
    case "DECLINED_BY_PROSPECT":
    case "AWAITING_CONTACT":
    case "CONFIRMED":
      return status;
    case "CONTACTED":
      return "AWAITING_CONTACT";
    default:
      return "CLOSED";
  }
}

export async function getRequestForProspect(prisma: PrismaClient, token: string, now: Date = new Date()): Promise<ProspectRequestView | null> {
  if (!isWellFormedToken(token)) return null;
  const row = await prisma.bookingRequest.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { quotes: { where: { supersededAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!row || row.status === "IN_PROGRESS") return null;
  const current = row.quotes[0];
  const quote: QuoteView | null = current
    ? {
        eventType: current.eventType,
        dayCategory: current.dayCategory,
        ratePerSetCents: current.ratePerSetCents,
        sets: current.sets,
        totalCents: current.totalCents,
        expiresAt: current.expiresAt,
      }
    : null;
  return {
    id: row.id,
    reference: row.reference,
    status: toProspectStatus(row.status, quote, now),
    eventDate: row.eventDate ? fromUtc(row.eventDate) : null,
    startTime: row.startTime,
    endTime: row.endTime,
    sets: row.sets,
    eventType: row.eventType,
    contactName: row.contactName,
    city: row.city,
    state: row.state,
    quote,
    responseNote: row.responseNote,
    dateTaken: row.kind === "WIZARD" && row.status === "AWAITING_CONTACT" && row.respondedAt !== null,
  };
}

// ---------------------------------------------------------------- respond to quote

export type AcceptOutcome = { outcome: "ACCEPTED"; requestId: string } | { outcome: "DATE_TAKEN"; requestId: string };

/**
 * BOOK-27: accepting is race-safe. The date claim is a unique insert inside the same
 * transaction as the status change; if another request already holds the date (or it was
 * marked unavailable since the quote), the accept is refused and the request moves to the
 * contact path, flagged as a conflict.
 */
export async function acceptQuote(
  prisma: PrismaClient,
  input: { token: string; note: string },
  now: Date = new Date(),
): Promise<AcceptOutcome> {
  const request = await loadQuotedRequest(prisma, input.token, now);
  const date = request.eventDate ? fromUtc(request.eventDate) : null;
  if (!date) throw new BookingError("NOT_QUOTED", "This request doesn't have a quote to accept.");

  try {
    await prisma.$transaction(async (tx) => {
      const state = await publicDayState(tx, date, todayInBandTimeZone(now));
      if (state !== "available" && state !== "limited") throw new DateTakenSignal();
      const updated = await tx.bookingRequest.updateMany({
        where: { id: request.id, status: "QUOTED", version: request.version },
        data: { status: "ACCEPTED", responseNote: input.note, respondedAt: now, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new BookingError("ALREADY_RESPONDED", "You've already responded to this quote.");
      await tx.dateClaim.create({ data: { date: toDbDate(date), kind: "PENDING", requestId: request.id } });
      await tx.bookingEvent.create({
        data: { requestId: request.id, kind: "STATUS", fromStatus: "QUOTED", toStatus: "ACCEPTED", body: input.note, createdAt: now },
      });
    });
    return { outcome: "ACCEPTED", requestId: request.id };
  } catch (error) {
    if (!(error instanceof DateTakenSignal) && !isUniqueViolation(error)) throw error;
  }

  // The date was taken first. Move this request to the contact path (separate transaction,
  // because the failed insert aborted the one above).
  await prisma.$transaction(async (tx) => {
    const moved = await tx.bookingRequest.updateMany({
      where: { id: request.id, status: "QUOTED" },
      data: { status: "AWAITING_CONTACT", isConflict: true, responseNote: input.note, respondedAt: now, version: { increment: 1 } },
    });
    if (moved.count === 1) {
      await tx.quote.updateMany({ where: { requestId: request.id, supersededAt: null }, data: { supersededAt: now } });
      await tx.bookingEvent.create({
        data: { requestId: request.id, kind: "STATUS", fromStatus: "QUOTED", toStatus: "AWAITING_CONTACT", body: "Tried to accept, but the date was taken first.", createdAt: now },
      });
    }
  });
  return { outcome: "DATE_TAKEN", requestId: request.id };
}

class DateTakenSignal extends Error {}

export async function declineQuote(
  prisma: PrismaClient,
  input: { token: string; note: string },
  now: Date = new Date(),
): Promise<{ requestId: string }> {
  const request = await loadQuotedRequest(prisma, input.token, now);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.bookingRequest.updateMany({
      where: { id: request.id, status: "QUOTED", version: request.version },
      data: { status: "DECLINED_BY_PROSPECT", responseNote: input.note, respondedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new BookingError("ALREADY_RESPONDED", "You've already responded to this quote.");
    await tx.bookingEvent.create({
      data: { requestId: request.id, kind: "STATUS", fromStatus: "QUOTED", toStatus: "DECLINED_BY_PROSPECT", body: input.note, createdAt: now },
    });
  });
  return { requestId: request.id };
}

async function loadQuotedRequest(prisma: PrismaClient, token: string, now: Date) {
  if (!isWellFormedToken(token)) throw new BookingError("NOT_FOUND", "That link isn't valid.");
  const request = await prisma.bookingRequest.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { quotes: { where: { supersededAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!request || request.status === "IN_PROGRESS") throw new BookingError("NOT_FOUND", "That link isn't valid.");
  if (request.status !== "QUOTED") throw new BookingError("ALREADY_RESPONDED", "You've already responded to this quote.");
  const quote = request.quotes[0];
  if (!quote) throw new BookingError("NOT_QUOTED", "This request doesn't have a quote to accept.");
  if (quote.expiresAt <= now) throw new BookingError("EXPIRED", "This quote has expired. Contact the band and we'll send a fresh one.");
  return request;
}
