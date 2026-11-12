import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { type AuditActor, writeAudit } from "../audit";
import type { OutgoingEmail } from "../mail/mailer";
import { emailLayout, escapeHtml } from "../mail/templates";
import { can } from "../permissions";
import { consumeRateLimit } from "../rate-limit";
import { generateToken, hashToken, isWellFormedToken } from "../tokens";

/**
 * Mailing list (requirements FAN-8): double opt-in, stored in our database, CSV export.
 *
 * - Signing up sends a confirmation email; nobody is on the list until they click it.
 * - The visitor always sees the same "check your inbox" reply, whether or not the address
 *   is already on the list, so the form can't be used to discover who's subscribed.
 * - Confirm and unsubscribe links open a page with a button rather than acting on the
 *   click, because email security scanners open every link in a message.
 * - Unsubscribing deletes the record.
 */

const CONFIRM_TTL_MS = 7 * 24 * 3_600_000;
/** Don't resend a confirmation to the same address more often than this. */
const RESEND_GAP_MS = 10 * 60_000;
const IP_RATE = { max: 5, windowMs: 60 * 60_000 } as const;
const EMAIL_RATE = { max: 3, windowMs: 24 * 3_600_000 } as const;
/** Unconfirmed sign-ups are deleted after this long (data minimization). */
export const PENDING_RETENTION_DAYS = 30;

export const subscribeEmailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a real email address.").max(254, "That email is too long."));

export interface MailingDeps {
  readonly prisma: PrismaClient;
  readonly send: (message: OutgoingEmail) => Promise<void>;
  readonly appUrl: string;
  readonly now?: () => Date;
}

/** What happened, for logs and tests. Visitors get the same message for all but RATE_LIMITED. */
export type SubscribeOutcome = "sent" | "alreadyConfirmed" | "recentlySent" | "rateLimited";

function nowOf(deps: Pick<MailingDeps, "now">): Date {
  return deps.now?.() ?? new Date();
}

function emailKey(email: string): string {
  return createHash("sha256").update(`mailing:${email}`).digest("hex").slice(0, 32);
}

export function confirmationEmail(to: string, confirmUrl: string, unsubscribeUrl: string): OutgoingEmail {
  const intro = "Tap the button to confirm you want emails from The Leftovers about upcoming shows. We don't send many, and you can leave any time.";
  const footer = "If you didn't ask to join, ignore this email and you won't be added.";
  return {
    to,
    subject: "Confirm you want The Leftovers' show emails",
    text: `${intro}\n\nConfirm:\n${confirmUrl}\n\n${footer}\n\nChanged your mind later? Leave the list:\n${unsubscribeUrl}\n`,
    html: emailLayout({
      heading: "One more step",
      body: `${escapeHtml(intro)}<br><br><span style="font-size:13px;">Changed your mind later? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#D8CFBD;">Leave the list</a>.</span>`,
      actionLabel: "Confirm",
      actionUrl: confirmUrl,
      footer,
    }),
  };
}

export async function requestSubscription(deps: MailingDeps, rawEmail: string, context: { ip: string }): Promise<SubscribeOutcome> {
  const email = subscribeEmailSchema.parse(rawEmail);
  const now = nowOf(deps);
  const byIp = await consumeRateLimit(deps.prisma, { key: `mailing-ip:${createHash("sha256").update(context.ip).digest("hex").slice(0, 32)}`, ...IP_RATE, now: now.getTime() });
  if (!byIp.allowed) return "rateLimited";

  const existing = await deps.prisma.subscriber.findUnique({ where: { email } });
  if (existing?.status === "CONFIRMED") return "alreadyConfirmed";
  if (existing?.lastConfirmationSentAt && now.getTime() - existing.lastConfirmationSentAt.getTime() < RESEND_GAP_MS) return "recentlySent";
  // Caps how many emails one address can be sent, whoever is asking.
  const byEmail = await consumeRateLimit(deps.prisma, { key: `mailing-email:${emailKey(email)}`, ...EMAIL_RATE, now: now.getTime() });
  if (!byEmail.allowed) return "recentlySent";

  const confirmToken = generateToken();
  const unsubscribeToken = generateToken();
  const data = {
    status: "PENDING" as const,
    confirmTokenHash: hashToken(confirmToken),
    confirmTokenExpiresAt: new Date(now.getTime() + CONFIRM_TTL_MS),
    unsubscribeTokenHash: hashToken(unsubscribeToken),
    lastConfirmationSentAt: now,
  };
  await deps.prisma.subscriber.upsert({ where: { email }, create: { email, ...data }, update: data });
  await deps.send(
    confirmationEmail(email, `${deps.appUrl}/mailing-list/confirm?token=${confirmToken}`, `${deps.appUrl}/mailing-list/unsubscribe?token=${unsubscribeToken}`),
  );
  return "sent";
}

export type TokenState = "valid" | "invalid";

