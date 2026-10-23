import type { AuditActor } from "../audit";
import { logger } from "../logger";
import { can } from "../permissions";
import { consumeRateLimit } from "../rate-limit";
import { Semaphore } from "../semaphore";
import type { PresignedUpload } from "../storage";
import type { PhotoDeps } from "./deps";
import { PhotoError } from "./errors";
import { originalKey, privateFileKey, removePrivateFiles, type StoredFile } from "./files";
import { ACCEPTED_TYPES, ImageRejectedError, processPhoto, type ProcessedFile } from "./image";
import { displayFilename, MAX_PHOTO_BYTES, type UploadRequest, uploadRequestSchema } from "./validation";

/**
 * Upload pipeline (requirements MED-1..MED-3):
 *  1. createUpload: validate the claimed name/type/size, record the photo (UPLOADING), and
 *     return a presigned PUT for the private bucket. The browser sends the file directly.
 *  2. completeUpload: claim the photo (UPLOADING -> PROCESSING, so it's processed exactly
 *     once even if "complete" is sent twice), check the stored object, process it, store
 *     the variants privately, delete the original, and leave a private DRAFT.
 */

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Uploads a person can have in flight at once (a post-show batch fits comfortably). */
const MAX_IN_FLIGHT_PER_USER = 40;
const UPLOAD_RATE = { max: 300, windowMs: 60 * 60_000 } as const;
/** Image processing is CPU/memory heavy; at most this many run at once per app instance. */
const processing = new Semaphore(2);

const GENERIC_FAILURE = "Something went wrong processing this photo. Try uploading it again.";

export interface CreatedUpload {
  readonly photoId: string;
  readonly upload: PresignedUpload;
}

export async function createUpload(deps: PhotoDeps, actor: AuditActor, input: UploadRequest): Promise<CreatedUpload> {
  if (!can(actor.role, "photos:upload")) throw new PhotoError("FORBIDDEN");
  const request = uploadRequestSchema.parse(input);
  const now = deps.now?.() ?? new Date();

  const inFlight = await deps.prisma.photo.count({
    where: { uploaderId: actor.id, status: { in: ["UPLOADING", "PROCESSING"] }, uploadExpiresAt: { gt: now } },
  });
  if (inFlight >= MAX_IN_FLIGHT_PER_USER) throw new PhotoError("TOO_MANY_UPLOADS");
  const rate = await consumeRateLimit(deps.prisma, { key: `photo-upload:${actor.id}`, ...UPLOAD_RATE, now: now.getTime() });
  if (!rate.allowed) throw new PhotoError("TOO_MANY_UPLOADS", "You've uploaded a lot in the last hour. Try again a bit later.");

  const photoId = crypto.randomUUID();
  const key = originalKey(photoId);
  const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000);
  await deps.prisma.photo.create({
    data: {
      id: photoId,
      uploaderId: actor.id,
      originalFilename: displayFilename(request.filename),
      declaredType: request.contentType,
      declaredSize: request.size,
      originalKey: key,
      uploadExpiresAt: expiresAt,
    },
  });
  const upload = await deps.storage.presignPrivateUpload({
    key,
    contentType: request.contentType,
    contentLength: request.size,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  return { photoId, upload };
}

export type CompletedUpload =
  | { readonly status: "DRAFT"; readonly photoId: string }
  | { readonly status: "FAILED"; readonly photoId: string; readonly reason: string };

async function storeVariants(deps: PhotoDeps, photoId: string, files: readonly ProcessedFile[], jpeg: ProcessedFile): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  const entries = [...files.map((file) => ({ file, name: `w${file.width}.webp` })), { file: jpeg, name: "full.jpg" }];
  for (const { file, name } of entries) {
    await deps.storage.putPrivate(privateFileKey(photoId, name), file.data, file.contentType);
    stored.push({ file: name, kind: file.kind, width: file.width, height: file.height, contentType: file.contentType, bytes: file.data.byteLength });
  }
  return stored;
}

async function failPhoto(deps: PhotoDeps, photoId: string, reason: string): Promise<void> {
  await deps.prisma.photo.updateMany({
    where: { id: photoId, status: "PROCESSING" },
    data: { status: "FAILED", failureReason: reason, variants: [], version: { increment: 1 } },
  });
  await removePrivateFiles(deps.storage, photoId);
}

/** Turns the uploaded file into a private draft. Safe to call more than once. */
export async function completeUpload(deps: PhotoDeps, actor: AuditActor, photoId: string): Promise<CompletedUpload> {
  const photo = await deps.prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo || photo.uploaderId !== actor.id) throw new PhotoError("NOT_FOUND");
  if (photo.status === "FAILED") return { status: "FAILED", photoId, reason: photo.failureReason ?? GENERIC_FAILURE };
  if (photo.status !== "UPLOADING") return { status: "DRAFT", photoId };

  const claimed = await deps.prisma.photo.updateMany({
    where: { id: photoId, status: "UPLOADING" },
    data: { status: "PROCESSING", version: { increment: 1 } },
  });
  // Someone (a double-click, a retry) is already processing it.
  if (claimed.count !== 1) return { status: "DRAFT", photoId };

  const head = await deps.storage.headPrivate(photo.originalKey);
  if (!head) {
    // The browser never finished the PUT. Put it back so a retry of the same upload still works.
    await deps.prisma.photo.updateMany({ where: { id: photoId, status: "PROCESSING" }, data: { status: "UPLOADING" } });
    throw new PhotoError("UPLOAD_MISSING");
  }

  try {
    if (head.size !== photo.declaredSize || head.size > MAX_PHOTO_BYTES) {
      throw new ImageRejectedError("The uploaded file doesn't match what was sent. Try again.");
    }
    const declared = ACCEPTED_TYPES[photo.declaredType];
    if (!declared) throw new ImageRejectedError("Only JPEG, PNG, WebP, and HEIC photos can be uploaded.");

    const result = await processing.run(async () => {
      const original = await deps.storage.readPrivate(photo.originalKey, MAX_PHOTO_BYTES);
      return processPhoto(original, declared);
    });
    const stored = await storeVariants(deps, photoId, result.variants, result.jpeg);

    const saved = await deps.prisma.photo.updateMany({
      where: { id: photoId, status: "PROCESSING" },
      data: {
        status: "DRAFT",
        width: result.width,
        height: result.height,
        variants: stored,
        blurDataUrl: result.blurDataUrl,
        failureReason: null,
        version: { increment: 1 },
      },
    });
    if (saved.count !== 1) {
      // Deleted (or cleaned up) while processing; don't leave its files behind.
      await removePrivateFiles(deps.storage, photoId);
      throw new PhotoError("NOT_FOUND");
    }
    await deps.storage.deletePrivate([photo.originalKey]);
    logger.info({ photoId, width: result.width, height: result.height, files: stored.length }, "photo processed");
    return { status: "DRAFT", photoId };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    const expected = error instanceof ImageRejectedError;
    const reason = expected ? error.message : GENERIC_FAILURE;
    await failPhoto(deps, photoId, reason);
    if (!expected) {
      logger.error({ err: error, photoId, declaredType: photo.declaredType, size: head.size }, "photo processing failed");
      throw error;
    }
    logger.info({ photoId, reason }, "photo rejected during processing");
    return { status: "FAILED", photoId, reason };
  }
}
