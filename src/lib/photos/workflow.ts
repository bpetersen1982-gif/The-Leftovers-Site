import type { Prisma } from "@/generated/prisma/client";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { logger } from "../logger";
import { can } from "../permissions";
import { PhotoError } from "./errors";
import type { PhotoDeps } from "./deps";
import {
  newPublicPrefix,
  parseStoredFiles,
  privateFileKey,
  PUBLIC_CACHE_CONTROL,
  publicFileKey,
  removePrivateFiles,
} from "./files";
import {
  bulkRefsSchema,
  type PhotoDetailsInput,
  photoDetailsSchema,
  type PhotoRef,
  photoRefSchema,
  rejectionReasonSchema,
} from "./validation";

/**
 * Review workflow (requirements APR-1, APR-2, APR-5, APR-6, APR-9, APR-11, MED-4):
 *
 *   DRAFT --submit(Admin)--> APPROVED            (Admin uploads publish directly)
 *   DRAFT --submit(Member)--> PENDING_REVIEW --approve--> APPROVED
 *                                            --reject---> REJECTED --edit+submit--> ...
 *
 * Every change is version-checked: two people acting at once can't both win. Publishing
 * copies files to the public bucket under a fresh random prefix *before* the database
 * flips to APPROVED, and removes them again if the flip loses a race, so the public page
 * never shows a photo whose files aren't there.
 */

type PhotoRow = Prisma.PhotoGetPayload<object>;

/** Statuses where the photo has never been public, so it can simply be deleted (APR-6). */
const DELETABLE: readonly PhotoStatus[] = ["UPLOADING", "DRAFT", "PENDING_REVIEW", "REJECTED", "FAILED"];
const EDITABLE: readonly PhotoStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED", "APPROVED"];
const SUBMITTABLE: readonly PhotoStatus[] = ["DRAFT", "REJECTED"];

export type BulkOutcome = "done" | "conflict" | "invalid" | "missing" | "needsAltText" | "forbidden";
export interface BulkResult {
  readonly id: string;
  readonly outcome: BulkOutcome;
}

function nowOf(deps: PhotoDeps): Date {
  return deps.now?.() ?? new Date();
}

async function load(deps: PhotoDeps, ref: PhotoRef): Promise<PhotoRow> {
  const photo = await deps.prisma.photo.findUnique({ where: { id: ref.id } });
  if (!photo) throw new PhotoError("NOT_FOUND");
  if (photo.version !== ref.version) throw new PhotoError("CONFLICT");
  return photo;
}

/** Members may only touch their own photos; Admins any (APR-6). */
function assertOwnerOrAdmin(actor: AuditActor, photo: PhotoRow): void {
  if (photo.uploaderId !== actor.id && !can(actor.role, "photos:manageAll")) throw new PhotoError("FORBIDDEN");
}

async function updateVersioned(deps: PhotoDeps, ref: PhotoRef, from: readonly PhotoStatus[], data: Prisma.PhotoUncheckedUpdateManyInput) {
  const updated = await deps.prisma.photo.updateMany({
    where: { id: ref.id, version: ref.version, status: { in: [...from] } },
    data: { ...data, version: { increment: 1 } },
  });
  return updated.count === 1;
}

/** Saves alt text, caption, and credit. Returns the new version. */
export async function updatePhotoDetails(deps: PhotoDeps, actor: AuditActor, input: PhotoDetailsInput): Promise<number> {
  const details = photoDetailsSchema.parse(input);
  const photo = await load(deps, details);
  assertOwnerOrAdmin(actor, photo);
  if (!EDITABLE.includes(photo.status)) throw new PhotoError("INVALID_STATE");
  // Published Admin-approved details are the Admins' call (APR-5).
  if (photo.status === "APPROVED" && !can(actor.role, "photos:review")) throw new PhotoError("FORBIDDEN");
  // Once submitted, alt text can't be cleared (MED-4).
  if (photo.status !== "DRAFT" && details.altText === "") throw new PhotoError("ALT_TEXT_REQUIRED");

  const ok = await updateVersioned(deps, details, [photo.status], {
    altText: details.altText,
    caption: details.caption,
    credit: details.credit,
  });
  if (!ok) throw new PhotoError("CONFLICT");
  return details.version + 1;
}

