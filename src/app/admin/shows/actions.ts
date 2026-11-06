"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getRequestId } from "@/lib/request-id";
import { createShow, createShowFromBooking, deleteShow, type ShowInput, ShowError, showRefSchema, updateShow } from "@/lib/shows/service";
import type { ActionState } from "../action-state";

function refresh(): void {
  revalidatePath("/admin/shows", "layout");
  revalidatePath("/shows", "layout");
  revalidatePath("/");
}

function showFrom(formData: FormData): ShowInput {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    date: text("date"),
    startTime: text("startTime"),
    endTime: text("endTime"),
    venueName: text("venueName"),
    street: text("street"),
    city: text("city"),
    state: text("state"),
    ticketUrl: text("ticketUrl"),
    priceText: text("priceText"),
    description: text("description"),
    status: (text("status") || "SCHEDULED") as ShowInput["status"],
    isPublic: formData.get("isPublic") === "on",
  };
}

function expected(error: unknown): ActionState {
  if (error instanceof ShowError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, message: "Fix the highlighted fields.", fieldErrors };
  }
  throw error;
}

export async function createShowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("shows:manage");
  let id: string;
  try {
    id = await createShow(db(), actor, showFrom(formData), { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  redirect(`/admin/shows/${id}?notice=created`);
}

export async function updateShowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("shows:manage");
  const ref = showRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    await updateShow(db(), actor, ref.data, showFrom(formData), { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteShowAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("shows:manage");
  const ref = showRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    await deleteShow(db(), actor, ref.data, { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  redirect("/admin/shows?notice=deleted");
}

/** BOOK-20: one click from a confirmed booking. */
export async function showFromBookingAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("shows:manage");
  const bookingId = z.uuid().safeParse(formData.get("bookingId"));
  if (!bookingId.success) return { ok: false, message: "Reload the page and try again." };
  let id: string;
  try {
    id = await createShowFromBooking(db(), actor, bookingId.data, { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  redirect(`/admin/shows/${id}?notice=fromBooking`);
}
