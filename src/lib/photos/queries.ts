import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { PhotoStatus, Role } from "@/generated/prisma/enums";
import { fromUtc, type IsoDate } from "../dates";
import { can } from "../permissions";
import type { ObjectStorage } from "../storage";
import { parseStoredFiles, privateFileKey, publicFileKey, type StoredFile } from "./files";

/**
 * Read models for the band's photo pages and the public gallery. URLs are built here so
 * pages never assemble storage keys themselves:
 * - public photos: permanent CDN URLs on the public bucket
 * - unpublished photos: short-lived signed URLs to the private bucket (band only)
 */

const PRIVATE_PREVIEW_TTL_SECONDS = 60 * 60;

export interface PhotoSource {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface PhotoImage {
  readonly width: number;
  readonly height: number;
  /** WebP sizes, smallest first; feed to srcset. */
  readonly sources: readonly PhotoSource[];
  /** Largest WebP: the default src. */
  readonly src: string;
  readonly jpeg: PhotoSource | null;
  readonly blurDataUrl: string | null;
}

interface ImageFields {
  readonly id: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly variants: Prisma.JsonValue;
  readonly blurDataUrl: string | null;
  readonly publicPrefix: string | null;
}

function toImage(photo: ImageFields, urls: ReadonlyMap<string, string>): PhotoImage | null {
  const files = parseStoredFiles(photo.variants);
  const webp = files.filter((file) => file.kind === "webp").sort((a, b) => a.width - b.width);
  const largest = webp.at(-1);
  if (!largest || !photo.width || !photo.height) return null;
  const source = (file: StoredFile): PhotoSource => ({ url: urls.get(file.file) ?? "", width: file.width, height: file.height });
  const jpeg = files.find((file) => file.kind === "jpeg");
  return {
    width: photo.width,
    height: photo.height,
    sources: webp.map(source),
    src: urls.get(largest.file) ?? "",
    jpeg: jpeg ? source(jpeg) : null,
    blurDataUrl: photo.blurDataUrl,
  };
}

/** Public, cacheable URLs. Only valid while the photo is APPROVED. */
export function publicImage(storage: ObjectStorage, photo: ImageFields): PhotoImage | null {
  if (!photo.publicPrefix) return null;
  const prefix = photo.publicPrefix;
  const urls = new Map(parseStoredFiles(photo.variants).map((file) => [file.file, storage.publicUrlFor(publicFileKey(prefix, file.file))]));
  return toImage(photo, urls);
}

/** Signed private URLs, for band pages showing photos that aren't public yet. */
export async function privateImage(storage: ObjectStorage, photo: ImageFields): Promise<PhotoImage | null> {
  const files = parseStoredFiles(photo.variants);
  const entries = await Promise.all(
    files.map(async (file) => [file.file, await storage.presignPrivateRead(privateFileKey(photo.id, file.file), PRIVATE_PREVIEW_TTL_SECONDS)] as const),
  );
  return toImage(photo, new Map(entries));
}

// ---------------------------------------------------------------- band view

export interface BandPhoto {
  readonly id: string;
  readonly version: number;
  readonly status: PhotoStatus;
  readonly originalFilename: string;
  readonly altText: string;
  readonly caption: string;
  readonly credit: string;
  readonly failureReason: string | null;
  readonly rejectionReason: string | null;
  readonly removalReason: string | null;
  readonly removalRequestedByName: string | null;
  readonly removalRequestedByRole: Role | null;
  readonly uploaderId: string;
  readonly uploaderName: string;
  readonly isMine: boolean;
  readonly createdAt: Date;
  readonly submittedAt: Date | null;
  readonly publishedAt: Date | null;
  readonly image: PhotoImage | null;
}

export interface BandPhotoBoard {
  /** The viewer's own photos that aren't submitted yet (drafts, rejected, failed). */
  readonly mine: readonly BandPhoto[];
  /** Waiting on an Admin. Admins see everyone's; Members see their own. */
  readonly pending: readonly BandPhoto[];
  readonly published: readonly BandPhoto[];
  readonly publishedTotal: number;
  /** Taken off the site, waiting for an Admin to delete or restore (APR-7). */
  readonly removed: readonly BandPhoto[];
  /** Copyright takedowns with their open notice. Admins only; empty for Members. */
  readonly takenDown: readonly (BandPhoto & { readonly notice: TakedownSummary | null })[];
}

export interface TakedownSummary {
  readonly id: string;
  readonly mediaKind: "PHOTO" | "VIDEO";
  readonly mediaLabel: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly workClaimed: string;
  readonly receivedOn: IsoDate;
  readonly notes: string;
  readonly actedByName: string;
  readonly createdAt: Date;
  readonly resolution: "RESTORED" | "DELETED" | null;
  readonly resolvedByName: string | null;
  readonly resolvedAt: Date | null;
}

const NOTICE_SELECT = {
  id: true,
  mediaKind: true,
  mediaId: true,
  mediaLabel: true,
  senderName: true,
  senderEmail: true,
  workClaimed: true,
  receivedOn: true,
  notes: true,
  createdAt: true,
  resolution: true,
  resolvedAt: true,
  actedBy: { select: { name: true } },
  resolvedBy: { select: { name: true } },
} as const;

type NoticeRow = Prisma.TakedownNoticeGetPayload<{ select: typeof NOTICE_SELECT }>;

function toNotice(row: NoticeRow): TakedownSummary {
  return {
    id: row.id,
    mediaKind: row.mediaKind,
    mediaLabel: row.mediaLabel,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    workClaimed: row.workClaimed,
    receivedOn: fromUtc(row.receivedOn),
    notes: row.notes,
    actedByName: row.actedBy.name,
    createdAt: row.createdAt,
    resolution: row.resolution,
    resolvedByName: row.resolvedBy?.name ?? null,
    resolvedAt: row.resolvedAt,
  };
}

/** Latest open notice per item, for taken-down photos or videos. */
export async function openNoticesFor(prisma: PrismaClient, mediaKind: "PHOTO" | "VIDEO", ids: readonly string[]): Promise<Map<string, TakedownSummary>> {
  const result = new Map<string, TakedownSummary>();
  if (ids.length === 0) return result;
  const rows = await prisma.takedownNotice.findMany({
    where: { mediaKind, mediaId: { in: [...ids] }, resolution: null },
    orderBy: { createdAt: "desc" },
    select: NOTICE_SELECT,
  });
  for (const row of rows) if (!result.has(row.mediaId)) result.set(row.mediaId, toNotice(row));
  return result;
}

/** Every notice acted on, newest first (the permanent record, LEG-3). */
export async function listTakedownNotices(prisma: PrismaClient, limit = 50): Promise<TakedownSummary[]> {
  const rows = await prisma.takedownNotice.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: NOTICE_SELECT });
  return rows.map(toNotice);
}

