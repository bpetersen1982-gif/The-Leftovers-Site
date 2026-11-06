import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { VideoStatus } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { toDbDate } from "../dates";
import { logger } from "../logger";
import { can } from "../permissions";
import { type TakedownNoticeInput, takedownNoticeSchema } from "../photos/validation";
import { VideoError } from "./errors";
import { type StreamClient, type StreamVideo, streamVideoSchema } from "./stream";
import { displayFilename, parseWebVtt, type VideoDetailsInput, videoDetailsSchema, type VideoRef, videoRefSchema, videoUploadSchema } from "./validation";

/**
 * Video lifecycle (requirements MED-6..MED-10, APR-7, LEG-3):
 *
 *   UPLOADING -> PROCESSING -> READY --publish--> PUBLISHED --remove--> DELETION_REQUESTED
 *                    \\-> FAILED                     \\--takedown--> TAKEN_DOWN
 *
 * Stream drives UPLOADING/PROCESSING/READY/FAILED (webhook, with polling as a fallback);
 * people drive everything after READY. Admins upload and publish; Members can only ask
 * for a published video to come down.
 *
 * Privacy: Stream videos are private (signed URLs only) except while PUBLISHED. The
 * `streamPublic` flag is set *before* Stream is made public and cleared only *after* it's
 * made private again, so if anything fails in between the video job sees the flag on a
 * non-published video and locks it.
 */

export interface VideoDeps {
  readonly prisma: PrismaClient;
  readonly stream: StreamClient;
  /** Hosts allowed to embed published videos, e.g. ["theleftoversband.com", "www.theleftoversband.com"]. */
  readonly embedOrigins: readonly string[];
  readonly now?: () => Date;
}

type VideoRow = Prisma.VideoGetPayload<object>;
type Tx = Prisma.TransactionClient;

const UPLOAD_WINDOW_MS = 6 * 3_600_000;
const MAX_IN_FLIGHT_PER_USER = 10;
const PLAYBACK_ORIGIN = /^https:\/\/customer-[a-z0-9]{6,40}\.cloudflarestream\.com$/;
const OFF_SITE: readonly VideoStatus[] = ["DELETION_REQUESTED", "TAKEN_DOWN"];
/** Statuses Stream still controls. */
const PIPELINE: readonly VideoStatus[] = ["UPLOADING", "PROCESSING"];

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  ERR_NON_VIDEO: "That file isn't a video Stream can read.",
  ERR_DURATION_EXCEED_CONSTRAINT: "That video is longer than the limit. Trim it and try again.",
  ERR_MALFORMED_VIDEO: "That video file is damaged.",
  ERR_DURATION_TOO_SHORT: "That video is too short.",
};

/** Hosts (no scheme) allowed to embed videos, from the site's public URL. */
export function embedOriginsFor(appUrl: string): string[] {
  const { host } = new URL(appUrl);
  const isApex = host.split(".").length === 2;
  return isApex ? [host, `www.${host}`] : [host];
}

function nowOf(deps: VideoDeps): Date {
  return deps.now?.() ?? new Date();
}

function assert(actor: AuditActor, permission: Parameters<typeof can>[1]): void {
  if (!can(actor.role, permission)) throw new VideoError("FORBIDDEN");
}

async function load(deps: VideoDeps, ref: VideoRef): Promise<VideoRow> {
  const video = await deps.prisma.video.findUnique({ where: { id: ref.id } });
  if (!video) throw new VideoError("NOT_FOUND");
  if (video.version !== ref.version) throw new VideoError("CONFLICT");
  return video;
}

/** Runs a Stream call; network/API failures become a friendly, expected error. */
async function viaStream<T>(task: () => Promise<T>, context: Record<string, unknown>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    logger.error({ err: error, ...context }, "stream api call failed");
    throw new VideoError("STREAM_UNAVAILABLE");
  }
}

// ---------------------------------------------------------------- upload

export async function createVideoUpload(
  deps: VideoDeps,
  actor: AuditActor,
  input: { filename: string; size: number },
  requestId?: string | null,
): Promise<{ videoId: string; uploadUrl: string }> {
  assert(actor, "videos:manage");
  const request = videoUploadSchema(deps.stream.maxBytes).parse(input);
  const now = nowOf(deps);
  const inFlight = await deps.prisma.video.count({ where: { uploaderId: actor.id, status: "UPLOADING", uploadExpiresAt: { gt: now } } });
  if (inFlight >= MAX_IN_FLIGHT_PER_USER) throw new VideoError("TOO_MANY_UPLOADS");

  const filename = displayFilename(request.filename);
  const expiresAt = new Date(now.getTime() + UPLOAD_WINDOW_MS);
  const created = await viaStream(() => deps.stream.createUpload({ sizeBytes: request.size, name: filename, expiresAt }), { op: "createUpload" });
  try {
    const video = await deps.prisma.$transaction(async (tx) => {
      const row = await tx.video.create({
        data: { streamUid: created.uid, uploaderId: actor.id, originalFilename: filename, sizeBytes: BigInt(request.size), uploadExpiresAt: expiresAt },
      });
      await writeAudit(tx, { actor, action: "video.upload", targetType: "video", targetId: row.id, after: { filename, sizeBytes: request.size }, requestId });
      return row;
    });
    return { videoId: video.id, uploadUrl: created.uploadUrl };
  } catch (error) {
    await deps.stream.deleteVideo(created.uid).catch((cleanupError: unknown) => {
      logger.error({ err: cleanupError, streamUid: created.uid }, "orphaned stream upload could not be deleted");
    });
    throw error;
  }
}

