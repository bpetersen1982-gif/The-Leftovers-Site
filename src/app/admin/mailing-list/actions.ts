"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { MailingError, removeSubscriber } from "@/lib/mailing/service";
import { getRequestId } from "@/lib/request-id";
import type { ActionState } from "../action-state";

export async function removeSubscriberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("mailing:manage");
  try {
    await removeSubscriber(db(), actor, String(formData.get("id") ?? ""), { requestId: await getRequestId() });
  } catch (error) {
    if (error instanceof MailingError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/admin/mailing-list");
  return { ok: true, message: "Removed." };
}
