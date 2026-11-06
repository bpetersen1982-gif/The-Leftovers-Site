import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { type AuditActor, writeAudit } from "../audit";
import { isIsoDate, toDbDate } from "../dates";
import { can } from "../permissions";

/**
 * Albums (requirements MED-5): ordered galleries of published photos with a cover.
 *
 * Every change is checked against the album's version (two Admins editing at once can't
 * both win) and runs with the album row locked, so concurrent adds and moves can't
 * produce duplicate positions. A photo can be in several albums; the public only ever
 * sees an album's APPROVED photos, so taking a photo off the site hides it everywhere.
 */

export const MAX_ALBUM_TITLE = 80;
export const MAX_ALBUM_DESCRIPTION = 1_000;
export const MAX_ALBUM_PHOTOS = 500;
const MAX_ADD_AT_ONCE = 100;
const MAX_SLUG = 60;

export type AlbumErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "NOT_IN_ALBUM" | "NOTHING_TO_ADD" | "TOO_MANY_PHOTOS" | "SHOW_NOT_FOUND";

const MESSAGES: Record<AlbumErrorCode, string> = {
  FORBIDDEN: "Only Admins can manage albums.",
  NOT_FOUND: "That album no longer exists.",
  CONFLICT: "Someone else changed this album while you were looking at it. Reload and try again.",
  NOT_IN_ALBUM: "That photo isn't in this album anymore. Reload and try again.",
  NOTHING_TO_ADD: "Pick at least one published photo that isn't already in the album.",
  TOO_MANY_PHOTOS: `An album can hold up to ${MAX_ALBUM_PHOTOS} photos.`,
  SHOW_NOT_FOUND: "That show no longer exists. Pick another.",
};

export class AlbumError extends Error {
  override readonly name = "AlbumError";
  constructor(readonly code: AlbumErrorCode) {
    super(MESSAGES[code]);
  }
}

// ---------------------------------------------------------------- validation

const oneLine = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer`));

export const albumInputSchema = z.strictObject({
  title: oneLine(MAX_ALBUM_TITLE, "Title").pipe(z.string().min(1, "Give the album a title.")),
  description: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(MAX_ALBUM_DESCRIPTION, `Description must be ${MAX_ALBUM_DESCRIPTION} characters or fewer`)),
  eventDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isIsoDate(value), "Use a real date (YYYY-MM-DD).")
    .transform((value) => value || null),
  isPublic: z.boolean(),
  /** Optional show this album is from; "" = none. */
  showId: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((value) => value || null),
});
export type AlbumInput = z.input<typeof albumInputSchema>;

/** Unknown show ids are rejected up front instead of failing on the foreign key. */
async function assertShowExists(tx: Tx | PrismaClient, showId: string | null): Promise<void> {
  if (showId && !(await tx.show.findUnique({ where: { id: showId }, select: { id: true } }))) throw new AlbumError("SHOW_NOT_FOUND");
}

export const albumRefSchema = z.strictObject({ id: z.uuid(), version: z.coerce.number().int().min(1) });
export type AlbumRef = z.infer<typeof albumRefSchema>;

const photoIdsSchema = z.array(z.uuid()).min(1).max(MAX_ADD_AT_ONCE);

/** "Zoo Bar — Oct 2026!" -> "zoo-bar-oct-2026". Only a-z, 0-9 and single hyphens. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return slug || "album";
}

// ---------------------------------------------------------------- helpers

type Tx = Prisma.TransactionClient;

function assertCanManage(actor: AuditActor): void {
  if (!can(actor.role, "albums:manage")) throw new AlbumError("FORBIDDEN");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Locks the album row for this transaction and checks nobody changed it since it was loaded. */
async function lockAlbum(tx: Tx, ref: AlbumRef): Promise<void> {
  const rows = await tx.$queryRaw<{ version: number }[]>`SELECT "version" FROM "album" WHERE "id" = ${ref.id}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AlbumError("NOT_FOUND");
  if (row.version !== ref.version) throw new AlbumError("CONFLICT");
}

