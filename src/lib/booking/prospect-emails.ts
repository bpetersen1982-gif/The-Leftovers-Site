import type { PrismaClient } from "@/generated/prisma/client";
import { formatLongDate, fromUtc } from "../dates";
import { env } from "../env";
import { bookingSender, sendEmail } from "../mail/mailer";
import { emailLayout, escapeHtml } from "../mail/templates";
import { formatCents } from "./eligibility";
import { formatTime } from "./format";

/**
 * Emails from the band to a prospect, sent from booking@ via Resend (requirements BOOK-18).
 * The body is plain text written by a band member: it's escaped for HTML and shown with
 * line breaks preserved. Never includes anything the prospect hasn't been told already.
 */

export class ProspectEmailError extends Error {
  override readonly name = "ProspectEmailError";
}

async function loadRecipient(prisma: PrismaClient, requestId: string) {
  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    select: { email: true, contactName: true, reference: true, eventDate: true, startTime: true, endTime: true, loadInTime: true, sets: true, agreedPriceCents: true, accessTokenHash: true },
  });
  if (!request) throw new ProspectEmailError("Request not found");
  return request;
}

function bodyHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

/** Sends a plain message from a band member. Returns the subject actually used. */
export async function sendProspectMessage(
  prisma: PrismaClient,
  input: { requestId: string; subject: string; body: string; senderName: string; linkToken?: string | null },
): Promise<void> {
  const request = await loadRecipient(prisma, input.requestId);
  const signature = `${input.senderName}\nThe Leftovers`;
  const url = input.linkToken ? `${env().APP_URL}/booking/${input.linkToken}` : null;
  await sendEmail(
    {
      ...bookingSender(),
      to: request.email,
      subject: input.subject,
      text: `${input.body}\n\n${signature}\n${url ? `\nYour request: ${url}\n` : ""}\nReference ${request.reference}\n`,
      html: emailLayout({
        heading: `Hi ${request.contactName},`,
        body: `${bodyHtml(input.body)}<br><br>${bodyHtml(signature)}`,
        actionLabel: url ? "View your request" : "Visit our site",
        actionUrl: url ?? env().APP_URL,
        footer: `Reference ${request.reference}. Reply to this email to reach the band.`,
      }),
    },
    { kind: "prospect-message" },
  );
}

export const DECLINE_TEMPLATE = (dateLabel: string) =>
  `Thanks so much for thinking of The Leftovers for ${dateLabel}. Unfortunately we're not able to take this one.\n\nWe'd love to play for you another time. Check our calendar for open dates anytime.`;

export const CONFIRM_TEMPLATE = (details: { date: string; time: string; loadIn: string | null; sets: number; price: string | null }) =>
  [
    `You're booked! Here are the details we have:`,
    ``,
    `Date: ${details.date}`,
    `Time: ${details.time}`,
    details.loadIn ? `Load-in: ${details.loadIn}` : null,
    `Sets: ${details.sets}`,
    details.price ? `Agreed price: ${details.price}` : null,
    ``,
    `If anything changes, just reply to this email.`,
  ]
    .filter((line) => line !== null)
    .join("\n");

/** Default confirmation text for the confirm form, from the stored booking. */
export async function confirmationDraft(prisma: PrismaClient, requestId: string): Promise<string> {
  const request = await loadRecipient(prisma, requestId);
  return CONFIRM_TEMPLATE({
    date: request.eventDate ? formatLongDate(fromUtc(request.eventDate)) : "TBD",
    time: request.startTime && request.endTime ? `${formatTime(request.startTime)}–${formatTime(request.endTime)}` : "TBD",
    loadIn: request.loadInTime ? formatTime(request.loadInTime) : null,
    sets: request.sets ?? 0,
    price: request.agreedPriceCents !== null ? formatCents(request.agreedPriceCents) : null,
  });
}
