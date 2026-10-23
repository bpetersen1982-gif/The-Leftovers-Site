"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { removeSubscription, saveSubscription, sendPushToUsers, subscriptionSchema, vapidPublicKey } from "@/lib/push";
import type { ActionState } from "../action-state";

/** Device subscriptions and alert preferences (requirements NOT-1, NOT-5, NOT-6). Own account only. */

export async function savePushSubscriptionAction(subscription: unknown): Promise<ActionState> {
  const user = await requirePermission("account:managePasskeys");
  if (!vapidPublicKey()) return { ok: false, message: "Phone alerts aren't set up on the server yet." };
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, message: "This browser sent an invalid subscription." };
  await saveSubscription(db(), user.id, parsed.data);
  logger.info({ userId: user.id }, "push subscription saved");
  revalidatePath("/admin/account");
  return { ok: true, message: "Alerts are on for this device." };
}

export async function removePushSubscriptionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("account:managePasskeys");
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Invalid device." };
  const removed = await removeSubscription(db(), user.id, id.data);
  revalidatePath("/admin/account");
  return removed ? { ok: true, message: "Device removed." } : { ok: false, message: "That device was already removed." };
}

export async function sendTestPushAction(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("account:managePasskeys");
  const delivered = await sendPushToUsers(db(), [user.id], {
    title: "The Leftovers",
    body: "Test alert: phone alerts are working.",
    url: "/admin/account",
    tag: "test",
  });
  revalidatePath("/admin/account");
  return delivered > 0
    ? { ok: true, message: `Sent to ${delivered} device${delivered === 1 ? "" : "s"}. It should appear in a few seconds.` }
    : { ok: false, message: "No device received it. Turn alerts on for this device first." };
}

export async function saveAlertPreferencesAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("account:managePasskeys");
  await db().user.update({
    where: { id: user.id },
    data: { bookingEmailAlerts: formData.get("email") === "on", bookingPushAlerts: formData.get("push") === "on" },
  });
  revalidatePath("/admin/account");
  return { ok: true, message: "Saved." };
}