async function bumpVersion(tx: Tx, id: string, data: Prisma.AlbumUncheckedUpdateInput = {}): Promise<number> {
  const updated = await tx.album.update({ where: { id }, data: { ...data, version: { increment: 1 } }, select: { version: true } });
  return updated.version;
}

async function orderedPhotoIds(tx: Tx, albumId: string): Promise<string[]> {
  const items = await tx.albumItem.findMany({ where: { albumId }, orderBy: [{ sortOrder: "asc" }, { addedAt: "asc" }], select: { photoId: true } });
  return items.map((item) => item.photoId);
}

/** Rewrites positions 1..n in the given order (also repairs any gaps or duplicates). */
async function renumber(tx: Tx, albumId: string, photoIds: readonly string[]): Promise<void> {
  for (const [index, photoId] of photoIds.entries()) {
    await tx.albumItem.update({ where: { albumId_photoId: { albumId, photoId } }, data: { sortOrder: index + 1 } });
  }
}

interface Meta {
  readonly requestId?: string | null;
}

// ---------------------------------------------------------------- album CRUD

/** Creates an album and returns its id and slug. The slug never changes afterwards. */
export async function createAlbum(prisma: PrismaClient, actor: AuditActor, input: AlbumInput, meta: Meta = {}): Promise<{ id: string; slug: string }> {
  assertCanManage(actor);
  const album = albumInputSchema.parse(input);
  await assertShowExists(prisma, album.showId);
  const base = slugify(album.title);
  // Unique slug: "zoo-bar", then "zoo-bar-2", ... Retries if another Admin takes it first.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = new Set(
      (await prisma.album.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((row) => row.slug),
    );
    let slug = base;
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
    try {
      const id = await prisma.$transaction(async (tx) => {
        const created = await tx.album.create({
          data: {
            slug,
            title: album.title,
            description: album.description,
            eventDate: album.eventDate ? toDbDate(album.eventDate) : null,
            isPublic: album.isPublic,
            showId: album.showId,
            createdById: actor.id,
          },
        });
        await writeAudit(tx, { actor, action: "album.create", targetType: "album", targetId: created.id, after: { slug, title: album.title }, requestId: meta.requestId });
        return created.id;
      });
      return { id, slug };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AlbumError("CONFLICT");
}

export async function updateAlbum(prisma: PrismaClient, actor: AuditActor, ref: AlbumRef, input: AlbumInput, meta: Meta = {}): Promise<number> {
  assertCanManage(actor);
  const parsedRef = albumRefSchema.parse(ref);
  const album = albumInputSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockAlbum(tx, parsedRef);
    await assertShowExists(tx, album.showId);
    const before = await tx.album.findUniqueOrThrow({ where: { id: parsedRef.id }, select: { title: true, isPublic: true } });
    const version = await bumpVersion(tx, parsedRef.id, {
      title: album.title,
      description: album.description,
      eventDate: album.eventDate ? toDbDate(album.eventDate) : null,
      isPublic: album.isPublic,
      showId: album.showId,
    });
    await writeAudit(tx, {
      actor,
      action: "album.update",
      targetType: "album",
      targetId: parsedRef.id,
      before,
      after: { title: album.title, isPublic: album.isPublic },
      requestId: meta.requestId,
    });
    return version;
  });
}

/** Deletes the album only; its photos stay published and in any other albums. */
export async function deleteAlbum(prisma: PrismaClient, actor: AuditActor, ref: AlbumRef, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = albumRefSchema.parse(ref);
  await prisma.$transaction(async (tx) => {
    await lockAlbum(tx, parsedRef);
    const album = await tx.album.findUniqueOrThrow({ where: { id: parsedRef.id }, select: { slug: true, title: true, _count: { select: { items: true } } } });
    await tx.album.delete({ where: { id: parsedRef.id } });
    await writeAudit(tx, {
      actor,
      action: "album.delete",
      targetType: "album",
      targetId: parsedRef.id,
      before: { slug: album.slug, title: album.title, photos: album._count.items },
      requestId: meta.requestId,
    });
  });
}

// ---------------------------------------------------------------- photos in an album

