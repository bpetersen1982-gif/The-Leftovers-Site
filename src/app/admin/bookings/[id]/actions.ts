"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import {
  BookingAdminError,
  addBookingNote,
  cancelBooking,
  confirmBooking,
  confirmInputSchema,
  declineByBand,
  manualQuoteSchema,
  placeHold,
  recordEmail,
  releaseHold,
  sendManualQuote,
} from "@/lib/booking/admin";
import { formatCents } from "@/lib/booking/eligibility";
import { notifyBand } from "@/lib/booking/notifications";
import { confirmationDraft, sendProspectMessage } from "@/lib/booking/prospect-emails";
import { rotateAccessToken } from "@/lib/booking/requests";
import { todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getRequestId } from "@/lib/request-id";
import type { ActionState } from "../../action-state";

export interface BookingActionState extends ActionState {
  /** The date is held by another request; the form should offer an override. */
  readonly needsOverride?: boolean;
}

const EXPIRY = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago" });

const idSchema = z.uuid();
const versionSchema = z.coerce.number().int().min(1);
const messageSchema = z.string().trim().max(5_000, "Keep it under 5,000 characters");
const subjectSchema = z.string().trim().min(1, "Add a subject").max(150);

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

function parseIds(formData: FormData) {
  const id = idSchema.safeParse(formData.get("requestId"));
  const version = versionSchema.safeParse(formData.get("version"));
  return id.success && version.success ? { requestId: id.data, version: version.data } : null;
}

function failure(error: unknown): BookingActionState {
  if (error instanceof BookingAdminError) {
    return { ok: false, message: error.message, needsOverride: error.code === "NEEDS_OVERRIDE" };
  }
  throw error;
}

