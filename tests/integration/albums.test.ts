import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { getBandAlbum, getPublicAlbum, listBandAlbums, listPublicAlbums } from "@/lib/photos/album-queries";
import {
  addPhotosToAlbum,
  createAlbum,
  deleteAlbum,
  movePhotoInAlbum,
  removePhotoFromAlbum,
  setAlbumCover,
  slugify,
  updateAlbum,
} from "@/lib/photos/albums";
import { completeUpload, createUpload } from "@/lib/photos/upload";
import { purgePhoto, requestPhotoRemoval, submitPhotos, updatePhotoDetails } from "@/lib/photos/workflow";
import { createTestStorage, resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const storage = createTestStorage();
const deps = { prisma, storage };

async function makeUser(role: Role, name = role === "ADMIN" ? "Erik Admin" : "Jim Member") {
  const user = await prisma.user.create({ data: { id: randomUUID(), name, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role };
}

let shade = 0;
/** Uploads, describes, and publishes a photo as an Admin. */
async function publishedPhoto(admin: { id: string; role: Role }, altText: string): Promise<string> {
  shade += 30;
  const body = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: shade % 255, g: 80, b: 120 } } }).jpeg().toBuffer();
  const created = await createUpload(deps, admin, { filename: `${altText}.jpg`, contentType: "image/jpeg", size: body.byteLength });
  await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: new Uint8Array(body) });
  await completeUpload(deps, admin, created.photoId);
  const draft = await prisma.photo.findUniqueOrThrow({ where: { id: created.photoId } });
  const version = await updatePhotoDetails(deps, admin, { id: draft.id, version: draft.version, altText, caption: "", credit: "" });
  await submitPhotos(deps, admin, [{ id: draft.id, version }]);
  return draft.id;
}

async function ref(id: string) {
  const album = await prisma.album.findUniqueOrThrow({ where: { id } });
  return { id, version: album.version };
}

const DETAILS = { title: "Zoo Bar — Oct 2026!", description: "  Packed house.  ", eventDate: "2026-10-17", isPublic: true };

beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("slugify", () => {
  it("makes short, safe, readable slugs", () => {
    expect(slugify("Zoo Bar — Oct 2026!")).toBe("zoo-bar-oct-2026");
    expect(slugify("Café & Bar")).toBe("cafe-and-bar");
    expect(slugify("!!!")).toBe("album");
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});

describe("albums", () => {
  it("creates albums with unique slugs; only Admins can", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    const first = await createAlbum(prisma, admin, DETAILS);
    const second = await createAlbum(prisma, admin, DETAILS);
    expect([first.slug, second.slug]).toEqual(["zoo-bar-oct-2026", "zoo-bar-oct-2026-2"]);
    expect(await prisma.album.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ description: "Packed house.", isPublic: true });
    await expect(createAlbum(prisma, member, DETAILS)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAlbum(prisma, admin, { ...DETAILS, title: "  " })).rejects.toThrow(/title/);
    await expect(createAlbum(prisma, admin, { ...DETAILS, eventDate: "2026-02-30" })).rejects.toThrow(/real date/);
  });

  it("adds published photos in order, reorders, sets a cover, and removes", async () => {
    const admin = await makeUser("ADMIN");
    const album = await createAlbum(prisma, admin, DETAILS);
    const [a, b, c] = [await publishedPhoto(admin, "A"), await publishedPhoto(admin, "B"), await publishedPhoto(admin, "C")];

    expect(await addPhotosToAlbum(prisma, admin, await ref(album.id), [b, a, b])).toBe(2);
    expect(await addPhotosToAlbum(prisma, admin, await ref(album.id), [a, c])).toBe(1);
    await expect(addPhotosToAlbum(prisma, admin, await ref(album.id), [a])).rejects.toMatchObject({ code: "NOTHING_TO_ADD" });
    const order = async () => (await getBandAlbum(prisma, storage, album.id))?.photos.map((photo) => photo.altText);
    expect(await order()).toEqual(["B", "A", "C"]);

    await movePhotoInAlbum(prisma, admin, await ref(album.id), c, "up");
    expect(await order()).toEqual(["B", "C", "A"]);
    await movePhotoInAlbum(prisma, admin, await ref(album.id), b, "up"); // already first: no-op
    expect(await order()).toEqual(["B", "C", "A"]);

    // Default cover is the first photo; an explicit cover wins.
    expect((await listPublicAlbums(prisma, storage))[0]?.cover?.altText).toBe("B");
    await setAlbumCover(prisma, admin, await ref(album.id), a);
    expect((await listPublicAlbums(prisma, storage))[0]?.cover?.altText).toBe("A");

    await removePhotoFromAlbum(prisma, admin, await ref(album.id), a);
    expect(await order()).toEqual(["B", "C"]);
    expect((await prisma.album.findUniqueOrThrow({ where: { id: album.id } })).coverPhotoId).toBeNull();
    const positions = await prisma.albumItem.findMany({ where: { albumId: album.id }, orderBy: { sortOrder: "asc" }, select: { sortOrder: true } });
    expect(positions.map((item) => item.sortOrder)).toEqual([1, 2]);
    // The photo itself stays published.
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: a } })).status).toBe("APPROVED");
  });

  it("rejects stale edits and keeps positions consistent under concurrent adds", async () => {
    const erik = await makeUser("ADMIN");
    const brandon = await makeUser("ADMIN", "Brandon Admin");
    const album = await createAlbum(prisma, erik, DETAILS);
    const [a, b] = [await publishedPhoto(erik, "A"), await publishedPhoto(erik, "B")];
    const stale = await ref(album.id);
    const results = await Promise.allSettled([
      addPhotosToAlbum(prisma, erik, stale, [a]),
      addPhotosToAlbum(prisma, brandon, stale, [b]),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(updateAlbum(prisma, erik, stale, DETAILS)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.albumItem.count({ where: { albumId: album.id } })).toBe(1);
  });

  it("shows the public only public albums and approved photos", async () => {
    const admin = await makeUser("ADMIN");
    const shown = await createAlbum(prisma, admin, DETAILS);
    const hidden = await createAlbum(prisma, admin, { ...DETAILS, title: "Rehearsal", isPublic: false });
    const empty = await createAlbum(prisma, admin, { ...DETAILS, title: "Nothing yet" });
    const [a, b] = [await publishedPhoto(admin, "A"), await publishedPhoto(admin, "B")];
    await addPhotosToAlbum(prisma, admin, await ref(shown.id), [a, b]);
    await addPhotosToAlbum(prisma, admin, await ref(hidden.id), [a]);

    expect((await listPublicAlbums(prisma, storage)).map((album) => album.slug)).toEqual([shown.slug]);
    expect(await getPublicAlbum(prisma, storage, hidden.slug)).toBeNull();
    expect(await getPublicAlbum(prisma, storage, empty.slug)).toBeNull();
    const publicAlbum = await getPublicAlbum(prisma, storage, shown.slug);
    expect(publicAlbum).toMatchObject({ title: "Zoo Bar — Oct 2026!", eventDate: "2026-10-17" });
    expect(publicAlbum?.photos.map((photo) => photo.altText)).toEqual(["A", "B"]);

    // Taking a photo off the site hides it in every album; deleting it removes it from them.
    const photoA = await prisma.photo.findUniqueOrThrow({ where: { id: a } });
    await requestPhotoRemoval(deps, admin, { id: a, version: photoA.version }, "");
    expect((await getPublicAlbum(prisma, storage, shown.slug))?.photos.map((photo) => photo.altText)).toEqual(["B"]);
    const band = await getBandAlbum(prisma, storage, shown.id);
    expect(band?.photos.map((photo) => [photo.altText, photo.status])).toEqual([["A", "DELETION_REQUESTED"], ["B", "APPROVED"]]);
    expect(band?.addable).toEqual([]);
    const removed = await prisma.photo.findUniqueOrThrow({ where: { id: a } });
    await purgePhoto(deps, admin, { id: a, version: removed.version });
    expect(await prisma.albumItem.count({ where: { photoId: a } })).toBe(0);

    const bandList = await listBandAlbums(prisma, storage);
    expect(bandList.map((album) => [album.title, album.publicPhotoCount, album.totalPhotoCount])).toEqual(
      expect.arrayContaining([["Zoo Bar — Oct 2026!", 1, 1], ["Rehearsal", 0, 0], ["Nothing yet", 0, 0]]),
    );
  });

  it("deletes an album but keeps its photos", async () => {
    const admin = await makeUser("ADMIN");
    const album = await createAlbum(prisma, admin, DETAILS);
    const a = await publishedPhoto(admin, "A");
    await addPhotosToAlbum(prisma, admin, await ref(album.id), [a]);
    await deleteAlbum(prisma, admin, await ref(album.id));
    expect(await prisma.album.count()).toBe(0);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: a } })).status).toBe("APPROVED");
    expect(await prisma.auditLog.count({ where: { action: "album.delete", targetId: album.id } })).toBe(1);
  });
});
