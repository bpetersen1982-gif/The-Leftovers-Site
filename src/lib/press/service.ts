import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { PressFileKind } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { logger } from "../logger";
import { can } from "../permissions";
import { sniffImageKind } from "../photos/image";
import type { ObjectStorage, PresignedUpload } from "../storage";

/**
 * Press kit (requirements CNT-3, BOOK-22): Admins choose press photos and video highlights,
 * and upload a hi-res logo, tech rider PDF, and stage plot PDF. Files go browser → private
 * bucket (signed URL), are checked by their contents, then copied to the public bucket
 * with a download filename. Replacing a file deletes the old one.
 */

export class PressError extends Error {
  override readonly name = "PressError";
  constructor(
    readonly code: "FORBIDDEN" | "INVALID_FILE" | "UPLOAD_MISSING" | "TOO_MANY" | "STORAGE_DISABLED",
    message: string,
  ) {
    super(message);
  }
}

interface KindRules {
  readonly label: string;
  readonly types: readonly string[];
  readonly extensions: readonly string[];
  readonly maxBytes: number;
  readonly downloadName: string;
}

const MB = 1024 * 1024;
export const PRESS_FILE_RULES: Record<PressFileKind, KindRules> = {
  LOGO: { label: "logo", types: ["image/png", "image/jpeg"], extensions: ["png", "jpg", "jpeg"], maxBytes: 25 * MB, downloadName: "the-leftovers-logo" },
  RIDER: { label: "tech rider", types: ["application/pdf"], extensions: ["pdf"], maxBytes: 15 * MB, downloadName: "the-leftovers-tech-rider" },
  STAGE_PLOT: { label: "stage plot", types: ["application/pdf"], extensions: ["pdf"], maxBytes: 15 * MB, downloadName: "the-leftovers-stage-plot" },
};
export const PRESS_FILE_KINDS = Object.keys(PRESS_FILE_RULES) as PressFileKind[];

export const MAX_PRESS_PHOTOS = 24;
export const MAX_PRESS_VIDEOS = 6;
const UPLOAD_TTL_SECONDS = 15 * 60;
const CACHE = "public, max-age=3600";

export interface PressDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStorage;
}

function assertAdmin(actor: AuditActor): void {
  if (!can(actor.role, "press:manage")) throw new PressError("FORBIDDEN", "Only Admins can change the press kit.");
}

const kindSchema = z.enum(["LOGO", "RIDER", "STAGE_PLOT"]);

function uploadKey(uploadId: string): string {
  return `press-uploads/${uploadId}`;
}

export async function startPressUpload(
  deps: PressDeps,
  actor: AuditActor,
  input: { kind: string; filename: string; contentType: string; size: number },
): Promise<{ uploadId: string; upload: PresignedUpload }> {
  assertAdmin(actor);
  const kind = kindSchema.parse(input.kind);
  const rules = PRESS_FILE_RULES[kind];
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(input.filename)?.[1]?.toLowerCase() ?? "";
  if (!rules.types.includes(input.contentType) || !rules.extensions.includes(extension)) {
    throw new PressError("INVALID_FILE", kind === "LOGO" ? "The logo must be a PNG or JPEG." : `The ${rules.label} must be a PDF.`);
  }
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > rules.maxBytes) {
    throw new PressError("INVALID_FILE", `The ${rules.label} can be up to ${rules.maxBytes / MB} MB.`);
  }
  const uploadId = crypto.randomUUID();
  const upload = await deps.storage.presignPrivateUpload({ key: uploadKey(uploadId), contentType: input.contentType, contentLength: input.size, expiresInSeconds: UPLOAD_TTL_SECONDS });
  return { uploadId, upload };
}

