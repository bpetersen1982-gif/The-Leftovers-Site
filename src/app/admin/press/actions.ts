"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { completePressUpload, deletePressFile, PressError, setPressPhotos, setPressVideos, startPressUpload } from "@/lib/press/service";
import { getRequestId } from "@/lib/request-id";
import { objectStorage } from "@/lib/storage";
import type { ActionState } from "../action-state";

function refresh(): void {
  revalidatePath("/admin/press");
  revalidatePath("/press");
}

function storage() {
  const configured = objectStorage();
  if (!configured) throw new PressError("STORAGE_DISABLED", "File storage isn't set up on this server.");
  return configured;
}

function message(error: unknown): string {
  if (error instanceof PressError) return error.message;
  if (error instanceof z.ZodError) return "That file isn't valid.";
  throw error;
}

export async function startPressUploadAction(input: { kind: string; filename: string; contentType: string; size: number }) {
  const actor = await requirePermission("press:manage");
  try {
    const started = await startPressUpload({ prisma: db(), storage: storage() }, actor, input);
    return { ok: true as const, uploadId: started.uploadId, url: started.upload.url, headers: { ...started.upload.headers } };
  } catch (error) {
    return { ok: false as const, message: message(error) };
  }
}

export async function completePressUploadAction(input: { kind: string; uploadId: string }): Promise<{ ok: boolean; message: string }> {
  const actor = await requirePermission("press:manage");
  try {
    await completePressUpload({ prisma: db(), storage: storage() }, actor, input, await getRequestId());
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  refresh();
  return { ok: true, message: "Uploaded. It's on the press kit now." };
}

export async function deletePressFileAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("press:manage");
  try {
    await deletePressFile({ prisma: db(), storage: storage() }, actor, String(formData.get("kind") ?? ""), await getRequestId());
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  refresh();
  return { ok: true, message: "Removed." };
}

export async function savePressPhotosAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("press:manage");
  try {
    const count = await setPressPhotos(db(), actor, formData.getAll("photoId").map(String), await getRequestId());
    refresh();
    return { ok: true, message: `Saved: ${count} press photo${count === 1 ? "" : "s"}.` };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

export async function savePressVideosAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("press:manage");
  try {
    const count = await setPressVideos(db(), actor, formData.getAll("videoId").map(String), await getRequestId());
    refresh();
    return { ok: true, message: `Saved: ${count} video highlight${count === 1 ? "" : "s"}.` };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
