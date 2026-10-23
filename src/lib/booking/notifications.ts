import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { type IsoDate, formatLongDate, fromUtc } from "../dates";
import { env } from "../env";
import { logger } from "../logger";
import { type OutgoingEmail, sendEmail } from "../mail/mailer";
import { emailLayout, escapeHtml } from "../mail/templates";
import { can } from "../permissions";
import { type PushPayload, sendPushToUsers } from "../push";
import { EVENT_TYPE_LABELS, formatCents } from "./eligibility";
import { formatTime } from "./format";
import type { QuoteView } from "./requests";

/**
 * Booking emails (requirements BOOK-6/BOOK-8, NOT-2..NOT-5).
 *
 * Band notifications go to every active band account individually (not a shared inbox),
 * so everyone hears about requests. Members' copies never include prices (§2.3).
 * Email failures are logged and never undo a saved request: the request is in the
 * database and visible in the booking inbox regardless.
 */

export type BandEvent =
  | "NEW_REQUEST"
  | "QUOTE_ACCEPTED"
  | "QUOTE_DECLINED"
  | "DATE_TAKEN"
  | "DATE_CONTACT"
  | "BOOKED"
  | "RELEASED_BY_OVERRIDE"
  | "CANCELLED"
  | "REMINDER_24H"
  | "REMINDER_72H"
  | "HOLD_EXPIRING";

const EVENT_HEADLINES: Record<BandEvent, string> = {
  NEW_REQUEST: "New booking request",
  QUOTE_ACCEPTED: "Quote accepted: confirm this gig",
  QUOTE_DECLINED: "Quote declined",
  DATE_TAKEN: "Tried to accept, but the date was already taken",
  DATE_CONTACT: "Someone wants to talk about a date",
  BOOKED: "Gig booked",
  RELEASED_BY_OVERRIDE: "Bumped by an override: contact them",
  CANCELLED: "Booking cancelled",
  REMINDER_24H: "Reminder: accepted quote waiting for confirmation",
  REMINDER_72H: "Still waiting: accepted quote not confirmed after 3 days",
  HOLD_EXPIRING: "Hold expires within a day",
};

/** Reminders and hold warnings go to Admins only (they're the ones who can act). */
const ADMIN_ONLY_EVENTS: ReadonlySet<BandEvent> = new Set(["REMINDER_24H", "REMINDER_72H", "HOLD_EXPIRING"]);