/** Checks the uploaded file by its contents and makes it the current one of its kind. */
export async function completePressUpload(deps: PressDeps, actor: AuditActor, input: { kind: string; uploadId: string }, requestId?: string | null): Promise<void> {
  assertAdmin(actor);
  const kind = kindSchema.parse(input.kind);
  const uploadId = z.uuid().parse(input.uploadId);
  const rules = PRESS_FILE_RULES[kind];
  const key = uploadKey(uploadId);
  const head = await deps.storage.headPrivate(key);
  if (!head) throw new PressError("UPLOAD_MISSING", "The file didn't finish uploading. Try again.");

  try {
    if (head.size > rules.maxBytes) throw new PressError("INVALID_FILE", `The ${rules.label} can be up to ${rules.maxBytes / MB} MB.`);
    const bytes = await deps.storage.readPrivate(key, rules.maxBytes);
    let contentType: string;
    let extension: string;
    let width: number | null = null;
    let height: number | null = null;
    if (kind === "LOGO") {
      const sniffed = sniffImageKind(bytes);
      if (sniffed !== "png" && sniffed !== "jpeg") throw new PressError("INVALID_FILE", "That file isn't a PNG or JPEG image.");
      const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 })
        .metadata()
        .catch(() => {
          throw new PressError("INVALID_FILE", "That image couldn't be read.");
        });
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      contentType = sniffed === "png" ? "image/png" : "image/jpeg";
      extension = sniffed === "png" ? "png" : "jpg";
    } else {
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PressError("INVALID_FILE", "That file isn't a PDF.");
      contentType = "application/pdf";
      extension = "pdf";
    }

    const filename = `${rules.downloadName}.${extension}`;
    const publicKey = `press/${kind.toLowerCase().replace("_", "-")}/${randomBytes(12).toString("hex")}/${filename}`;
    await deps.storage.publish(key, publicKey, { contentType, cacheControl: CACHE, contentDisposition: `attachment; filename="${filename}"` });

    const previous = await deps.prisma.$transaction(async (tx) => {
      const old = await tx.pressFile.findUnique({ where: { kind }, select: { publicKey: true } });
      await tx.pressFile.upsert({
        where: { kind },
        create: { kind, publicKey, contentType, bytes: head.size, width, height, uploadedById: actor.id },
        update: { publicKey, contentType, bytes: head.size, width, height, uploadedById: actor.id, uploadedAt: new Date() },
      });
      await writeAudit(tx, { actor, action: "press.file", targetType: "press", targetId: kind, after: { bytes: head.size, contentType }, requestId });
      return old;
    });
    if (previous) {
      await deps.storage.deletePublic([previous.publicKey]).catch((error: unknown) => logger.error({ err: error, kind }, "old press file not deleted"));
    }
  } finally {
    await deps.storage.deletePrivate([key]).catch((error: unknown) => logger.warn({ err: error, uploadId }, "press upload not cleaned up"));
  }
}

export async function deletePressFile(deps: PressDeps, actor: AuditActor, rawKind: string, requestId?: string | null): Promise<void> {
  assertAdmin(actor);
  const kind = kindSchema.parse(rawKind);
  const removed = await deps.prisma.$transaction(async (tx) => {
    const file = await tx.pressFile.findUnique({ where: { kind }, select: { publicKey: true } });
    if (!file) return null;
    await tx.pressFile.delete({ where: { kind } });
    await writeAudit(tx, { actor, action: "press.fileDelete", targetType: "press", targetId: kind, requestId });
    return file;
  });
  if (removed) await deps.storage.deletePublic([removed.publicKey]);
}

/** Replaces the set of press photos; only published photos can be chosen. */
export async function setPressPhotos(prisma: PrismaClient, actor: AuditActor, photoIds: readonly string[], requestId?: string | null): Promise<number> {
  assertAdmin(actor);
  const ids = [...new Set(z.array(z.uuid()).parse(photoIds))];
  if (ids.length > MAX_PRESS_PHOTOS) throw new PressError("TOO_MANY", `Pick up to ${MAX_PRESS_PHOTOS} press photos.`);
  return prisma.$transaction(async (tx) => {
    await tx.photo.updateMany({ where: { isPressPhoto: true, id: { notIn: ids } }, data: { isPressPhoto: false } });
    const chosen = await tx.photo.updateMany({ where: { id: { in: ids }, status: "APPROVED" }, data: { isPressPhoto: true } });
    await writeAudit(tx, { actor, action: "press.photos", targetType: "press", targetId: "photos", after: { count: chosen.count }, requestId });
    return chosen.count;
  });
}

/** Replaces the set of video highlights; only published videos can be chosen. */
export async function setPressVideos(prisma: PrismaClient, actor: AuditActor, videoIds: readonly string[], requestId?: string | null): Promise<number> {
  assertAdmin(actor);
  const ids = [...new Set(z.array(z.uuid()).parse(videoIds))];
  if (ids.length > MAX_PRESS_VIDEOS) throw new PressError("TOO_MANY", `Pick up to ${MAX_PRESS_VIDEOS} video highlights.`);
  return prisma.$transaction(async (tx) => {
    await tx.video.updateMany({ where: { isPressHighlight: true, id: { notIn: ids } }, data: { isPressHighlight: false } });
    const chosen = await tx.video.updateMany({ where: { id: { in: ids }, status: "PUBLISHED" }, data: { isPressHighlight: true } });
    await writeAudit(tx, { actor, action: "press.videos", targetType: "press", targetId: "videos", after: { count: chosen.count }, requestId });
    return chosen.count;
  });
}

export interface PressFileView {
  readonly kind: PressFileKind;
  readonly url: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly uploadedAt: Date;
}

export async function listPressFiles(prisma: PrismaClient, storage: ObjectStorage | null): Promise<Partial<Record<PressFileKind, PressFileView>>> {
  if (!storage) return {};
  const rows = await prisma.pressFile.findMany();
  return Object.fromEntries(
    rows.map((row) => [row.kind, { kind: row.kind, url: storage.publicUrlFor(row.publicKey), bytes: row.bytes, width: row.width, height: row.height, uploadedAt: row.uploadedAt }]),
  );
}

export function formatBytes(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
