"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPricing } from "@/lib/booking/pricing";
import { lookupZip } from "@/lib/booking/zip-distance";
import { notifyBand, sendProspectConfirmation } from "@/lib/booking/notifications";
import {
  BookingError,
  acceptQuote,
  createDateContact,
  declineQuote,
  saveDraft,
  submitWizard,
} from "@/lib/booking/requests";
import { contactSchema, dateContactSchema, detailsSchema, responseNoteSchema, whenSchema } from "@/lib/booking/validation";
import { todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit";

/**
 * Public booking actions (requirements BOOK-5..BOOK-9, BOOK-26, BOOK-27). Every input is
 * re-validated here; nothing from the browser is trusted. Spam protection: honeypot field,
 * minimum fill time, and per-IP / per-email rate limits stored in Postgres.
 */

export type FieldErrors = Partial<Record<string, string>>;

export type WizardStep = "when" | "contact" | "details";

export type SubmitBookingResult =
  | { ok: true; token: string }
  | { ok: false; message: string; step?: WizardStep; fieldErrors?: FieldErrors };

const MIN_FILL_MS = 3_000;
const HOUR = 3_600_000;

function errorsOf(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get("x-real-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function withinLimits(email: string | null): Promise<boolean> {
  const ip = await clientIp();
  const byIp = await consumeRateLimit(db(), { key: `booking:ip:${ip}`, max: 10, windowMs: HOUR });
  if (!byIp.allowed) return false;
  if (email) {
    const byEmail = await consumeRateLimit(db(), { key: `booking:email:${email}`, max: 5, windowMs: 24 * HOUR });
    if (!byEmail.allowed) return false;
  }
  return true;
}

const TOO_MANY = "Too many requests from here. Please wait a while, or email us directly.";

/** Validates the When step (rules come from current pricing settings). */
async function parseWhen(raw: unknown) {
  const { settings } = await getPricing(db());
  return whenSchema(todayInBandTimeZone(), settings).safeParse(raw);
}

/** FUN-2: called when the prospect finishes step 2, so Admins can follow up if they leave. */
export async function saveDraftAction(input: { token?: string; when: unknown; contact: unknown }): Promise<{ ok: true; token: string; zipKnown: boolean } | { ok: false }> {
  const when = await parseWhen(input.when);
  const contact = contactSchema.safeParse(input.contact);
  if (!when.success || !contact.success) return { ok: false };
  const ip = await clientIp();
  if (!(await consumeRateLimit(db(), { key: `booking:draft:${ip}`, max: 30, windowMs: HOUR })).allowed) return { ok: false };
  const [draft, zipPoint] = await Promise.all([
    saveDraft(db(), { token: typeof input.token === "string" ? input.token : undefined, when: when.data, contact: contact.data }),
    lookupZip(contact.data.zip),
  ]);
  // Lets the form flag a likely ZIP typo. Says nothing about pricing or eligibility.
  return { ok: true, token: draft.token, zipKnown: zipPoint !== null };
}

export async function submitBookingAction(input: {
  draftToken?: string;
  when: unknown;
  contact: unknown;
  details: unknown;
  website: unknown;
  startedAt: unknown;
}): Promise<SubmitBookingResult> {
  // Honeypot / too-fast submissions get a believable success-shaped failure, nothing saved.
  if ((typeof input.website === "string" && input.website !== "") || typeof input.startedAt !== "number" || Date.now() - input.startedAt < MIN_FILL_MS) {
    logger.warn({ reason: "spam-heuristic" }, "booking submission dropped");
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  const when = await parseWhen(input.when);
  if (!when.success) return { ok: false, message: "Check the event details.", step: "when", fieldErrors: errorsOf(when.error) };
  const contact = contactSchema.safeParse(input.contact);
  if (!contact.success) return { ok: false, message: "Check your contact details.", step: "contact", fieldErrors: errorsOf(contact.error) };
  const details = detailsSchema.safeParse(input.details);
  if (!details.success) return { ok: false, message: "Check the event details.", step: "details", fieldErrors: errorsOf(details.error) };
  if (!(await withinLimits(contact.data.email))) return { ok: false, message: TOO_MANY };

  let result;
  try {
    result = await submitWizard(db(), {
      draftToken: typeof input.draftToken === "string" ? input.draftToken : undefined,
      when: when.data,
      contact: contact.data,
      details: details.data,
    });
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, message: error.message, step: "when" };
    throw error;
  }

  logger.info({ reference: result.reference, outcome: result.outcome, conflict: result.isConflict }, "booking request submitted");
  await Promise.all([
    sendProspectConfirmation({
      to: contact.data.email,
      name: contact.data.contactName,
      reference: result.reference,
      token: result.token,
      date: when.data.flexible ? null : (when.data.eventDate ?? null),
      startTime: when.data.startTime,
      endTime: when.data.endTime,
      quote: result.quote,
    }),
    notifyBand(db(), "NEW_REQUEST", result.requestId),
  ]);
  revalidatePath("/admin/bookings");
  return { ok: true, token: result.token };
}

export interface RespondState {
  readonly ok: boolean;
  readonly message: string | null;
}

export async function respondToQuoteAction(_previous: RespondState, formData: FormData): Promise<RespondState> {
  const token = String(formData.get("token") ?? "");
  const decision = formData.get("decision");
  const note = responseNoteSchema.safeParse(String(formData.get("note") ?? ""));
  if (!note.success) return { ok: false, message: note.error.issues[0]?.message ?? "Check your note." };
  if (decision !== "accept" && decision !== "decline") return { ok: false, message: "Choose accept or decline." };

  try {
    if (decision === "accept") {
      const result = await acceptQuote(db(), { token, note: note.data });
      await notifyBand(db(), result.outcome === "ACCEPTED" ? "QUOTE_ACCEPTED" : "DATE_TAKEN", result.requestId);
    } else {
      const result = await declineQuote(db(), { token, note: note.data });
      await notifyBand(db(), "QUOTE_DECLINED", result.requestId);
    }
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/booking/${token}`);
  revalidatePath("/book");
  revalidatePath("/admin/bookings");
  return { ok: true, message: null };
}

export interface DateContactState {
  readonly ok: boolean;
  readonly message: string | null;
  readonly reference?: string;
  readonly fieldErrors?: FieldErrors;
}

export async function dateContactAction(_previous: DateContactState, formData: FormData): Promise<DateContactState> {
  if (String(formData.get("website") ?? "") !== "") return { ok: false, message: "Something went wrong. Please try again." };
  const parsed = dateContactSchema(todayInBandTimeZone()).safeParse({
    eventDate: String(formData.get("eventDate") ?? ""),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    organization: formData.get("organization") ?? "",
    eventType: formData.get("eventType"),
    message: formData.get("message"),
  });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: errorsOf(parsed.error) };
  if (!(await withinLimits(parsed.data.email))) return { ok: false, message: TOO_MANY };

  const result = await createDateContact(db(), parsed.data);
  await Promise.all([
    sendProspectConfirmation({
      to: parsed.data.email,
      name: parsed.data.contactName,
      reference: result.reference,
      token: result.token,
      date: parsed.data.eventDate || null,
      startTime: null,
      endTime: null,
      quote: null,
    }),
    notifyBand(db(), "DATE_CONTACT", result.requestId),
  ]);
  revalidatePath("/admin/bookings");
  return { ok: true, message: "Thanks! Someone from The Leftovers will contact you.", reference: result.reference };
}

