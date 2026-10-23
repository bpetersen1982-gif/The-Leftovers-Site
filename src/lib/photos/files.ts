import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "../logger";
import type { ObjectStorage } from "../storage";

/**
 * Where each photo's files live. Keys are built only from server-generated ids, never
 * from anything the uploader sent.
 *
 * private bucket:  originals/{photoId}                 (deleted after processing)
 *                  variants/{photoId}/{file}           (processed, kept while the photo exists)
 * public bucket:   photos/{photoId}/{token}/{file}     (only while APPROVED; token is new per publish)
 */

export const storedFileSchema = z.strictObject({
  /** "w960.webp" or "full.jpg". */
  file: z.string().regex(/^(w\d{1,5}\.webp|full\.jpg)$/),
  kind: z.enum(["webp", "jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentType: z.enum(["image/webp", "image/jpeg"]),
  bytes: z.number().int().nonnegative(),
});
export type StoredFile = z.infer<typeof storedFileSchema>;

const storedFilesSchema = z.array(storedFileSchema);

/** Parses the `variants` JSON column (throws if it was ever written wrongly). */
export function parseStoredFiles(value: Prisma.JsonValue): StoredFile[] {
  return storedFilesSchema.parse(value);
}

export function originalKey(photoId: string): string {
  return `originals/${photoId}`;
}

export function privateFileKey(photoId: string, file: string): string {
  return `variants/${photoId}/${file}`;
}

/** New public prefix for a publish. Unguessable, so unpublished URLs can't be rebuilt. */
export function newPublicPrefix(photoId: string): string {
  return `photos/${photoId}/${randomBytes(12).toString("hex")}`;
}

/** Parent of every public prefix this photo has ever had. */
export function publicPhotoRoot(photoId: string): string {
  return `photos/${photoId}/`;
}

/**
 * Removes every public copy of a photo (current and any earlier publish). Throws on
 * failure: callers must know if a removed photo could still be reachable by URL.
 */
export async function removePublicFiles(storage: ObjectStorage, photoId: string): Promise<void> {
  await storage.deletePublicPrefix(publicPhotoRoot(photoId));
}

export function publicFileKey(prefix: string, file: string): string {
  return `${prefix}/${file}`;
}

/** Browser cache lifetime for public photo files. Short, so a removed photo disappears soon. */
export const PUBLIC_CACHE_CONTROL = "public, max-age=3600";

/**
 * Removes a photo's original and every private variant, including any a crashed processing
 * run left behind. Failures are logged, not thrown: callers have already removed the photo
 * from the site, and leftover private files are invisible (they only cost storage).
 */
export async function removePrivateFiles(storage: ObjectStorage, photoId: string): Promise<void> {
  try {
    await storage.deletePrivate([originalKey(photoId)]);
    await storage.deletePrivatePrefix(privateFileKey(photoId, ""));
  } catch (error) {
    logger.error({ err: error, photoId }, "private photo files could not be removed");
  }
}