/** Adds published photos to the end of the album, skipping ones already in it. Returns how many were added. */
export async function addPhotosToAlbum(
  prisma: PrismaClient,
  actor: AuditActor,
  ref: AlbumRef,
  photoIds: readonly string[],
  meta: Meta = {},
): Promise<number> {
  assertCanManage(actor);
  const parsedRef = albumRefSchema.parse(ref);
  const ids = [...new Set(photoIdsSchema.parse(photoIds))];
  return prisma.$transaction(async (tx) => {
    await lockAlbum(tx, parsedRef);
    const existing = new Set(await orderedPhotoIds(tx, parsedRef.id));
    const publishable = await tx.photo.findMany({ where: { id: { in: ids }, status: "APPROVED" }, select: { id: true } });
    const allowed = new Set(publishable.map((photo) => photo.id));
    // Keep the order the Admin picked them in.
    const toAdd = ids.filter((id) => allowed.has(id) && !existing.has(id));
    if (toAdd.length === 0) throw new AlbumError("NOTHING_TO_ADD");
    if (existing.size + toAdd.length > MAX_ALBUM_PHOTOS) throw new AlbumError("TOO_MANY_PHOTOS");
    await tx.albumItem.createMany({
      data: toAdd.map((photoId, index) => ({ albumId: parsedRef.id, photoId, sortOrder: existing.size + index + 1 })),
    });
    await bumpVersion(tx, parsedRef.id);
    await writeAudit(tx, { actor, action: "album.photos", targetType: "album", targetId: parsedRef.id, after: { added: toAdd }, requestId: meta.requestId });
    return toAdd.length;
  });
}

export async function removePhotoFromAlbum(prisma: PrismaClient, actor: AuditActor, ref: AlbumRef, photoId: string, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = albumRefSchema.parse(ref);
  const id = z.uuid().parse(photoId);
  await prisma.$transaction(async (tx) => {
    await lockAlbum(tx, parsedRef);
    const removed = await tx.albumItem.deleteMany({ where: { albumId: parsedRef.id, photoId: id } });
    if (removed.count !== 1) throw new AlbumError("NOT_IN_ALBUM");
    await renumber(tx, parsedRef.id, await orderedPhotoIds(tx, parsedRef.id));
    const album = await tx.album.findUniqueOrThrow({ where: { id: parsedRef.id }, select: { coverPhotoId: true } });
    await bumpVersion(tx, parsedRef.id, album.coverPhotoId === id ? { coverPhotoId: null } : {});
    await writeAudit(tx, { actor, action: "album.photos", targetType: "album", targetId: parsedRef.id, after: { removed: id }, requestId: meta.requestId });
  });
}

export async function movePhotoInAlbum(
  prisma: PrismaClient,
  actor: AuditActor,
  ref: AlbumRef,
  photoId: string,
  direction: "up" | "down",
): Promise<void> {
  assertCanManage(actor);
  const parsedRef = albumRefSchema.parse(ref);
  const id = z.uuid().parse(photoId);
  await prisma.$transaction(async (tx) => {
    await lockAlbum(tx, parsedRef);
    const order = await orderedPhotoIds(tx, parsedRef.id);
    const index = order.indexOf(id);
    if (index === -1) throw new AlbumError("NOT_IN_ALBUM");
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= order.length) return;
    const swapped = [...order];
    [swapped[index], swapped[target]] = [swapped[target] as string, swapped[index] as string];
    await renumber(tx, parsedRef.id, swapped);
    await bumpVersion(tx, parsedRef.id);
  });
}

export async function setAlbumCover(prisma: PrismaClient, actor: AuditActor, ref: AlbumRef, photoId: string, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = albumRefSchema.parse(ref);
  const id = z.uuid().parse(photoId);
  await prisma.$transaction(async (tx) => {
    await lockAlbum(tx, parsedRef);
    const item = await tx.albumItem.findUnique({ where: { albumId_photoId: { albumId: parsedRef.id, photoId: id } } });
    if (!item) throw new AlbumError("NOT_IN_ALBUM");
    await bumpVersion(tx, parsedRef.id, { coverPhotoId: id });
    await writeAudit(tx, { actor, action: "album.update", targetType: "album", targetId: parsedRef.id, after: { coverPhotoId: id }, requestId: meta.requestId });
  });
}