function playbackOriginOf(video: StreamVideo): string | null {
  for (const candidate of [video.preview, video.thumbnail]) {
    if (!candidate) continue;
    const origin = new URL(candidate).origin;
    if (PLAYBACK_ORIGIN.test(origin)) return origin;
  }
  return null;
}

function statusFromStream(video: StreamVideo): { status: VideoStatus; failureReason: string | null } {
  const state = video.status.state;
  if (state === "ready" && video.readyToStream) return { status: "READY", failureReason: null };
  if (state === "error") {
    const code = video.status.errorReasonCode || video.status.errReasonCode || "";
    return { status: "FAILED", failureReason: FAILURE_MESSAGES[code] ?? "Stream couldn't process this video. Try uploading it again." };
  }
  if (state === "pendingupload") return { status: "UPLOADING", failureReason: null };
  return { status: "PROCESSING", failureReason: null };
}

/**
 * Applies what Stream reports to a video that's still in Stream's hands. Idempotent and
 * never touches a video a person has already acted on. Returns the resulting status.
 */
export async function syncFromStream(deps: VideoDeps, videoId: string, reported: StreamVideo): Promise<VideoStatus | null> {
  const next = statusFromStream(reported);
  const updated = await deps.prisma.video.updateMany({
    where: { id: videoId, streamUid: reported.uid, status: { in: [...PIPELINE] } },
    data: {
      status: next.status,
      failureReason: next.failureReason,
      durationSeconds: reported.duration && reported.duration > 0 ? reported.duration : undefined,
      width: reported.input?.width && reported.input.width > 0 ? reported.input.width : undefined,
      height: reported.input?.height && reported.input.height > 0 ? reported.input.height : undefined,
      playbackOrigin: playbackOriginOf(reported) ?? undefined,
      sizeBytes: reported.size && reported.size > 0 ? BigInt(Math.round(reported.size)) : undefined,
      version: { increment: 1 },
    },
  });
  if (updated.count === 0) return null;
  if (next.status === "FAILED") {
    // Nothing usable is stored; don't pay for it.
    await deps.stream.deleteVideo(reported.uid).catch((error: unknown) => logger.warn({ err: error, videoId }, "failed video not deleted from stream"));
  }
  logger.info({ videoId, status: next.status }, "video synced from stream");
  return next.status;
}

/** Browser says the upload finished: ask Stream where it's at. Safe to call repeatedly. */
export async function completeVideoUpload(deps: VideoDeps, actor: AuditActor, videoId: string): Promise<VideoStatus> {
  assert(actor, "videos:manage");
  const video = await deps.prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new VideoError("NOT_FOUND");
  if (!PIPELINE.includes(video.status)) return video.status;
  const reported = await viaStream(() => deps.stream.getVideo(video.streamUid), { op: "getVideo", videoId });
  if (!reported) return video.status;
  return (await syncFromStream(deps, video.id, reported)) ?? (await deps.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).status;
}

export type WebhookOutcome = "ok" | "ignored";

/** Applies a verified Stream webhook body. Unknown videos (e.g. already deleted) are ignored. */
export async function applyStreamWebhook(deps: VideoDeps, body: unknown): Promise<WebhookOutcome> {
  const reported = streamVideoSchema.parse(body);
  const video = await deps.prisma.video.findUnique({ where: { streamUid: reported.uid }, select: { id: true } });
  if (!video) return "ignored";
  await syncFromStream(deps, video.id, reported);
  return "ok";
}

// ---------------------------------------------------------------- details & captions