const BAND_SELECT = {
  id: true,
  version: true,
  status: true,
  originalFilename: true,
  altText: true,
  caption: true,
  credit: true,
  failureReason: true,
  rejectionReason: true,
  removalReason: true,
  removalRequestedByRole: true,
  removalRequestedBy: { select: { name: true } },
  uploaderId: true,
  createdAt: true,
  submittedAt: true,
  publishedAt: true,
  width: true,
  height: true,
  variants: true,
  blurDataUrl: true,
  publicPrefix: true,
  uploader: { select: { name: true } },
} as const;

const PUBLISHED_PAGE = 60;

export async function getBandPhotoBoard(
  prisma: PrismaClient,
  storage: ObjectStorage,
  viewer: { id: string; role: Role },
): Promise<BandPhotoBoard> {
  const reviewsAll = can(viewer.role, "photos:review");
  const [mine, pending, published, publishedTotal, removed, takenDown] = await Promise.all([
    prisma.photo.findMany({
      where: { uploaderId: viewer.id, status: { in: ["DRAFT", "REJECTED", "FAILED"] } },
      orderBy: { createdAt: "asc" },
      select: BAND_SELECT,
    }),
    prisma.photo.findMany({
      where: { status: "PENDING_REVIEW", ...(reviewsAll ? {} : { uploaderId: viewer.id }) },
      orderBy: { submittedAt: "asc" },
      select: BAND_SELECT,
    }),
    prisma.photo.findMany({
      where: { status: "APPROVED" },
      orderBy: { publishedAt: "desc" },
      take: PUBLISHED_PAGE,
      select: BAND_SELECT,
    }),
    prisma.photo.count({ where: { status: "APPROVED" } }),
    prisma.photo.findMany({
      where: { status: "DELETION_REQUESTED" },
      orderBy: { removalRequestedAt: "asc" },
      select: BAND_SELECT,
    }),
    reviewsAll
      ? prisma.photo.findMany({ where: { status: "TAKEN_DOWN" }, orderBy: { updatedAt: "desc" }, select: BAND_SELECT })
      : Promise.resolve([]),
  ]);
  const noticeFor = await openNoticesFor(prisma, "PHOTO", takenDown.map((row) => row.id));

  type Row = (typeof mine)[number];
  const toBand = async (row: Row): Promise<BandPhoto> => ({
    id: row.id,
    version: row.version,
    status: row.status,
    originalFilename: row.originalFilename,
    altText: row.altText,
    caption: row.caption,
    credit: row.credit,
    failureReason: row.failureReason,
    rejectionReason: row.rejectionReason,
    removalReason: row.removalReason,
    removalRequestedByName: row.removalRequestedBy?.name ?? null,
    removalRequestedByRole: row.removalRequestedByRole,
    uploaderId: row.uploaderId,
    uploaderName: row.uploader.name,
    isMine: row.uploaderId === viewer.id,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    publishedAt: row.publishedAt,
    image: row.status === "APPROVED" ? publicImage(storage, row) : await privateImage(storage, row),
  });

  return {
    mine: await Promise.all(mine.map(toBand)),
    pending: await Promise.all(pending.map(toBand)),
    published: await Promise.all(published.map(toBand)),
    publishedTotal,
    removed: await Promise.all(removed.map(toBand)),
    takenDown: await Promise.all(takenDown.map(async (row) => ({ ...(await toBand(row)), notice: noticeFor.get(row.id) ?? null }))),
  };
}