/** Copies a photo's files to the public bucket under a new prefix. Cleans up on failure. */
async function copyToPublic(deps: PhotoDeps, photo: PhotoRow): Promise<{ prefix: string; keys: string[] }> {
  const files = parseStoredFiles(photo.variants);
  if (files.length === 0) throw new PhotoError("INVALID_STATE");
  const prefix = newPublicPrefix(photo.id);
  const keys: string[] = [];
  try {
    for (const file of files) {
      const key = publicFileKey(prefix, file.file);
      await deps.storage.publish(privateFileKey(photo.id, file.file), key, {
        contentType: file.contentType,
        cacheControl: PUBLIC_CACHE_CONTROL,
      });
      keys.push(key);
    }
    return { prefix, keys };
  } catch (error) {
    await removePublicCopies(deps, photo.id, keys);
    throw error;
  }
}

async function removePublicCopies(deps: PhotoDeps, photoId: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await deps.storage.deletePublic(keys).catch((error: unknown) => {
    // Orphaned public files are unreachable (random prefix, not in the database) but still cost storage.
    logger.error({ err: error, photoId, keys }, "failed to remove public photo files");
  });
}

/** Publishes one photo the actor is allowed to publish. Returns false if it lost a race. */
async function publish(deps: PhotoDeps, actor: AuditActor, photo: PhotoRow, from: readonly PhotoStatus[], requestId?: string | null): Promise<boolean> {
  const { prefix, keys } = await copyToPublic(deps, photo);
  const now = nowOf(deps);
  const won = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.photo.updateMany({
      where: { id: photo.id, version: photo.version, status: { in: [...from] } },
      data: {
        status: "APPROVED",
        publicPrefix: prefix,
        publishedAt: now,
        submittedAt: photo.submittedAt ?? now,
        decidedAt: now,
        decidedById: actor.id,
        decidedByRole: actor.role,
        rejectionReason: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    await writeAudit(tx, {
      actor,
      action: photo.status === "PENDING_REVIEW" ? "photo.approve" : "photo.publish",
      targetType: "photo",
      targetId: photo.id,
      before: { status: photo.status },
      after: { status: "APPROVED", uploaderId: photo.uploaderId },
      requestId,
    });
    return true;
  });
  if (!won) await removePublicCopies(deps, photo.id, keys);
  return won;
}

async function submitOne(deps: PhotoDeps, actor: AuditActor, ref: PhotoRef, requestId?: string | null): Promise<BulkOutcome> {
  const photo = await deps.prisma.photo.findUnique({ where: { id: ref.id } });
  if (!photo) return "missing";
  // Only the uploader sends their own drafts on; Admins approve Members' photos instead.
  if (photo.uploaderId !== actor.id) return "forbidden";
  if (photo.version !== ref.version) return "conflict";
  if (!SUBMITTABLE.includes(photo.status)) return "invalid";
  if (photo.altText.trim() === "") return "needsAltText";

  if (can(actor.role, "photos:publishDirectly")) {
    return (await publish(deps, actor, photo, SUBMITTABLE, requestId)) ? "done" : "conflict";
  }
  const ok = await updateVersioned(deps, ref, SUBMITTABLE, {
    status: "PENDING_REVIEW",
    submittedAt: nowOf(deps),
    rejectionReason: null,
    decidedAt: null,
    decidedById: null,
    decidedByRole: null,
  });
  return ok ? "done" : "conflict";
}

/**
 * Sends the uploader's drafts on: Admins publish immediately (APR-2), Members' photos
 * wait for an Admin. Alt text is required (MED-4).
 */
export async function submitPhotos(deps: PhotoDeps, actor: AuditActor, refs: readonly PhotoRef[], requestId?: string | null): Promise<BulkResult[]> {
  if (!can(actor.role, "photos:upload")) throw new PhotoError("FORBIDDEN");
  const items = bulkRefsSchema.parse(refs);
  const results: BulkResult[] = [];
  for (const ref of items) results.push({ id: ref.id, outcome: await submitOne(deps, actor, ref, requestId) });
  return results;
}

/** Admin approval of Members' photos (APR-2, APR-9). First write wins (APR-11). */
export async function approvePhotos(deps: PhotoDeps, actor: AuditActor, refs: readonly PhotoRef[], requestId?: string | null): Promise<BulkResult[]> {
  if (!can(actor.role, "photos:review")) throw new PhotoError("FORBIDDEN");
  const items = bulkRefsSchema.parse(refs);
  const results: BulkResult[] = [];
  for (const ref of items) {
    const photo = await deps.prisma.photo.findUnique({ where: { id: ref.id } });
    let outcome: BulkOutcome;
    if (!photo) outcome = "missing";
    else if (photo.version !== ref.version) outcome = "conflict";
    else if (photo.status !== "PENDING_REVIEW") outcome = "invalid";
    else if (photo.altText.trim() === "") outcome = "needsAltText";
    else outcome = (await publish(deps, actor, photo, ["PENDING_REVIEW"], requestId)) ? "done" : "conflict";
    results.push({ id: ref.id, outcome });
  }
  return results;
}

/** Admin rejection with an optional reason the uploader sees (APR-9). */
export async function rejectPhotos(
  deps: PhotoDeps,
  actor: AuditActor,
  refs: readonly PhotoRef[],
  reason: string,
  requestId?: string | null,
): Promise<BulkResult[]> {
  if (!can(actor.role, "photos:review")) throw new PhotoError("FORBIDDEN");
  const items = bulkRefsSchema.parse(refs);
  const cleanReason = rejectionReasonSchema.parse(reason);
  const now = nowOf(deps);
  const results: BulkResult[] = [];
  for (const ref of items) {
    const outcome = await deps.prisma.$transaction(async (tx): Promise<BulkOutcome> => {
      const updated = await tx.photo.updateMany({
        where: { id: ref.id, version: ref.version, status: "PENDING_REVIEW" },
        data: {
          status: "REJECTED",
          rejectionReason: cleanReason || null,
          decidedAt: now,
          decidedById: actor.id,
          decidedByRole: actor.role,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const current = await tx.photo.findUnique({ where: { id: ref.id }, select: { version: true } });
        if (!current) return "missing";
        return current.version !== ref.version ? "conflict" : "invalid";
      }
      await writeAudit(tx, {
        actor,
        action: "photo.reject",
        targetType: "photo",
        targetId: ref.id,
        after: { status: "REJECTED", reason: cleanReason },
        requestId,
      });
      return "done";
    });
    results.push({ id: ref.id, outcome });
  }
  return results;
}

/**
 * Permanently deletes a photo that was never public (APR-6): Members their own, Admins any.
 * Published photos go through the deletion-request flow instead (APR-7).
 */
export async function deleteUnpublishedPhoto(deps: PhotoDeps, actor: AuditActor, input: PhotoRef, requestId?: string | null): Promise<void> {
  const ref = photoRefSchema.parse(input);
  const photo = await load(deps, ref);
  assertOwnerOrAdmin(actor, photo);
  if (!DELETABLE.includes(photo.status)) throw new PhotoError("INVALID_STATE");

  await deps.prisma.$transaction(async (tx) => {
    const deleted = await tx.photo.deleteMany({ where: { id: ref.id, version: ref.version, status: { in: [...DELETABLE] } } });
    if (deleted.count !== 1) throw new PhotoError("CONFLICT");
    await writeAudit(tx, {
      actor,
      action: "photo.delete",
      targetType: "photo",
      targetId: ref.id,
      before: { status: photo.status, uploaderId: photo.uploaderId, filename: photo.originalFilename },
      requestId,
    });
  });
  await removePrivateFiles(deps.storage, photo.id);
}