function refresh(requestId: string): void {
  revalidatePath(`/admin/bookings/${requestId}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/book");
}

/** Sends a band-authored email and logs it on the request; email failures are reported, not thrown. */
async function emailProspect(input: { actorId: string; actorName: string; requestId: string; subject: string; body: string; linkToken?: string }): Promise<boolean> {
  try {
    await sendProspectMessage(db(), { requestId: input.requestId, subject: input.subject, body: input.body, senderName: input.actorName, linkToken: input.linkToken });
    await recordEmail(db(), { actorId: input.actorId, requestId: input.requestId, subject: input.subject, body: input.body });
    return true;
  } catch (error) {
    logger.error({ requestId: input.requestId, err: error }, "prospect email failed");
    return false;
  }
}

const EMAIL_FAILED = " The email couldn't be sent; try the Reply box, or call them.";

// ---------------------------------------------------------------- everyone in the band

export async function addNoteAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:addNote");
  const requestId = idSchema.safeParse(formData.get("requestId"));
  const kind = formData.get("kind") === "CONTACTED" ? "CONTACTED" : "NOTE";
  const body = z.string().trim().min(1, "Write something first").max(2_000).safeParse(formData.get("body"));
  if (!requestId.success) return { ok: false, message: "Invalid request." };
  if (!body.success) return { ok: false, message: body.error.issues[0]?.message ?? "Invalid note." };
  try {
    await addBookingNote(db(), { actor, requestId: requestId.data, kind, body: body.data });
  } catch (error) {
    return failure(error);
  }
  refresh(requestId.data);
  return { ok: true, message: kind === "CONTACTED" ? "Logged. The band can see you reached out." : "Note added." };
}

export async function replyAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:reply");
  const requestId = idSchema.safeParse(formData.get("requestId"));
  const parsed = z.strictObject({ subject: subjectSchema, body: messageSchema.pipe(z.string().min(1, "Write a message")) }).safeParse({
    subject: formData.get("subject"),
    body: formData.get("body"),
  });
  if (!requestId.success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const sent = await emailProspect({ actorId: actor.id, actorName: actor.name, requestId: requestId.data, ...parsed.data });
  refresh(requestId.data);
  return sent ? { ok: true, message: "Sent from booking@. It's saved in the history below." } : { ok: false, message: "The email couldn't be sent. Try again in a minute." };
}

// ---------------------------------------------------------------- Admin only

export async function confirmAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:manage");
  const ids = parseIds(formData);
  if (!ids) return { ok: false, message: "Reload the page and try again." };
  const parsed = confirmInputSchema(todayInBandTimeZone()).safeParse({
    eventDate: formData.get("eventDate"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    loadInTime: formData.get("loadInTime") ?? "",
    sets: formData.get("sets"),
    agreedPrice: formData.get("agreedPrice"),
    note: formData.get("note") ?? "",
    overrideReason: String(formData.get("overrideReason") ?? "") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };

  let released: string | null;
  try {
    ({ releasedRequestId: released } = await confirmBooking(db(), { actor, ...ids, details: parsed.data, httpRequestId: await getRequestId() }));
  } catch (error) {
    return failure(error);
  }

  let emailNote = "";
  if (formData.get("emailProspect") === "on") {
    const token = await rotateAccessToken(db(), ids.requestId);
    const body = String(formData.get("message") ?? "").trim() || (await confirmationDraft(db(), ids.requestId));
    const sent = await emailProspect({ actorId: actor.id, actorName: actor.name, requestId: ids.requestId, subject: "You're booked: The Leftovers", body, linkToken: token });
    if (!sent) emailNote = EMAIL_FAILED;
  }
  await notifyBand(db(), "BOOKED", ids.requestId);
  if (released) {
    await notifyBand(db(), "RELEASED_BY_OVERRIDE", released);
    refresh(released);
  }
  refresh(ids.requestId);
  return {
    ok: true,
    message: `Booked.${released ? " The other request was released: contact them personally." : ""}${emailNote}`,
  };
}

export async function declineAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:manage");
  const ids = parseIds(formData);
  const message = messageSchema.safeParse(formData.get("message") ?? "");
  if (!ids) return { ok: false, message: "Reload the page and try again." };
  if (!message.success) return { ok: false, message: message.error.issues[0]?.message ?? "Invalid message." };
  const sendIt = formData.get("emailProspect") === "on";
  if (sendIt && !message.data) return { ok: false, message: "Write the decline message, or uncheck “Email them”." };
  try {
    await declineByBand(db(), { actor, ...ids, reason: sendIt ? "Declined with email" : "Declined (no email sent)", httpRequestId: await getRequestId() });
  } catch (error) {
    return failure(error);
  }
  let notice = "declined";
  if (sendIt) {
    const sent = await emailProspect({ actorId: actor.id, actorName: actor.name, requestId: ids.requestId, subject: "Your request with The Leftovers", body: message.data });
    if (!sent) notice = "declined-email-failed";
  }
  refresh(ids.requestId);
  // The decline panel disappears once the request is closed, so confirm at page level.
  redirect(`/admin/bookings/${ids.requestId}?notice=${notice}`);
}

export async function quoteAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:manage");
  const ids = parseIds(formData);
  if (!ids) return { ok: false, message: "Reload the page and try again." };
  const parsed = manualQuoteSchema(todayInBandTimeZone()).safeParse({
    eventDate: formData.get("eventDate"),
    sets: formData.get("sets"),
    ratePerSet: formData.get("ratePerSet"),
    validHours: formData.get("validHours"),
  });
  const note = messageSchema.safeParse(formData.get("message") ?? "");
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  if (!note.success) return { ok: false, message: note.error.issues[0]?.message ?? "Invalid message." };

  let quote;
  try {
    quote = await sendManualQuote(db(), { actor, ...ids, quote: parsed.data, httpRequestId: await getRequestId() });
  } catch (error) {
    return failure(error);
  }
  const token = await rotateAccessToken(db(), ids.requestId);
  const body = [
    note.data,
    `Here's your quote: ${parsed.data.sets} set${parsed.data.sets === 1 ? "" : "s"} × ${formatCents(parsed.data.ratePerSet)} = ${formatCents(quote.totalCents)}.`,
    `Accept or decline it on your request page by ${EXPIRY.format(quote.expiresAt)} Central. Your date is confirmed only after the band confirms times and details.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const sent = await emailProspect({ actorId: actor.id, actorName: actor.name, requestId: ids.requestId, subject: "Your quote from The Leftovers", body, linkToken: token });
  refresh(ids.requestId);
  return sent ? { ok: true, message: "Quote sent with a new private link." } : { ok: false, message: `Quote saved.${EMAIL_FAILED}` };
}

export async function holdAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:manage");
  const ids = parseIds(formData);
  const days = z.coerce.number().int().min(1).max(30).safeParse(formData.get("days"));
  if (!ids) return { ok: false, message: "Reload the page and try again." };
  if (!days.success) return { ok: false, message: "Hold for 1 to 30 days." };
  const overrideReason = String(formData.get("overrideReason") ?? "").trim().slice(0, 300) || undefined;
  let released: string | null;
  try {
    ({ releasedRequestId: released } = await placeHold(db(), { actor, ...ids, days: days.data, overrideReason, httpRequestId: await getRequestId() }));
  } catch (error) {
    return failure(error);
  }
  if (released) {
    await notifyBand(db(), "RELEASED_BY_OVERRIDE", released);
    refresh(released);
  }
  refresh(ids.requestId);
  return { ok: true, message: `Date held for ${days.data} day${days.data === 1 ? "" : "s"}. It shows Pending publicly.` };
}

export async function releaseHoldAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:manage");
  const ids = parseIds(formData);
  if (!ids) return { ok: false, message: "Reload the page and try again." };
  try {
    await releaseHold(db(), { actor, ...ids, httpRequestId: await getRequestId() });
  } catch (error) {
    return failure(error);
  }
  refresh(ids.requestId);
  return { ok: true, message: "Hold released." };
}

export async function cancelAction(_previous: BookingActionState, formData: FormData): Promise<BookingActionState> {
  const actor = await requirePermission("booking:manage");
  const ids = parseIds(formData);
  const reason = z.string().trim().min(1, "Say why (the band sees this)").max(500).safeParse(formData.get("reason"));
  if (!ids) return { ok: false, message: "Reload the page and try again." };
  if (!reason.success) return { ok: false, message: reason.error.issues[0]?.message ?? "Invalid reason." };
  try {
    await cancelBooking(db(), { actor, ...ids, reason: reason.data, httpRequestId: await getRequestId() });
  } catch (error) {
    return failure(error);
  }
  await notifyBand(db(), "CANCELLED", ids.requestId);
  refresh(ids.requestId);
  redirect(`/admin/bookings/${ids.requestId}?notice=cancelled`);
}
