import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { FanPostStatus, ModerationVerdict } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { toDbDate, todayInBandTimeZone, addDays } from "../dates";
import { logger } from "../logger";
import { can } from "../permissions";
import {
  newPublicPrefix,
  originalKey,
  parseStoredFiles,
  privateFileKey,
  PUBLIC_CACHE_CONTROL,
  publicFileKey,
  removePrivateFiles,
  removePublicFiles,
} from "../photos/files";
import { ACCEPTED_TYPES, ImageRejectedError, processPhoto } from "../photos/image";
import { processingSlots, storeProcessedFiles } from "../photos/processing";
import { consumeRateLimit } from "../rate-limit";
import type { ObjectStorage, PresignedUpload } from "../storage";
import { decisionReasonSchema, type FanPostInput, fanPostRefSchema, fanPostSchema, type FanPostRef, MAX_FAN_PHOTO_BYTES } from "./validation";

/**
 * Fan Wall (requirements FAN-1..FAN-5, APR-3..APR-5, APR-9, APR-11, LEG-5).
 *
 * Posting: anyone (no account). The action layer checks Turnstile and the honeypot; this
 * service rate-limits per IP and saves the post as PENDING, nothing is public until a
 * band member approves it. A photo goes browser → private bucket with a signed URL (like
 * band photos); a one-time completion token proves the same browser finishes it.
 *
 * Moderation: Members and Admins approve/reject. A Member's decision takes effect at once
 * and another Member may change it; once an Admin decides, only an Admin can change it.
 * Every decision is recorded with who made it; an Admin changing a Member's decision is an
 * override. Version checks mean two people acting at once can't both win.
 */

export interface FanDeps {
  readonly prisma: PrismaClient;
  /** Null when photo storage isn't configured: text-only posts still work. */
  readonly storage: ObjectStorage | null;
  readonly now?: () => Date;
}

export type FanErrorCode = "RATE_LIMITED" | "PHOTOS_DISABLED" | "UPLOAD_INVALID" | "UPLOAD_MISSING" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";

const MESSAGES: Record<FanErrorCode, string> = {
  RATE_LIMITED: "You've posted a few times already. Try again in a little while.",
  PHOTOS_DISABLED: "Photos can't be added right now. Send your message without one.",
  UPLOAD_INVALID: "That photo upload has expired. Your message was still sent.",
  UPLOAD_MISSING: "The photo didn't finish uploading. Try again.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That post no longer exists.",
  CONFLICT: "Someone else changed this post while you were looking at it. Reload and try again.",
};

export class FanError extends Error {
  override readonly name = "FanError";
  constructor(readonly code: FanErrorCode) {
    super(MESSAGES[code]);
  }
}

const RATE = { max: 5, windowMs: 60 * 60_000 } as const;
const UPLOAD_TTL_SECONDS = 15 * 60;
/** Shows a fan can pick: public ones from the last 90 days up to today. */
const SHOW_PICK_DAYS = 90;