// ---------------------------------------------------------------- public view

export interface PublicPhoto {
  readonly id: string;
  readonly altText: string;
  readonly caption: string;
  readonly credit: string;
  readonly publishedAt: Date;
  readonly image: PhotoImage;
}

const PUBLIC_SELECT = {
  id: true,
  altText: true,
  caption: true,
  credit: true,
  publishedAt: true,
  width: true,
  height: true,
  variants: true,
  blurDataUrl: true,
  publicPrefix: true,
} as const;

type PublicRow = { publishedAt: Date | null } & ImageFields & { altText: string; caption: string; credit: string };

function toPublic(storage: ObjectStorage, row: PublicRow): PublicPhoto | null {
  const image = publicImage(storage, row);
  if (!image || !row.publishedAt) return null;
  return { id: row.id, altText: row.altText, caption: row.caption, credit: row.credit, publishedAt: row.publishedAt, image };
}

export const PUBLIC_PAGE_SIZE = 36;

/** Newest first, `PUBLIC_PAGE_SIZE` per page (1-based). */
export async function listPublicPhotos(
  prisma: PrismaClient,
  storage: ObjectStorage,
  page: number,
): Promise<{ photos: PublicPhoto[]; total: number; pageCount: number }> {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const [rows, total] = await Promise.all([
    prisma.photo.findMany({
      where: { status: "APPROVED" },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      skip: (safePage - 1) * PUBLIC_PAGE_SIZE,
      take: PUBLIC_PAGE_SIZE,
      select: PUBLIC_SELECT,
    }),
    prisma.photo.count({ where: { status: "APPROVED" } }),
  ]);
  return {
    photos: rows.flatMap((row) => toPublic(storage, row) ?? []),
    total,
    pageCount: Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE)),
  };
}

/** One public photo plus its neighbours (newer/older) for prev/next links. */
export async function getPublicPhoto(
  prisma: PrismaClient,
  storage: ObjectStorage,
  id: string,
): Promise<{ photo: PublicPhoto; newerId: string | null; olderId: string | null } | null> {
  const row = await prisma.photo.findFirst({ where: { id, status: "APPROVED" }, select: PUBLIC_SELECT });
  const photo = row ? toPublic(storage, row) : null;
  if (!photo) return null;
  const [newer, older] = await Promise.all([
    prisma.photo.findFirst({
      where: {
        status: "APPROVED",
        OR: [{ publishedAt: { gt: photo.publishedAt } }, { publishedAt: photo.publishedAt, id: { lt: photo.id } }],
      },
      orderBy: [{ publishedAt: "asc" }, { id: "desc" }],
      select: { id: true },
    }),
    prisma.photo.findFirst({
      where: {
        status: "APPROVED",
        OR: [{ publishedAt: { lt: photo.publishedAt } }, { publishedAt: photo.publishedAt, id: { gt: photo.id } }],
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);
  return { photo, newerId: newer?.id ?? null, olderId: older?.id ?? null };
}
