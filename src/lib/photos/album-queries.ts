import type { PrismaClient } from "@/generated/prisma/client";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { fromUtc, type IsoDate } from "../dates";
import type { ObjectStorage } from "../storage";
import { type PhotoImage, privateImage, publicImage } from "./queries";

/**
 * Read models for albums. The public only ever sees public albums and, inside them,
 * APPROVED photos; the cover falls back to the first approved photo when the chosen
 * cover isn't approved (e.g. it was taken off the site).
 */

const IMAGE_FIELDS = { id: true, width: true, height: true, variants: true, blurDataUrl: true, publicPrefix: true } as const;

const ORDER = [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] as const;

export interface AlbumSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly eventDate: IsoDate | null;
  readonly isPublic: boolean;
  /** Approved photos, i.e. what the public sees. */
  readonly publicPhotoCount: number;
  readonly cover: { readonly image: PhotoImage; readonly altText: string } | null;
}

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  title: true,
  eventDate: true,
  isPublic: true,
  coverPhoto: { select: { ...IMAGE_FIELDS, status: true, altText: true } },
  items: {
    where: { photo: { status: "APPROVED" } },
    orderBy: { sortOrder: "asc" },
    take: 1,
    select: { photo: { select: { ...IMAGE_FIELDS, altText: true } } },
  },
  _count: { select: { items: { where: { photo: { status: "APPROVED" } } } } },
} as const;

type SummaryRow = {
  id: string;
  slug: string;
  title: string;
  eventDate: Date | null;
  isPublic: boolean;
  coverPhoto: (Parameters<typeof publicImage>[1] & { status: PhotoStatus; altText: string }) | null;
  items: { photo: Parameters<typeof publicImage>[1] & { altText: string } }[];
  _count: { items: number };
};

function toSummary(storage: ObjectStorage, row: SummaryRow): AlbumSummary {
  const chosen = row.coverPhoto?.status === "APPROVED" ? row.coverPhoto : null;
  const coverPhoto = chosen ?? row.items[0]?.photo ?? null;
  const image = coverPhoto ? publicImage(storage, coverPhoto) : null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    eventDate: row.eventDate ? fromUtc(row.eventDate) : null,
    isPublic: row.isPublic,
    publicPhotoCount: row._count.items,
    cover: image && coverPhoto ? { image, altText: coverPhoto.altText } : null,
  };
}

/** Public albums with at least one approved photo, newest show first. */
export async function listPublicAlbums(prisma: PrismaClient, storage: ObjectStorage): Promise<AlbumSummary[]> {
  const rows = await prisma.album.findMany({
    where: { isPublic: true, items: { some: { photo: { status: "APPROVED" } } } },
    orderBy: [...ORDER],
    select: SUMMARY_SELECT,
  });
  return rows.map((row) => toSummary(storage, row));
}

/** Every album, for the band's albums page. */
export async function listBandAlbums(prisma: PrismaClient, storage: ObjectStorage): Promise<(AlbumSummary & { totalPhotoCount: number })[]> {
  const rows = await prisma.album.findMany({
    orderBy: [...ORDER],
    select: SUMMARY_SELECT,
  });
  const totals = await prisma.albumItem.groupBy({ by: ["albumId"], _count: { _all: true } });
  const totalFor = new Map(totals.map((row) => [row.albumId, row._count._all]));
  return rows.map((row) => ({ ...toSummary(storage, row), totalPhotoCount: totalFor.get(row.id) ?? 0 }));
}

// ---------------------------------------------------------------- one album

export interface AlbumPhoto {
  readonly id: string;
  readonly altText: string;
  readonly caption: string;
  readonly credit: string;
  readonly status: PhotoStatus;
  readonly image: PhotoImage | null;
}

export interface PublicAlbum {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly eventDate: IsoDate | null;
  readonly cover: AlbumSummary["cover"];
  readonly photos: readonly (AlbumPhoto & { image: PhotoImage })[];
}

const PHOTO_FIELDS = { ...IMAGE_FIELDS, altText: true, caption: true, credit: true, status: true } as const;

export async function getPublicAlbum(prisma: PrismaClient, storage: ObjectStorage, slug: string): Promise<PublicAlbum | null> {
  const row = await prisma.album.findFirst({
    where: { slug, isPublic: true },
    select: {
      ...SUMMARY_SELECT,
      description: true,
      items: { where: { photo: { status: "APPROVED" } }, orderBy: { sortOrder: "asc" }, select: { photo: { select: PHOTO_FIELDS } } },
    },
  });
  if (!row) return null;
  const photos = row.items.flatMap(({ photo }) => {
    const image = publicImage(storage, photo);
    return image ? [{ id: photo.id, altText: photo.altText, caption: photo.caption, credit: photo.credit, status: photo.status, image }] : [];
  });
  if (photos.length === 0) return null;
  const summary = toSummary(storage, row);
  return { id: row.id, slug: row.slug, title: row.title, description: row.description, eventDate: summary.eventDate, cover: summary.cover, photos };
}

export interface BandAlbum {
  readonly id: string;
  readonly version: number;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly eventDate: IsoDate | null;
  readonly isPublic: boolean;
  readonly coverPhotoId: string | null;
  readonly photos: readonly AlbumPhoto[];
  /** Published photos not in this album yet, newest first. */
  readonly addable: readonly AlbumPhoto[];
}

const ADDABLE_LIMIT = 120;

async function bandImage(storage: ObjectStorage, photo: Parameters<typeof publicImage>[1] & { status: PhotoStatus }): Promise<PhotoImage | null> {
  return photo.status === "APPROVED" ? publicImage(storage, photo) : privateImage(storage, photo);
}

export async function getBandAlbum(prisma: PrismaClient, storage: ObjectStorage, id: string): Promise<BandAlbum | null> {
  const row = await prisma.album.findUnique({
    where: { id },
    select: {
      id: true,
      version: true,
      slug: true,
      title: true,
      description: true,
      eventDate: true,
      isPublic: true,
      coverPhotoId: true,
      items: { orderBy: { sortOrder: "asc" }, select: { photo: { select: PHOTO_FIELDS } } },
    },
  });
  if (!row) return null;
  const inAlbum = row.items.map((item) => item.photo.id);
  const candidates = await prisma.photo.findMany({
    where: { status: "APPROVED", id: { notIn: inAlbum } },
    orderBy: { publishedAt: "desc" },
    take: ADDABLE_LIMIT,
    select: PHOTO_FIELDS,
  });
  const toPhoto = async (photo: (typeof candidates)[number]): Promise<AlbumPhoto> => ({
    id: photo.id,
    altText: photo.altText,
    caption: photo.caption,
    credit: photo.credit,
    status: photo.status,
    image: await bandImage(storage, photo),
  });
  return {
    id: row.id,
    version: row.version,
    slug: row.slug,
    title: row.title,
    description: row.description,
    eventDate: row.eventDate ? fromUtc(row.eventDate) : null,
    isPublic: row.isPublic,
    coverPhotoId: row.coverPhotoId,
    photos: await Promise.all(row.items.map((item) => toPhoto(item.photo))),
    addable: await Promise.all(candidates.map(toPhoto)),
  };
}