function nowOf(deps: FanDeps): Date {
  return deps.now?.() ?? new Date();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** IPs are only used as rate-limit keys, hashed so the table never holds raw addresses. */
export function ipKey(ip: string): string {
  return createHash("sha256").update(`fan-wall:${ip}`).digest("hex").slice(0, 32);
}

/** Public shows a fan could have been at (recent past, today). */
export async function pickableShows(prisma: PrismaClient, today: string = todayInBandTimeZone()): Promise<{ id: string; label: string }[]> {
  const rows = await prisma.show.findMany({
    where: { isPublic: true, status: { not: "CANCELLED" }, date: { gte: toDbDate(addDays(today, -SHOW_PICK_DAYS)), lte: toDbDate(today) } },
    orderBy: { date: "desc" },
    select: { id: true, date: true, venueName: true },
  });
  const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return rows.map((row) => ({ id: row.id, label: `${row.venueName}, ${format.format(row.date)}` }));
}

// ---------------------------------------------------------------- posting

export interface SubmittedPost {
  readonly postId: string;
  /** Present when a photo is coming: PUT it here, then call completeFanPhoto with the token. */
  readonly photoUpload: (PresignedUpload & { readonly completionToken: string }) | null;
}

export async function submitFanPost(deps: FanDeps, input: FanPostInput, context: { ip: string }): Promise<SubmittedPost> {
  const post = fanPostSchema.parse(input);
  if (post.photo && !deps.storage) throw new FanError("PHOTOS_DISABLED");
  const now = nowOf(deps);
  const rate = await consumeRateLimit(deps.prisma, { key: `fan-post:${ipKey(context.ip)}`, ...RATE, now: now.getTime() });
  if (!rate.allowed) throw new FanError("RATE_LIMITED");

  // Only accept a show the fan could actually pick.
  const showId = post.showId && (await pickableShows(deps.prisma, todayInBandTimeZone(now))).some((show) => show.id === post.showId) ? post.showId : null;
  const completionToken = post.photo ? randomBytes(24).toString("base64url") : null;
  const created = await deps.prisma.fanPost.create({
    data: {
      status: post.photo ? "AWAITING_PHOTO" : "PENDING",
      displayName: post.displayName,
      message: post.message,
      email: post.email,
      showId,
      ...(post.photo
        ? {
            photoUploadTokenHash: hashToken(completionToken as string),
            photoUploadExpiresAt: new Date(now.getTime() + UPLOAD_TTL_SECONDS * 1000),
            photoDeclaredType: post.photo.contentType,
            photoDeclaredSize: post.photo.size,
            photoAltText: post.photo.altText,
            photoConsentAt: now,
          }
        : {}),
    },
  });
  if (!post.photo || !deps.storage || !completionToken) return { postId: created.id, photoUpload: null };
  const upload = await deps.storage.presignPrivateUpload({
    key: originalKey(created.id),
    contentType: post.photo.contentType,
    contentLength: post.photo.size,
    expiresInSeconds: UPLOAD_TTL_SECONDS,
  });
  return { postId: created.id, photoUpload: { ...upload, completionToken } };
}

export type PhotoOutcome = { readonly photo: "added" } | { readonly photo: "rejected"; readonly reason: string };

/** Moves a post with no usable photo on to moderation as text only. */
async function fallBackToTextOnly(deps: FanDeps, postId: string, reason: string): Promise<void> {
  await deps.prisma.fanPost.updateMany({
    where: { id: postId },
    data: { status: "PENDING", photoFailureReason: reason, photoVariants: [], photoWidth: null, photoHeight: null, photoBlurDataUrl: null, version: { increment: 1 } },
  });
  if (deps.storage) await removePrivateFiles(deps.storage, postId);
}

/**
 * The fan's browser finished uploading: check and process the photo, then send the post
 * to moderation. The token works once. An unusable photo doesn't lose the message.
 */
export async function completeFanPhoto(deps: FanDeps, postId: string, completionToken: string): Promise<PhotoOutcome> {
  if (!deps.storage) throw new FanError("PHOTOS_DISABLED");
  const storage = deps.storage;
  const post = await deps.prisma.fanPost.findUnique({ where: { id: postId } });
  if (!post || post.status !== "AWAITING_PHOTO" || post.photoUploadTokenHash !== hashToken(completionToken)) throw new FanError("UPLOAD_INVALID");
  if (!post.photoUploadExpiresAt || post.photoUploadExpiresAt < nowOf(deps)) throw new FanError("UPLOAD_INVALID");

  const head = await storage.headPrivate(originalKey(postId));
  if (!head) throw new FanError("UPLOAD_MISSING");
  // Single use: clearing the token claims the post, so a double submit can't process twice.
  const claimed = await deps.prisma.fanPost.updateMany({ where: { id: postId, photoUploadTokenHash: post.photoUploadTokenHash }, data: { photoUploadTokenHash: null } });
  if (claimed.count !== 1) throw new FanError("UPLOAD_INVALID");

  try {
    const declared = post.photoDeclaredType ? ACCEPTED_TYPES[post.photoDeclaredType] : undefined;
    if (!declared || head.size !== post.photoDeclaredSize || head.size > MAX_FAN_PHOTO_BYTES) {
      throw new ImageRejectedError("The uploaded file doesn't match what was sent.");
    }
    const result = await processingSlots.run(async () => processPhoto(await storage.readPrivate(originalKey(postId), MAX_FAN_PHOTO_BYTES), declared));
    const stored = await storeProcessedFiles(storage, postId, result);
    await deps.prisma.fanPost.update({
      where: { id: postId },
      data: { status: "PENDING", photoWidth: result.width, photoHeight: result.height, photoVariants: stored, photoBlurDataUrl: result.blurDataUrl, version: { increment: 1 } },
    });
    await storage.deletePrivate([originalKey(postId)]);
    return { photo: "added" };
  } catch (error) {
    const reason = error instanceof ImageRejectedError ? error.message : "That photo couldn't be processed.";
    if (!(error instanceof ImageRejectedError)) logger.error({ err: error, fanPostId: postId }, "fan photo processing failed");
    await fallBackToTextOnly(deps, postId, reason);
    return { photo: "rejected", reason };
  }
}

/** Posts whose photo never arrived go to moderation as text only (called by the photo job). */
export async function releaseStalledFanPhotos(deps: FanDeps, now: Date = nowOf(deps)): Promise<number> {
  const stalled = await deps.prisma.fanPost.findMany({
    where: { status: "AWAITING_PHOTO", photoUploadExpiresAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    select: { id: true },
    take: 100,
  });
  for (const post of stalled) await fallBackToTextOnly(deps, post.id, "The photo didn't finish uploading.");
  return stalled.length;
}

// ---------------------------------------------------------------- moderation

export type DecisionOutcome = "done" | "unchanged" | "conflict" | "missing" | "locked" | "needsAltText" | "notReady";
export interface DecisionResult {
  readonly id: string;
  readonly outcome: DecisionOutcome;
}

type PostRow = Prisma.FanPostGetPayload<object>;

function hasPhoto(post: Pick<PostRow, "photoVariants">): boolean {
  return parseStoredFiles(post.photoVariants).length > 0;
}

async function copyPhotoToPublic(storage: ObjectStorage, post: PostRow): Promise<string> {
  const prefix = newPublicPrefix(post.id);
  const copied: string[] = [];
  try {
    for (const file of parseStoredFiles(post.photoVariants)) {
      const key = publicFileKey(prefix, file.file);
      await storage.publish(privateFileKey(post.id, file.file), key, { contentType: file.contentType, cacheControl: PUBLIC_CACHE_CONTROL });
      copied.push(key);
    }
    return prefix;
  } catch (error) {
    await storage.deletePublic(copied).catch(() => undefined);
    throw error;
  }
}

async function decideOne(deps: FanDeps, actor: AuditActor, ref: FanPostRef, verdict: ModerationVerdict, reason: string, requestId?: string | null): Promise<DecisionOutcome> {
  const post = await deps.prisma.fanPost.findUnique({ where: { id: ref.id } });
  if (!post) return "missing";
  if (post.version !== ref.version) return "conflict";
  if (post.status === "AWAITING_PHOTO") return "notReady";
  // APR-5: an Admin's decision is final for Members.
  if (post.decidedByRole === "ADMIN" && !can(actor.role, "fan:override")) return "locked";
  if (post.status === verdict) return "unchanged";
  const photo = hasPhoto(post);
  if (verdict === "APPROVED" && photo && post.photoAltText.trim() === "") return "needsAltText";

  let newPrefix: string | null = null;
  if (verdict === "APPROVED" && photo) {
    if (!deps.storage) return "notReady";
    newPrefix = await copyPhotoToPublic(deps.storage, post);
  }
  const isOverride = post.decidedByRole === "MEMBER" && actor.role === "ADMIN";
  const won = await deps.prisma.$transaction(async (tx) => {
    const previous = await tx.moderationDecision.findFirst({ where: { fanPostId: post.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const status: FanPostStatus = verdict;
    const updated = await tx.fanPost.updateMany({
      where: { id: post.id, version: post.version, status: post.status },
      data: {
        status,
        photoPublicPrefix: newPrefix,
        decidedAt: nowOf(deps),
        decidedById: actor.id,
        decidedByRole: actor.role,
        decisionReason: reason || null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    await tx.moderationDecision.create({
      data: { fanPostId: post.id, verdict, actorId: actor.id, actorRole: actor.role, reason, overridesDecisionId: previous?.id ?? null },
    });
    await writeAudit(tx, {
      actor,
      action: isOverride ? "fan.override" : verdict === "APPROVED" ? "fan.approve" : "fan.reject",
      targetType: "fanPost",
      targetId: post.id,
      before: { status: post.status, decidedByRole: post.decidedByRole },
      after: { status, reason },
      requestId,
    });
    return true;
  });
  if (!won) {
    if (newPrefix && deps.storage) await deps.storage.deletePublicPrefix(`${newPrefix}/`).catch(() => undefined);
    return "conflict";
  }
  // Leaving APPROVED (or re-approving under a new prefix): drop older public copies.
  if (deps.storage && photo && post.photoPublicPrefix) {
    await deps.storage.deletePublicPrefix(`${post.photoPublicPrefix}/`).catch((error: unknown) => {
      logger.error({ err: error, fanPostId: post.id }, "old public fan photo files could not be removed");
    });
  }
  return "done";
}

/** Approve or reject one or more posts (APR-3, APR-9: bulk with optional reason). */
export async function decideFanPosts(
  deps: FanDeps,
  actor: AuditActor,
  refs: readonly FanPostRef[],
  verdict: ModerationVerdict,
  reason: string,
  requestId?: string | null,
): Promise<DecisionResult[]> {
  if (!can(actor.role, "fan:moderate")) throw new FanError("FORBIDDEN");
  const items = fanPostRefSchema.array().min(1).max(100).parse(refs);
  const cleanReason = decisionReasonSchema.parse(reason);
  const results: DecisionResult[] = [];
  for (const ref of items) results.push({ id: ref.id, outcome: await decideOne(deps, actor, ref, verdict, cleanReason, requestId) });
  return results;
}

/** Moderators can describe a fan's photo (required before approving one). */
export async function setFanPhotoAltText(deps: FanDeps, actor: AuditActor, input: FanPostRef, altText: string): Promise<number> {
  if (!can(actor.role, "fan:moderate")) throw new FanError("FORBIDDEN");
  const ref = fanPostRefSchema.parse(input);
  const clean = altText.replace(/\s+/g, " ").trim().slice(0, 250);
  const post = await deps.prisma.fanPost.findUnique({ where: { id: ref.id }, select: { decidedByRole: true } });
  if (!post) throw new FanError("NOT_FOUND");
  if (post.decidedByRole === "ADMIN" && !can(actor.role, "fan:override")) throw new FanError("FORBIDDEN");
  const updated = await deps.prisma.fanPost.updateMany({ where: { id: ref.id, version: ref.version }, data: { photoAltText: clean, version: { increment: 1 } } });
  if (updated.count !== 1) throw new FanError("CONFLICT");
  return ref.version + 1;
}

/** Admins: permanently deletes a post and its photo files (PRIV-2 data removal). */
export async function deleteFanPost(deps: FanDeps, actor: AuditActor, input: FanPostRef, requestId?: string | null): Promise<void> {
  if (!can(actor.role, "fan:delete")) throw new FanError("FORBIDDEN");
  const ref = fanPostRefSchema.parse(input);
  await deps.prisma.$transaction(async (tx) => {
    const post = await tx.fanPost.findUnique({ where: { id: ref.id }, select: { displayName: true, status: true } });
    if (!post) throw new FanError("NOT_FOUND");
    const deleted = await tx.fanPost.deleteMany({ where: { id: ref.id, version: ref.version } });
    if (deleted.count !== 1) throw new FanError("CONFLICT");
    // The message and email aren't copied into the log: deleting is how people's data is removed.
    await writeAudit(tx, { actor, action: "fan.delete", targetType: "fanPost", targetId: ref.id, before: { status: post.status }, requestId });
  });
  if (deps.storage) {
    await removePublicFiles(deps.storage, ref.id).catch((error: unknown) => logger.error({ err: error, fanPostId: ref.id }, "deleted fan post's public files remain"));
    await removePrivateFiles(deps.storage, ref.id);
  }
}
