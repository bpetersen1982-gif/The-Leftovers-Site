"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { can } from "@/lib/permissions";
import type { PhotoDeps } from "@/lib/photos/deps";
import { PhotoError } from "@/lib/photos/errors";
import { completeUpload, createUpload } from "@/lib/photos/upload";
import {
  approvePhotos,
  type BulkResult,
  deleteUnpublishedPhoto,
  rejectPhotos,
  submitPhotos,
  updatePhotoDetails,
} from "@/lib/photos/workflow";
import { photoDetailsSchema, photoRefSchema, type PhotoRef, uploadRequestSchema } from "@/lib/photos/validation";
import { getRequestId } from "@/lib/request-id";
import { objectStorage } from "@/lib/storage";
import type { ActionState } from "../action-state";

/**
 * Server actions for /admin/photos. Next.js checks the Origin of every server action
 * (CSRF); each action re-checks the signed-in user's permission, and the photo services
 * enforce ownership and state rules.
 */

const PHOTO_PATHS = ["/admin/photos", "/photos"] as const;

function refresh(): void {
  for (const path of PHOTO_PATHS) revalidatePath(path);
}

function photoDeps(): PhotoDeps {
  const storage = objectStorage();
  if (!storage) throw new PhotoError("STORAGE_DISABLED");
  return { prisma: db(), storage };
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the details and try again.";
}

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

/** Expected failures become a message; anything else propagates (and is logged by Next). */
function expectedMessage(error: unknown): string {
  if (error instanceof PhotoError) return error.message;
  if (error instanceof z.ZodError) return firstIssue(error);
  throw error;
}

function expected(error: unknown): ActionState {
  return { ok: false, message: expectedMessage(error) };
}

// ---------------------------------------------------------------- uploads (called from the uploader)

export type StartUploadResult =
  | { readonly ok: true; readonly photoId: string; readonly url: string; readonly headers: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly message: string };

export async function startPhotoUploadAction(input: { filename: string; contentType: string; size: number }): Promise<StartUploadResult> {
  const actor = await requirePermission("photos:upload");
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  try {
    const created = await createUpload(photoDeps(), actor, parsed.data);
    return { ok: true, photoId: created.photoId, url: created.upload.url, headers: created.upload.headers };
  } catch (error) {
    return { ok: false, message: expectedMessage(error) };
  }
}

export type FinishUploadResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export async function finishPhotoUploadAction(photoId: string): Promise<FinishUploadResult> {
  const actor = await requirePermission("photos:upload");
  const id = z.uuid().safeParse(photoId);
  if (!id.success) return { ok: false, message: "That upload isn't valid." };
  try {
    const result = await completeUpload(photoDeps(), actor, id.data);
    refresh();
    return result.status === "DRAFT" ? { ok: true } : { ok: false, message: result.reason };
  } catch (error) {
    if (error instanceof PhotoError) return { ok: false, message: error.message };
    logger.error({ err: error, photoId: id.data, requestId: await getRequestId() }, "finishing photo upload failed");
    return { ok: false, message: "Something went wrong processing this photo. Try uploading it again." };
  }
}

// ---------------------------------------------------------------- details, submit, delete

/** Save alt text/caption/credit; with intent=submit, also publish (Admin) or send for review (Member). */
export async function savePhotoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("photos:upload");
  const parsed = photoDetailsSchema.safeParse({
    id: formData.get("id"),
    version: formData.get("version"),
    altText: formData.get("altText") ?? "",
    caption: formData.get("caption") ?? "",
    credit: formData.get("credit") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const submit = formData.get("intent") === "submit";
  if (submit && parsed.data.altText === "") {
    return { ok: false, message: "Add alt text first.", fieldErrors: { altText: "Describe the photo in a few words (required)." } };
  }
  const requestId = await getRequestId();
  try {
    const deps = photoDeps();
    const version = await updatePhotoDetails(deps, actor, parsed.data);
    if (!submit) {
      refresh();
      return { ok: true, message: "Saved." };
    }
    const [result] = await submitPhotos(deps, actor, [{ id: parsed.data.id, version }], requestId);
    refresh();
    return submitMessage(result, can(actor.role, "photos:publishDirectly"));
  } catch (error) {
    return expected(error);
  }
}

function submitMessage(result: BulkResult | undefined, publishes: boolean): ActionState {
  switch (result?.outcome) {
    case "done":
      return { ok: true, message: publishes ? "Published." : "Sent to the Admins for review." };
    case "needsAltText":
      return { ok: false, message: "Add alt text first." };
    case "conflict":
      return { ok: false, message: new PhotoError("CONFLICT").message };
    default:
      return { ok: false, message: new PhotoError("INVALID_STATE").message };
  }
}

export async function deletePhotoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("photos:upload");
  const parsed = photoRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
  if (!parsed.success) return { ok: false, message: "That photo isn't valid." };
  try {
    await deleteUnpublishedPhoto(photoDeps(), actor, parsed.data, await getRequestId());
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: "Photo deleted." };
}

// ---------------------------------------------------------------- review (Admins)

/** Checkbox values are "id:version", so a stale page can't approve a changed photo. */
function parseSelection(formData: FormData): PhotoRef[] | null {
  const refs: PhotoRef[] = [];
  for (const value of formData.getAll("photo")) {
    const [id, version] = String(value).split(":");
    const parsed = photoRefSchema.safeParse({ id, version });
    if (!parsed.success) return null;
    refs.push(parsed.data);
  }
  return refs;
}

function reviewSummary(results: readonly BulkResult[], verb: "Approved" | "Rejected"): ActionState {
  const done = results.filter((result) => result.outcome === "done").length;
  const skipped = results.length - done;
  const noun = (count: number) => `${count} photo${count === 1 ? "" : "s"}`;
  const parts = [done > 0 ? `${verb} ${noun(done)}.` : null];
  if (skipped > 0) parts.push(`${noun(skipped)} skipped: someone else already handled ${skipped === 1 ? "it" : "them"}, or it changed. Reload to see.`);
  return { ok: skipped === 0, message: parts.filter(Boolean).join(" ") };
}

export async function reviewPhotosAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("photos:review");
  const refs = parseSelection(formData);
  if (!refs) return { ok: false, message: "Reload the page and try again." };
  if (refs.length === 0) return { ok: false, message: "Tick at least one photo first." };
  const intent = formData.get("intent");
  const requestId = await getRequestId();
  try {
    const deps = photoDeps();
    if (intent === "approve") {
      const results = await approvePhotos(deps, actor, refs, requestId);
      refresh();
      return reviewSummary(results, "Approved");
    }
    if (intent === "reject") {
      const results = await rejectPhotos(deps, actor, refs, String(formData.get("reason") ?? ""), requestId);
      refresh();
      return reviewSummary(results, "Rejected");
    }
    return { ok: false, message: "Choose approve or reject." };
  } catch (error) {
    return expected(error);
  }
}
