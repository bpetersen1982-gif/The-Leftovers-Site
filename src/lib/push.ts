import webpush, { WebPushError } from "web-push";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { logger } from "./logger";

/**
 * Web Push (requirements NOT-1..NOT-3): free phone/desktop alerts via the browser's push
 * service. Payloads never contain phone numbers, emails, or prices (they can show on a
 * lock screen), only a short summary and a link that requires login.
 *
 * Push is optional: without VAPID keys configured, sends are skipped and email still goes out.
 */

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  /** Same-origin path to open when tapped. */
  readonly url: string;
  /** Collapses repeated alerts about the same thing. */
  readonly tag?: string;
}

interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

export function vapidConfig(source: Readonly<Record<string, string | undefined>> = process.env): VapidConfig | null {
  const publicKey = source.VAPID_PUBLIC_KEY?.trim();
  const privateKey = source.VAPID_PRIVATE_KEY?.trim();
  const subject = source.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Public key for the browser's PushManager.subscribe (safe to expose). */
export function vapidPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

export const subscriptionSchema = z.strictObject({
  endpoint: z.url().max(1_000).refine((value) => value.startsWith("https://"), "Push endpoints must be https"),
  keys: z.strictObject({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  label: z.string().trim().max(40).default("This device"),
});

export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

/** Saves (or moves to this user) a device subscription. */
export async function saveSubscription(prisma: PrismaClient, userId: string, input: SubscriptionInput): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, label: input.label },
    update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, label: input.label },
  });
}

export async function removeSubscription(prisma: PrismaClient, userId: string, id: string): Promise<boolean> {
  const removed = await prisma.pushSubscription.deleteMany({ where: { id, userId } });
  return removed.count === 1;
}

/**
 * Sends to every device of the given users. Dead subscriptions (404/410 from the push
 * service) are deleted. Never throws: push is best-effort; email is the record (NOT-4).
 */
export async function sendPushToUsers(prisma: PrismaClient, userIds: readonly string[], payload: PushPayload): Promise<number> {
  const config = vapidConfig();
  if (!config || userIds.length === 0) return 0;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: [...userIds] } } });
  const body = JSON.stringify(payload);
  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          body,
          { vapidDetails: config, TTL: 60 * 60 * 24, urgency: "high", timeout: 10_000 },
        );
        await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { lastSuccessAt: new Date() } });
        return true;
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
          logger.info({ subscriptionId: subscription.id }, "removed expired push subscription");
        } else {
          logger.warn({ subscriptionId: subscription.id, err: error }, "push send failed");
        }
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
