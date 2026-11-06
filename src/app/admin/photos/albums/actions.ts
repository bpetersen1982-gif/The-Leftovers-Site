"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  addPhotosToAlbum,
  AlbumError,
  type AlbumInput,
  albumRefSchema,
  createAlbum,
  deleteAlbum,
  movePhotoInAlbum,
  removePhotoFromAlbum,
  setAlbumCover,
  updateAlbum,
} from "@/lib/photos/albums";
import { getRequestId } from "@/lib/request-id";
import type { ActionState } from "../../action-state";

/**
 * Album server actions (Admins only). Each re-checks permission; the album service checks
 * versions so a stale page can't overwrite someone else's change.
 */

function refresh(): void {
  revalidatePath("/admin/photos", "layout");
  revalidatePath("/photos", "layout");
}

function detailsFrom(formData: FormData): AlbumInput {
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    eventDate: String(formData.get("eventDate") ?? ""),
    isPublic: formData.get("isPublic") === "on",
    showId: String(formData.get("showId") ?? ""),
  };
}

function refFrom(formData: FormData) {
  return albumRefSchema.safeParse({ id: formData.get("albumId"), version: formData.get("version") });
}

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

/** Expected failures become a message; anything else propagates (logged by Next). */
function expected(error: unknown): ActionState {
  if (error instanceof AlbumError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(error) };
  throw error;
}

export async function createAlbumAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("albums:manage");
  let id: string;
  try {
    ({ id } = await createAlbum(db(), actor, detailsFrom(formData), { requestId: await getRequestId() }));
  } catch (error) {
    return expected(error);
  }
  refresh();
  redirect(`/admin/photos/albums/${id}?notice=created`);
}

export async function updateAlbumAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("albums:manage");
  const ref = refFrom(formData);
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    await updateAlbum(db(), actor, ref.data, detailsFrom(formData), { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteAlbumAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("albums:manage");
  const ref = refFrom(formData);
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    await deleteAlbum(db(), actor, ref.data, { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  redirect("/admin/photos/albums?notice=deleted");
}

export async function addAlbumPhotosAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("albums:manage");
  const ref = refFrom(formData);
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  const photoIds = formData.getAll("photoId").map(String);
  if (photoIds.length === 0) return { ok: false, message: "Tick at least one photo first." };
  try {
    const added = await addPhotosToAlbum(db(), actor, ref.data, photoIds, { requestId: await getRequestId() });
    refresh();
    return { ok: true, message: `Added ${added} photo${added === 1 ? "" : "s"}.` };
  } catch (error) {
    return expected(error);
  }
}

const photoIntentSchema = z.enum(["up", "down", "cover", "remove"]);

/** Per-photo controls inside an album: move up/down, make cover, remove from album. */
export async function albumPhotoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("albums:manage");
  const ref = refFrom(formData);
  const intent = photoIntentSchema.safeParse(formData.get("intent"));
  const photoId = z.uuid().safeParse(formData.get("photoId"));
  if (!ref.success || !intent.success || !photoId.success) return { ok: false, message: "Reload the page and try again." };
  const requestId = await getRequestId();
  try {
    switch (intent.data) {
      case "up":
      case "down":
        await movePhotoInAlbum(db(), actor, ref.data, photoId.data, intent.data);
        break;
      case "cover":
        await setAlbumCover(db(), actor, ref.data, photoId.data, { requestId });
        break;
      case "remove":
        await removePhotoFromAlbum(db(), actor, ref.data, photoId.data, { requestId });
        break;
    }
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: null };
}