export async function updateVideoDetails(deps: VideoDeps, actor: AuditActor, input: VideoDetailsInput, requestId?: string | null): Promise<number> {
  assert(actor, "videos:manage");
  const details = videoDetailsSchema.parse(input);
  const video = await load(deps, details);
  if (video.status === "FAILED" || video.status === "UPLOADING") throw new VideoError("INVALID_STATE");
  if (video.status === "PUBLISHED" && details.title === "") throw new VideoError("TITLE_REQUIRED");
  if (video.durationSeconds !== null && details.posterSeconds > video.durationSeconds) throw new VideoError("POSTER_PAST_END");
  return deps.prisma.$transaction(async (tx) => {
    const updated = await tx.video.updateMany({
      where: { id: video.id, version: video.version },
      data: { title: details.title, description: details.description, posterSeconds: details.posterSeconds, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new VideoError("CONFLICT");
    await writeAudit(tx, { actor, action: "video.update", targetType: "video", targetId: video.id, before: { title: video.title }, after: { title: details.title }, requestId });
    return video.version + 1;
  });
}

export async function setVideoCaptions(deps: VideoDeps, actor: AuditActor, input: VideoRef, rawVtt: string | null, requestId?: string | null): Promise<void> {
  assert(actor, "videos:manage");
  const ref = videoRefSchema.parse(input);
  const vtt = rawVtt === null ? null : parseWebVtt(rawVtt);
  const video = await load(deps, ref);
  if (video.status === "FAILED" || video.status === "UPLOADING" || video.status === "PROCESSING") throw new VideoError("INVALID_STATE");
  const language = "en";
  await viaStream(() => (vtt === null ? deps.stream.deleteCaptions(video.streamUid, language) : deps.stream.uploadCaptions(video.streamUid, language, vtt)), {
    op: "captions",
    videoId: video.id,
  });
  await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.video.updateMany({
      where: { id: video.id, version: video.version },
      data: { captionsLanguage: vtt === null ? null : language, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new VideoError("CONFLICT");
    await writeAudit(tx, { actor, action: "video.captions", targetType: "video", targetId: video.id, after: { captions: vtt === null ? "removed" : language }, requestId });
  });
}

// ---------------------------------------------------------------- publish / remove / restore

async function resolveNotices(tx: Tx, actor: AuditActor, videoId: string, resolution: "RESTORED" | "DELETED"): Promise<void> {
  await tx.takedownNotice.updateMany({
    where: { mediaKind: "VIDEO", mediaId: videoId, resolution: null },
    data: { resolution, resolvedAt: new Date(), resolvedById: actor.id },
  });
}

/** Makes Stream private again and clears the flag. Failures are logged; the video job retries. */
export async function lockOnStream(deps: VideoDeps, video: Pick<VideoRow, "id" | "streamUid">): Promise<boolean> {
  try {
    await deps.stream.setPlayback(video.streamUid, { public: false });
  } catch (error) {
    logger.error({ err: error, videoId: video.id }, "video could not be made private on stream; the video job will retry");
    return false;
  }
  await deps.prisma.video.updateMany({ where: { id: video.id, status: { not: "PUBLISHED" } }, data: { streamPublic: false } });
  return true;
}

async function publishFrom(deps: VideoDeps, actor: AuditActor, video: VideoRow, requestId?: string | null): Promise<void> {
  if (video.title.trim() === "") throw new VideoError("TITLE_REQUIRED");
  if (!video.playbackOrigin) throw new VideoError("INVALID_STATE");
  // Flag first: from here on, the job will re-lock it unless the publish completes.
  await deps.prisma.video.updateMany({ where: { id: video.id }, data: { streamPublic: true } });
  try {
    await deps.stream.setPlayback(video.streamUid, { public: true, allowedOrigins: deps.embedOrigins });
  } catch (error) {
    logger.error({ err: error, videoId: video.id }, "stream api call failed");
    await lockOnStream(deps, video);
    throw new VideoError("STREAM_UNAVAILABLE");
  }
  const now = nowOf(deps);
  const won = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.video.updateMany({
      where: { id: video.id, version: video.version, status: video.status },
      data: {
        status: "PUBLISHED",
        streamPublic: true,
        publishedAt: video.publishedAt ?? now,
        removalRequestedAt: null,
        removalRequestedById: null,
        removalRequestedByRole: null,
        removalReason: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    if (video.status === "TAKEN_DOWN") await resolveNotices(tx, actor, video.id, "RESTORED");
    await writeAudit(tx, {
      actor,
      action: video.status === "READY" ? "video.publish" : "video.restore",
      targetType: "video",
      targetId: video.id,
      before: { status: video.status },
      after: { status: "PUBLISHED" },
      requestId,
    });
    return true;
  });
  if (!won) {
    await lockOnStream(deps, video);
    throw new VideoError("CONFLICT");
  }
}

/** Admins: puts a ready video on the site (title required). */
export async function publishVideo(deps: VideoDeps, actor: AuditActor, input: VideoRef, requestId?: string | null): Promise<void> {
  assert(actor, "videos:manage");
  const video = await load(deps, videoRefSchema.parse(input));
  if (video.status !== "READY") throw new VideoError("INVALID_STATE");
  await publishFrom(deps, actor, video, requestId);
}

/** Admins: puts a removed or taken-down video back (closes any open takedown notice). */
export async function restoreVideo(deps: VideoDeps, actor: AuditActor, input: VideoRef, requestId?: string | null): Promise<void> {
  assert(actor, "videos:manage");
  const video = await load(deps, videoRefSchema.parse(input));
  if (!OFF_SITE.includes(video.status)) throw new VideoError("INVALID_STATE");
  await publishFrom(deps, actor, video, requestId);
}

export interface OffSiteResult {
  /** False if the site hid it but Stream couldn't be locked yet (the job retries). */
  readonly lockedOnStream: boolean;
}

/** Admins and Members: takes a published video off the site now (APR-7 step 1). */
export async function requestVideoRemoval(
  deps: VideoDeps,
  actor: AuditActor,
  input: VideoRef,
  reason: string,
  requestId?: string | null,
): Promise<OffSiteResult> {
  assert(actor, "videos:requestRemoval");
  const ref = videoRefSchema.parse(input);
  const cleanReason = reason.replace(/\s+/g, " ").trim().slice(0, 250);
  const video = await load(deps, ref);
  if (video.status !== "PUBLISHED") throw new VideoError("INVALID_STATE");
  await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.video.updateMany({
      where: { id: video.id, version: video.version, status: "PUBLISHED" },
      data: {
        status: "DELETION_REQUESTED",
        removalRequestedAt: nowOf(deps),
        removalRequestedById: actor.id,
        removalRequestedByRole: actor.role,
        removalReason: cleanReason || null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new VideoError("CONFLICT");
    await writeAudit(tx, { actor, action: "video.remove", targetType: "video", targetId: video.id, after: { reason: cleanReason }, requestId });
  });
  return { lockedOnStream: await lockOnStream(deps, video) };
}

/** Admins: unpublishes after a copyright notice and records it (LEG-3). */
export async function takedownVideo(
  deps: VideoDeps,
  actor: AuditActor,
  input: VideoRef,
  notice: TakedownNoticeInput,
  requestId?: string | null,
): Promise<OffSiteResult> {
  assert(actor, "media:takedown");
  const ref = videoRefSchema.parse(input);
  const details = takedownNoticeSchema.parse(notice);
  const video = await load(deps, ref);
  if (video.status !== "PUBLISHED" && video.status !== "DELETION_REQUESTED") throw new VideoError("INVALID_STATE");
  await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.video.updateMany({
      where: { id: video.id, version: video.version, status: video.status },
      data: { status: "TAKEN_DOWN", version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new VideoError("CONFLICT");
    const created = await tx.takedownNotice.create({
      data: {
        mediaKind: "VIDEO",
        mediaId: video.id,
        mediaLabel: video.title || video.originalFilename,
        senderName: details.senderName,
        senderEmail: details.senderEmail,
        workClaimed: details.workClaimed,
        receivedOn: toDbDate(details.receivedOn),
        notes: details.notes,
        actedById: actor.id,
        actedByRole: actor.role,
      },
    });
    await writeAudit(tx, {
      actor,
      action: "media.takedown",
      targetType: "video",
      targetId: video.id,
      before: { status: video.status },
      after: { status: "TAKEN_DOWN", noticeId: created.id, workClaimed: details.workClaimed },
      requestId,
    });
  });
  return { lockedOnStream: await lockOnStream(deps, video) };
}

/**
 * Admins: deletes a video that isn't on the site (drafts, failed, removed, taken down):
 * from Stream and the database. The audit entry and any takedown notice stay.
 */
export async function deleteVideo(deps: VideoDeps, actor: AuditActor, input: VideoRef, requestId?: string | null): Promise<{ deletedOnStream: boolean }> {
  assert(actor, "videos:manage");
  const video = await load(deps, videoRefSchema.parse(input));
  if (video.status === "PUBLISHED") throw new VideoError("INVALID_STATE");
  await deps.prisma.$transaction(async (tx) => {
    const deleted = await tx.video.deleteMany({ where: { id: video.id, version: video.version, status: video.status } });
    if (deleted.count !== 1) throw new VideoError("CONFLICT");
    await resolveNotices(tx, actor, video.id, "DELETED");
    await writeAudit(tx, {
      actor,
      action: "video.delete",
      targetType: "video",
      targetId: video.id,
      before: { status: video.status, title: video.title, filename: video.originalFilename, streamUid: video.streamUid },
      requestId,
    });
  });
  try {
    await deps.stream.deleteVideo(video.streamUid);
    return { deletedOnStream: true };
  } catch (error) {
    // Logged with the uid so it can be removed from the Stream dashboard by hand.
    logger.error({ err: error, videoId: video.id, streamUid: video.streamUid }, "video deleted here but not on stream");
    return { deletedOnStream: false };
  }
}