/** Read-only check for the confirm page (the button does the confirming). */
export async function checkConfirmToken(prisma: PrismaClient, token: string, now: Date = new Date()): Promise<TokenState> {
  if (!isWellFormedToken(token)) return "invalid";
  const row = await prisma.subscriber.findUnique({ where: { confirmTokenHash: hashToken(token) }, select: { status: true, confirmTokenExpiresAt: true } });
  return row?.status === "PENDING" && row.confirmTokenExpiresAt && row.confirmTokenExpiresAt > now ? "valid" : "invalid";
}

export async function confirmSubscription(prisma: PrismaClient, token: string, now: Date = new Date()): Promise<boolean> {
  if (!isWellFormedToken(token)) return false;
  const updated = await prisma.subscriber.updateMany({
    where: { confirmTokenHash: hashToken(token), status: "PENDING", confirmTokenExpiresAt: { gt: now } },
    data: { status: "CONFIRMED", confirmedAt: now, confirmTokenHash: null, confirmTokenExpiresAt: null },
  });
  return updated.count === 1;
}

export async function checkUnsubscribeToken(prisma: PrismaClient, token: string): Promise<TokenState> {
  if (!isWellFormedToken(token)) return "invalid";
  return (await prisma.subscriber.count({ where: { unsubscribeTokenHash: hashToken(token) } })) === 1 ? "valid" : "invalid";
}

/** Deletes the subscriber. Returns false if the link was already used. */
export async function unsubscribe(prisma: PrismaClient, token: string): Promise<boolean> {
  if (!isWellFormedToken(token)) return false;
  const deleted = await prisma.subscriber.deleteMany({ where: { unsubscribeTokenHash: hashToken(token) } });
  return deleted.count === 1;
}

/** Deletes unconfirmed sign-ups older than the retention period. */
export async function purgeStalePending(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const deleted = await prisma.subscriber.deleteMany({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - PENDING_RETENTION_DAYS * 24 * 3_600_000) } } });
  return deleted.count;
}

// ---------------------------------------------------------------- Admin

export class MailingError extends Error {
  override readonly name = "MailingError";
  constructor(readonly code: "FORBIDDEN" | "NOT_FOUND") {
    super(code === "FORBIDDEN" ? "Only Admins can manage the mailing list." : "That subscriber is no longer on the list.");
  }
}

function assertAdmin(actor: AuditActor): void {
  if (!can(actor.role, "mailing:manage")) throw new MailingError("FORBIDDEN");
}

export const SUBSCRIBER_PAGE = 50;

export async function listSubscribers(prisma: PrismaClient, actor: AuditActor, options: { search: string; page: number }) {
  assertAdmin(actor);
  const search = options.search.trim().toLowerCase().slice(0, 100);
  const page = Number.isInteger(options.page) && options.page >= 1 ? options.page : 1;
  const where = { status: "CONFIRMED" as const, ...(search ? { email: { contains: search } } : {}) };
  const [rows, matching, confirmed, pending] = await Promise.all([
    prisma.subscriber.findMany({ where, orderBy: { confirmedAt: "desc" }, skip: (page - 1) * SUBSCRIBER_PAGE, take: SUBSCRIBER_PAGE, select: { id: true, email: true, confirmedAt: true } }),
    prisma.subscriber.count({ where }),
    prisma.subscriber.count({ where: { status: "CONFIRMED" } }),
    prisma.subscriber.count({ where: { status: "PENDING" } }),
  ]);
  return { rows, confirmed, pending, page, pageCount: Math.max(1, Math.ceil(matching / SUBSCRIBER_PAGE)) };
}

export async function removeSubscriber(prisma: PrismaClient, actor: AuditActor, id: string, meta: { requestId?: string | null } = {}): Promise<void> {
  assertAdmin(actor);
  const subscriberId = z.uuid().parse(id);
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.subscriber.deleteMany({ where: { id: subscriberId } });
    if (deleted.count !== 1) throw new MailingError("NOT_FOUND");
    // No email in the log: removal is how someone's data is deleted.
    await writeAudit(tx, { actor, action: "mailing.remove", targetType: "subscriber", targetId: subscriberId, requestId: meta.requestId });
  });
}

/** Spreadsheet apps run cells starting with these as formulas; prefix them so they stay text. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Confirmed subscribers as CSV (email, confirmed_at in UTC), ready for Mailchimp and similar. */
export async function exportSubscribersCsv(prisma: PrismaClient, actor: AuditActor, meta: { requestId?: string | null } = {}): Promise<{ csv: string; count: number }> {
  assertAdmin(actor);
  const rows = await prisma.subscriber.findMany({ where: { status: "CONFIRMED" }, orderBy: { confirmedAt: "asc" }, select: { email: true, confirmedAt: true } });
  const lines = ["email,confirmed_at", ...rows.map((row) => `${csvCell(row.email)},${row.confirmedAt?.toISOString() ?? ""}`)];
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, { actor, action: "mailing.export", targetType: "subscriber", targetId: "all", after: { count: rows.length }, requestId: meta.requestId });
  });
  return { csv: `${lines.join("\r\n")}\r\n`, count: rows.length };
}
