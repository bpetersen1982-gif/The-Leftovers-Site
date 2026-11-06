import type { PrismaClient } from "@/generated/prisma/client";
import type { Role, VideoStatus } from "@/generated/prisma/enums";
import { logger } from "../logger";
import { can } from "../permissions";
import { openNoticesFor, type TakedownSummary } from "../photos/queries";
import type { StreamClient } from "./stream";

/**
 * Read models for videos. Public pages use the Stream video id (playable only while
 * PUBLISHED); band pages preview private videos with one-hour signed tokens.
 */

export interface VideoPlayback {
  readonly posterUrl: string;
  /** Stream player, autoplaying once loaded (it's only inserted after the visitor presses play). */
  readonly iframeUrl: string;
}

/** `idOrToken` is the Stream uid for public videos, or a signed token for private ones. */
export function playbackFor(origin: string, idOrToken: string, posterSeconds: number, captionsLanguage: string | null): VideoPlayback {
  const base = `${origin}/${encodeURIComponent(idOrToken)}`;
  const posterUrl = `${base}/thumbnails/thumbnail.jpg?time=${Math.max(0, Math.round(posterSeconds))}s&height=720`;
  const params = new URLSearchParams({ autoplay: "true", preload: "auto", poster: posterUrl });
  if (captionsLanguage) params.set("defaultTextTrack", captionsLanguage);
  return { posterUrl, iframeUrl: `${base}/iframe?${params.toString()}` };
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- public

export interface PublicVideo {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly duration: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly publishedAt: Date;
  readonly playback: VideoPlayback;
}

const PUBLIC_SELECT = {
  id: true,
  streamUid: true,
  title: true,
  description: true,
  durationSeconds: true,
  width: true,
  height: true,
  publishedAt: true,
  playbackOrigin: true,
  posterSeconds: true,
  captionsLanguage: true,
} as const;

type PublicRow = {
  id: string;
  streamUid: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  publishedAt: Date | null;
  playbackOrigin: string | null;
  posterSeconds: number;
  captionsLanguage: string | null;
};

function toPublic(row: PublicRow): PublicVideo | null {
  if (!row.playbackOrigin || !row.publishedAt) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    duration: formatDuration(row.durationSeconds),
    width: row.width,
    height: row.height,
    publishedAt: row.publishedAt,
    playback: playbackFor(row.playbackOrigin, row.streamUid, row.posterSeconds, row.captionsLanguage),
  };
}

export const PUBLIC_VIDEO_PAGE = 12;

export async function listPublicVideos(prisma: PrismaClient, page: number): Promise<{ videos: PublicVideo[]; total: number; pageCount: number }> {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const where = { status: "PUBLISHED" as const, playbackOrigin: { not: null } };
  const [rows, total] = await Promise.all([
    prisma.video.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], skip: (safePage - 1) * PUBLIC_VIDEO_PAGE, take: PUBLIC_VIDEO_PAGE, select: PUBLIC_SELECT }),
    prisma.video.count({ where }),
  ]);
  return { videos: rows.flatMap((row) => toPublic(row) ?? []), total, pageCount: Math.max(1, Math.ceil(total / PUBLIC_VIDEO_PAGE)) };
}

export async function getPublicVideo(prisma: PrismaClient, id: string): Promise<PublicVideo | null> {
  const row = await prisma.video.findFirst({ where: { id, status: "PUBLISHED" }, select: PUBLIC_SELECT });
  return row ? toPublic(row) : null;
}

// ---------------------------------------------------------------- band

export interface BandVideo {
  readonly id: string;
  readonly version: number;
  readonly status: VideoStatus;
  readonly originalFilename: string;
  readonly title: string;
  readonly description: string;
  readonly posterSeconds: number;
  readonly durationSeconds: number | null;
  readonly duration: string | null;
  readonly captionsLanguage: string | null;
  readonly showId: string | null;
  readonly failureReason: string | null;
  readonly uploaderName: string;
  readonly removalRequestedByName: string | null;
  readonly removalReason: string | null;
  readonly createdAt: Date;
  /** Null while processing, or if a private preview token couldn't be made. */
  readonly playback: VideoPlayback | null;
}

export interface BandVideoBoard {
  /** Uploading, processing, or failed (Admins only). */
  readonly inProgress: readonly BandVideo[];
  /** Processed, waiting for a title and publish (Admins only). */
  readonly ready: readonly BandVideo[];
  readonly published: readonly BandVideo[];
  readonly removed: readonly BandVideo[];
  /** Admins only. */
  readonly takenDown: readonly (BandVideo & { readonly notice: TakedownSummary | null })[];
}

const BAND_SELECT = {
  ...PUBLIC_SELECT,
  showId: true,
  version: true,
  status: true,
  originalFilename: true,
  failureReason: true,
  removalReason: true,
  createdAt: true,
  uploader: { select: { name: true } },
  removalRequestedBy: { select: { name: true } },
} as const;

export async function getBandVideoBoard(prisma: PrismaClient, stream: StreamClient, viewer: { role: Role }): Promise<BandVideoBoard> {
  const isAdmin = can(viewer.role, "videos:manage");
  const visible: VideoStatus[] = isAdmin
    ? ["UPLOADING", "PROCESSING", "FAILED", "READY", "PUBLISHED", "DELETION_REQUESTED", "TAKEN_DOWN"]
    : ["PUBLISHED", "DELETION_REQUESTED"];
  const rows = await prisma.video.findMany({ where: { status: { in: visible } }, orderBy: { createdAt: "desc" }, select: BAND_SELECT });

  type Row = (typeof rows)[number];
  const toBand = async (row: Row): Promise<BandVideo> => {
    let playback: VideoPlayback | null = null;
    if (row.playbackOrigin && row.status !== "UPLOADING" && row.status !== "PROCESSING" && row.status !== "FAILED") {
      if (row.status === "PUBLISHED") {
        playback = playbackFor(row.playbackOrigin, row.streamUid, row.posterSeconds, row.captionsLanguage);
      } else {
        try {
          playback = playbackFor(row.playbackOrigin, await stream.createToken(row.streamUid), row.posterSeconds, row.captionsLanguage);
        } catch (error) {
          logger.warn({ err: error, videoId: row.id }, "private video preview token failed");
        }
      }
    }
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      originalFilename: row.originalFilename,
      title: row.title,
      description: row.description,
      posterSeconds: row.posterSeconds,
      durationSeconds: row.durationSeconds,
      duration: formatDuration(row.durationSeconds),
      captionsLanguage: row.captionsLanguage,
      showId: row.showId,
      failureReason: row.failureReason,
      uploaderName: row.uploader.name,
      removalRequestedByName: row.removalRequestedBy?.name ?? null,
      removalReason: row.removalReason,
      createdAt: row.createdAt,
      playback,
    };
  };

  const all = await Promise.all(rows.map(toBand));
  const by = (...statuses: VideoStatus[]) => all.filter((video) => statuses.includes(video.status));
  const takenDown = by("TAKEN_DOWN");
  const notices = await openNoticesFor(prisma, "VIDEO", takenDown.map((video) => video.id));
  return {
    inProgress: by("UPLOADING", "PROCESSING", "FAILED"),
    ready: by("READY"),
    published: by("PUBLISHED"),
    removed: by("DELETION_REQUESTED"),
    takenDown: takenDown.map((video) => ({ ...video, notice: notices.get(video.id) ?? null })),
  };
}
