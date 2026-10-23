"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AvailabilityError, availabilityInputSchema, createAvailabilityBlock, deleteAvailabilityBlock } from "@/lib/availability/service";
import { todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getRequestId } from "@/lib/request-id";
import type { ActionState } from "../action-state";

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

function revalidate(): void {
  revalidatePath("/admin/availability");
  revalidatePath("/book");
}

export async function addAvailabilityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("availability:manageOwn");
  const scope = formData.get("scope") === "BAND" ? "BAND" : "MEMBER";
  // Members can't choose whose dates these are: always their own.
  const userId = scope === "BAND" ? undefined : can(actor.role, "availability:manageAll") ? String(formData.get("userId") ?? "") : actor.id;

  const parsed = availabilityInputSchema(todayInBandTimeZone()).safeParse({
    scope,
    userId: userId || undefined,
    startDate: formData.get("startDate"),
    // A single day is the common case: blank end date = same as start.
    endDate: formData.get("endDate") || formData.get("startDate"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    await createAvailabilityBlock(db(), { actor, block: parsed.data, requestId: await getRequestId() });
  } catch (error) {
    if (error instanceof AvailabilityError) return { ok: false, message: error.message };
    throw error;
  }
  revalidate();
  return { ok: true, message: scope === "BAND" ? "Band marked unavailable." : "Out-of-office dates added." };
}

export async function deleteAvailabilityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("availability:manageOwn");
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Invalid entry." };
  try {
    await deleteAvailabilityBlock(db(), { actor, id: id.data, requestId: await getRequestId() });
  } catch (error) {
    if (error instanceof AvailabilityError) return { ok: false, message: error.message };
    throw error;
  }
  revalidate();
  return { ok: true, message: "Removed." };
}
