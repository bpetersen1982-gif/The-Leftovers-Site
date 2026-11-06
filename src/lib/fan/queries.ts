import type { PrismaClient } from "@/generated/prisma/client";
import type { FanPostStatus, Role } from "@/generated/prisma/enums";
import { fromUtc, type IsoDate } from "../dates";
import { can } from "../permissions";
import { type PhotoImage, privateImage, publicImage } from "../photos/queries";
import type { ObjectStorage } from "../storage";

/** Read models for the Fan Wall. The public sees APPROVED posts only, and never emails. */

const PHOTO_FIELDS = {
  id: true,
  photoWidth: true,
  photoHeight: true,
  photoVariants: true,
  photoBlurDataUrl: true,
  photoPublicPrefix: true,
  photoAltText: true,
} as const;

type PhotoRow = {
  id: string;
  photoWidth: number | null;
  photoHeight: number | null;
  photoVariants: Parameters<typeof publicImage>[1]["variants"];
  photoBlurDataUrl: string | null;
  photoPublicPrefix: string | null;
};

function imageFields(row: PhotoRow) {
  return { id: row.id, width: row.photoWidth, height: row.photoHeight, variants: row.photoVariants, blurDataUrl: row.photoBlurDataUrl, publicPrefix: row.photoPublicPrefix };
}

export interface PublicFanPost {
  readonly id: string;
  readonly displayName: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly show: { readonly slug: string; readonly venueName: string; readonly date: IsoDate } | null;
  readonly photo: { readonly image: PhotoImage; readonly altText: string } | null;
}

const PUBLIC_SELECT = {
  ...PHOTO_FIELDS,
  displayName: true,
  message: true,
  createdAt: true,
  show: { select: { slug: true, venueName: true, date: true, isPublic: true } },
} as const;

type PublicRow = PhotoRow & {
  displayName: string;
  message: string;
  createdAt: Date;
  photoAltText: string;
  show: { slug: string; venueName: string; date: Date; isPublic: boolean } | null;
};

function toPublic(storage: ObjectStorage | null, row: PublicRow): PublicFanPost {
  const image = storage ? publicImage(storage, imageFields(row)) : null;
  return {
    id: row.id,
    displayName: row.displayName,
    message: row.message,
    createdAt: row.createdAt,
    // A post never reveals a private show.
    show: row.show?.isPublic ? { slug: row.show.slug, venueName: row.show.venueName, date: fromUtc(row.show.date) } : null,
    photo: image ? { image, altText: row.photoAltText } : null,
  };
}

export const FAN_PAGE_SIZE = 20;

export async function listPublicFanPosts(prisma: PrismaClient, storage: ObjectStorage | null, page: number): Promise<{ posts: PublicFanPost[]; pageCount: number }> {
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const [rows, total] = await Promise.all([
    prisma.fanPost.findMany({ where: { status: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (safePage - 1) * FAN_PAGE_SIZE, take: FAN_PAGE_SIZE, select: PUBLIC_SELECT }),
    prisma.fanPost.count({ where: { status: "APPROVED" } }),
  ]);
  return { posts: rows.map((row) => toPublic(storage, row)), pageCount: Math.max(1, Math.ceil(total / FAN_PAGE_SIZE)) };
}

/** Approved posts from one show (EVT-3). */
export async function fanPostsForShow(prisma: PrismaClient, storage: ObjectStorage | null, showId: string): Promise<PublicFanPost[]> {
  const rows = await prisma.fanPost.findMany({ where: { status: "APPROVED", showId }, orderBy: { createdAt: "desc" }, take: 20, select: PUBLIC_SELECT });
  return rows.map((row) => toPublic(storage, row));
}

// ---------------------------------------------------------------- band

export interface ModerationPost {
  readonly id: string;
  readonly version: number;
  readonly status: FanPostStatus;
  readonly displayName: string;
  readonly message: string;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly showLabel: string | null;
  readonly photo: { readonly image: PhotoImage | null; readonly altText: string } | null;
  readonly photoFailureReason: string | null;
  readonly decidedByName: string | null;
  readonly decidedByRole: Role | null;
  readonly decidedAt: Date | null;
  readonly decisionReason: string | null;
  /** Whether this viewer may change the decision (APR-5). */
  readonly canChange: boolean;
  /** An Admin would be overriding a Member here (APR-4). */
  readonly isOverride: boolean;
}

export interface ModerationBoard {
  readonly pending: readonly ModerationPost[];
  readonly pendingCount: number;
  /** Decided in the last 30 days, newest first. */
  readonly recent: readonly ModerationPost[];
  /** Member decisions an Admin hasn't reviewed by overriding (Admins' "recent member decisions"). */
  readonly memberDecisionCount: number;
}

const RECENT_DAYS = 30;
const BOARD_LIMIT = 100;

const BAND_SELECT = {
  ...PHOTO_FIELDS,
  version: true,
  status: true,
  displayName: true,
  message: true,
  email: true,
  createdAt: true,
  photoFailureReason: true,
  decidedAt: true,
  decidedByRole: true,
  decisionReason: true,
  decidedBy: { select: { name: true } },
  show: { select: { venueName: true, date: true } },
} as const;

export async function getModerationBoard(
  prisma: PrismaClient,
  storage: ObjectStorage | null,
  viewer: { role: Role },
  now: Date = new Date(),
): Promise<ModerationBoard> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  const [pending, pendingCount, recent, memberDecisionCount] = await Promise.all([
    prisma.fanPost.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: BOARD_LIMIT, select: BAND_SELECT }),
    prisma.fanPost.count({ where: { status: "PENDING" } }),
    prisma.fanPost.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] }, decidedAt: { gte: since } },
      orderBy: { decidedAt: "desc" },
      take: BOARD_LIMIT,
      select: BAND_SELECT,
    }),
    prisma.fanPost.count({ where: { status: { in: ["APPROVED", "REJECTED"] }, decidedByRole: "MEMBER", decidedAt: { gte: since } } }),
  ]);
  const isAdmin = can(viewer.role, "fan:override");
  type Row = (typeof pending)[number];
  const toBand = async (row: Row): Promise<ModerationPost> => {
    const fields = imageFields(row);
    const hasPhoto = Array.isArray(row.photoVariants) && row.photoVariants.length > 0;
    const image = !hasPhoto || !storage ? null : row.status === "APPROVED" ? publicImage(storage, fields) : await privateImage(storage, fields);
    const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      displayName: row.displayName,
      message: row.message,
      email: row.email,
      createdAt: row.createdAt,
      showLabel: row.show ? `${row.show.venueName}, ${format.format(row.show.date)}` : null,
      photo: hasPhoto ? { image, altText: row.photoAltText } : null,
      photoFailureReason: row.photoFailureReason,
      decidedByName: row.decidedBy?.name ?? (row.decidedByRole ? "A former band member" : null),
      decidedByRole: row.decidedByRole,
      decidedAt: row.decidedAt,
      decisionReason: row.decisionReason,
      canChange: row.decidedByRole !== "ADMIN" || isAdmin,
      isOverride: isAdmin && row.decidedByRole === "MEMBER",
    };
  };
  return {
    pending: await Promise.all(pending.map(toBand)),
    pendingCount,
    recent: await Promise.all(recent.map(toBand)),
    memberDecisionCount,
  };
}
