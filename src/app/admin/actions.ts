"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/mail/mailer";
import { inviteEmail } from "@/lib/mail/templates";
import { ROLE_LABELS } from "@/lib/permissions";
import { getRequestId } from "@/lib/request-id";
import { UserServiceError } from "@/lib/users/errors";
import { INVITE_TTL_HOURS, changeRole, createInvite, deactivateUser, revokeInvite } from "@/lib/users/service";
import { changeRoleInputSchema, inviteIdSchema, inviteInputSchema, userIdSchema } from "@/lib/users/validation";
import type { ActionState } from "./action-state";

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}

/** Maps expected service errors to a message; anything else propagates (logged by Next). */
function expectedFailure(error: unknown): ActionState {
  if (error instanceof UserServiceError) return { ok: false, message: error.message };
  throw error;
}

export async function inviteUserAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("users:invite");
  const parsed = inviteInputSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };

  const requestId = await getRequestId();
  let created;
  try {
    created = await createInvite(db(), { actor, ...parsed.data, requestId });
  } catch (error) {
    return expectedFailure(error);
  }

  const url = `${env().APP_URL}/invite/${created.token}`;
  try {
    await sendEmail(
      inviteEmail({
        to: parsed.data.email,
        inviteeName: parsed.data.name,
        inviterName: actor.name,
        roleLabel: ROLE_LABELS[parsed.data.role],
        url,
        expiresHours: INVITE_TTL_HOURS,
      }),
      { kind: "invite" },
    );
  } catch {
    // Don't leave a live invite nobody received. sendEmail already logged the cause.
    await revokeInvite(db(), { actor, inviteId: created.inviteId, requestId });
    revalidatePath("/admin/users");
    return { ok: false, message: "The invite email couldn't be sent, so the invite was cancelled. Try again in a minute." };
  }

  logger.info({ requestId, inviteId: created.inviteId }, "invite sent");
  revalidatePath("/admin/users");
  return { ok: true, message: `Invite sent to ${parsed.data.name}. The link works for ${INVITE_TTL_HOURS} hours.` };
}

export async function revokeInviteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("users:invite");
  const inviteId = inviteIdSchema.safeParse(formData.get("inviteId"));
  if (!inviteId.success) return { ok: false, message: "Invalid invite." };
  try {
    await revokeInvite(db(), { actor, inviteId: inviteId.data, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidatePath("/admin/users");
  return { ok: true, message: "Invite cancelled." };
}

export async function changeRoleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("users:changeRole");
  const parsed = changeRoleInputSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { ok: false, message: "Invalid role change." };
  try {
    await changeRole(db(), { actor, ...parsed.data, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidatePath("/admin/users");
  return { ok: true, message: `Role changed to ${ROLE_LABELS[parsed.data.role]}. They'll need to log in again.` };
}

export async function deactivateUserAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("users:deactivate");
  const userId = userIdSchema.safeParse(formData.get("userId"));
  if (!userId.success) return { ok: false, message: "Invalid user." };
  if (formData.get("confirm") !== "yes") return { ok: false, message: "Check the box to confirm removal." };
  try {
    await deactivateUser(db(), { actor, userId: userId.data, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidatePath("/admin/users");
  // The removed row unmounts, so confirm at page level instead of inside the row.
  redirect("/admin/users?notice=removed");
}
