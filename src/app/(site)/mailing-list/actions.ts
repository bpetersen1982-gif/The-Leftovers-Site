"use server";

import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/mail/mailer";
import { confirmSubscription, requestSubscription, unsubscribe } from "@/lib/mailing/service";
import { turnstileConfig, turnstileMessage, verifyTurnstile } from "@/lib/turnstile";

const MIN_FILL_MS = 2_000;
const CHECK_INBOX = "Check your inbox for a confirmation email. You're on the list once you tap the link in it.";

const inputSchema = z.object({ email: z.string().max(500), website: z.string().max(500), startedAt: z.number(), turnstileToken: z.string().max(4_096) });

export async function subscribeAction(raw: unknown): Promise<{ ok: boolean; message: string }> {
  const input = inputSchema.safeParse(raw);
  if (!input.success) return { ok: false, message: "Something about that form was off. Reload and try again." };
  // Bots: believable success, nothing saved or sent.
  if (input.data.website !== "" || Date.now() - input.data.startedAt < MIN_FILL_MS) return { ok: true, message: CHECK_INBOX };

  const turnstile = turnstileConfig();
  if (!turnstile) return { ok: false, message: "Sign-ups are paused right now. Try again later." };
  const ip = await clientIp();
  const check = await verifyTurnstile({ secretKey: turnstile.secretKey, token: input.data.turnstileToken, remoteIp: ip, expectedAction: "mailing-list" });
  if (!check.ok) return { ok: false, message: turnstileMessage(check) };

  try {
    const outcome = await requestSubscription(
      { prisma: db(), appUrl: env().APP_URL, send: (message) => sendEmail(message, { kind: "mailing-confirm" }) },
      input.data.email,
      { ip },
    );
    if (outcome === "rateLimited") return { ok: false, message: "That's a lot of sign-ups from here. Try again in a little while." };
    // Same reply whether or not they were already on the list.
    return { ok: true, message: CHECK_INBOX };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Enter a real email address." };
    logger.error({ err: error }, "mailing list sign-up failed");
    return { ok: false, message: "We couldn't send the confirmation email just now. Try again in a few minutes." };
  }
}

export async function confirmAction(token: unknown): Promise<boolean> {
  return typeof token === "string" && (await confirmSubscription(db(), token));
}

export async function unsubscribeAction(token: unknown): Promise<boolean> {
  return typeof token === "string" && (await unsubscribe(db(), token));
}