/** Lock-screen safe: no names, phones, emails, or prices (NOT-3). */
export function bandPushPayload(event: BandEvent, summary: Pick<BandSummary, "requestId" | "date" | "eventTypeLabel" | "sets" | "isConflict">): PushPayload {
  const day = summary.date ? SHORT_DATE.format(new Date(`${summary.date}T00:00:00Z`)) : "Flexible date";
  return {
    title: `${summary.isConflict ? "CONFLICT · " : ""}${EVENT_HEADLINES[event]}`,
    body: `${day} · ${summary.eventTypeLabel}${summary.sets ? ` · ${summary.sets} sets` : ""}`,
    url: `/admin/bookings/${summary.requestId}`,
    tag: `booking-${summary.requestId}`,
  };
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export { formatTime };

function whenLine(date: IsoDate | null, startTime: string | null, endTime: string | null): string {
  const day = date ? formatLongDate(date) : "Flexible date";
  return startTime && endTime ? `${day}, ${formatTime(startTime)}–${formatTime(endTime)}` : day;
}

async function sendQuietly(message: OutgoingEmail, kind: string): Promise<boolean> {
  try {
    await sendEmail(message, { kind });
    return true;
  } catch {
    // sendEmail already logged the failure with context.
    return false;
  }
}

// ---------------------------------------------------------------- prospect

export async function sendProspectConfirmation(input: {
  to: string;
  name: string;
  reference: string;
  token: string;
  date: IsoDate | null;
  startTime: string | null;
  endTime: string | null;
  quote: QuoteView | null;
}): Promise<boolean> {
  const url = `${env().APP_URL}/booking/${input.token}`;
  const when = whenLine(input.date, input.startTime, input.endTime);
  const quoteText = input.quote
    ? `Your quote: ${input.quote.sets} sets × ${formatCents(input.quote.ratePerSetCents)} = ${formatCents(input.quote.totalCents)}. Accept or decline it on your request page before ${input.quote.expiresAt.toUTCString()}.`
    : "Someone from The Leftovers will contact you to talk about your event.";
  const footer = `Reference ${input.reference}. Keep this email: the link is private to you.`;
  return sendQuietly(
    {
      to: input.to,
      subject: `Your booking request ${input.reference}: The Leftovers`,
      text: `Hi ${input.name},\n\nThanks for your request for ${when}.\n\n${quoteText}\n\nView your request:\n${url}\n\n${footer}\n`,
      html: emailLayout({
        heading: `Thanks, ${input.name}`,
        body: `We got your request for <strong>${escapeHtml(when)}</strong>.<br><br>${escapeHtml(quoteText)}`,
        actionLabel: input.quote ? "View your quote" : "View your request",
        actionUrl: url,
        footer,
      }),
    },
    "booking-confirmation",
  );
}

// ---------------------------------------------------------------- band

export interface BandSummary {
  readonly requestId: string;
  readonly reference: string;
  readonly isConflict: boolean;
  readonly date: IsoDate | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly sets: number | null;
  readonly eventTypeLabel: string;
  readonly contactName: string;
  readonly email: string;
  readonly phone: string;
  readonly organization: string;
  readonly place: string;
  readonly distanceMiles: number | null;
  readonly message: string;
  readonly responseNote: string;
  readonly totalCents: number | null;
}

async function loadSummary(prisma: PrismaClient, requestId: string): Promise<BandSummary | null> {
  const row = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    include: { quotes: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!row) return null;
  return {
    requestId: row.id,
    reference: row.reference,
    isConflict: row.isConflict,
    date: row.eventDate ? fromUtc(row.eventDate) : null,
    startTime: row.startTime,
    endTime: row.endTime,
    sets: row.sets,
    eventTypeLabel: row.eventType ? EVENT_TYPE_LABELS[row.eventType] : "Event",
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    organization: row.organization,
    place: [row.city, row.state].filter(Boolean).join(", "),
    distanceMiles: row.distanceMiles,
    message: row.message,
    responseNote: row.responseNote,
    totalCents: row.quotes[0]?.totalCents ?? null,
  };
}

/** Builds one recipient's copy. Exported for tests (prices only for roles allowed to see them). */
export function bandEmail(event: BandEvent, summary: BandSummary, recipient: { email: string; role: Role }, appUrl: string): OutgoingEmail {
  const showPrice = can(recipient.role, "booking:viewFinancials");
  const when = whenLine(summary.date, summary.startTime, summary.endTime);
  const subjectDate = summary.date ? formatLongDate(summary.date) : "Flexible date";
  const subject = `${summary.isConflict ? "[CONFLICT] " : ""}${EVENT_HEADLINES[event]}: ${subjectDate} · ${summary.eventTypeLabel}${summary.sets ? ` · ${summary.sets} sets` : ""}`;
  const lines = [
    `${EVENT_HEADLINES[event]} (${summary.reference})`,
    summary.isConflict ? "CONFLICT: another request, hold, or booking exists for this date." : "",
    `When: ${when}`,
    `Event: ${summary.eventTypeLabel}${summary.sets ? `, ${summary.sets} sets` : ""}`,
    `Contact: ${summary.contactName}${summary.organization ? `, ${summary.organization}` : ""}`,
    `Phone: ${summary.phone}`,
    `Email: ${summary.email}`,
    summary.place ? `Where: ${summary.place}${summary.distanceMiles !== null ? ` (~${Math.round(summary.distanceMiles)} mi)` : ""}` : "",
    showPrice && summary.totalCents !== null ? `Quote: ${formatCents(summary.totalCents)}` : "",
    summary.responseNote ? `Their note: ${summary.responseNote}` : "",
    summary.message ? `Message: ${summary.message}` : "",
  ].filter(Boolean);
  const url = `${appUrl}/admin/bookings/${summary.requestId}`;
  return {
    to: recipient.email,
    subject,
    text: `${lines.join("\n")}\n\nOpen in band admin:\n${url}\n`,
    html: emailLayout({
      heading: EVENT_HEADLINES[event],
      body: lines.slice(1).map(escapeHtml).join("<br>"),
      actionLabel: "Open request",
      actionUrl: url,
      footer: `Reference ${summary.reference}. Change alert settings under My account on the band site.`,
    }),
  };
}

/**
 * Notifies every active band account (Admins only for reminders) by email and phone push,
 * per each person's preferences. Returns how many emails were sent.
 */
export async function notifyBand(prisma: PrismaClient, event: BandEvent, requestId: string): Promise<number> {
  const [summary, allUsers] = await Promise.all([
    loadSummary(prisma, requestId),
    prisma.user.findMany({
      where: { deactivatedAt: null },
      select: { id: true, email: true, role: true, bookingEmailAlerts: true, bookingPushAlerts: true },
    }),
  ]);
  if (!summary) return 0;
  const users = ADMIN_ONLY_EVENTS.has(event) ? allUsers.filter((user) => can(user.role, "booking:manage")) : allUsers;
  const appUrl = env().APP_URL;
  const emailUsers = users.filter((user) => user.bookingEmailAlerts);
  const pushUserIds = users.filter((user) => user.bookingPushAlerts).map((user) => user.id);

  const [results, pushed] = await Promise.all([
    Promise.all(emailUsers.map((user) => sendQuietly(bandEmail(event, summary, user, appUrl), `band-${event.toLowerCase()}`))),
    sendPushToUsers(prisma, pushUserIds, bandPushPayload(event, summary)),
  ]);
  const sent = results.filter(Boolean).length;
  const level = sent < emailUsers.length ? "warn" : "info";
  logger[level]({ event, requestId, emailed: sent, emailTotal: emailUsers.length, pushed }, "band notified");
  return sent;
}

