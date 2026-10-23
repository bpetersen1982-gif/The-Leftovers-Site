import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { PhotoError } from "@/lib/photos/errors";
import { originalKey, parseStoredFiles, privateFileKey } from "@/lib/photos/files";
import { getBandPhotoBoard, getPublicPhoto, listPublicPhotos, publicImage } from "@/lib/photos/queries";
import { completeUpload, createUpload } from "@/lib/photos/upload";
import { approvePhotos, deleteUnpublishedPhoto, rejectPhotos, submitPhotos, updatePhotoDetails } from "@/lib/photos/workflow";
import { createTestStorage, resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

const sentEmails: { to: string; subject: string }[] = [];
vi.mock("@/lib/mail/mailer", () => ({
  sendEmail: async (message: { to: string; subject: string }) => {
    sentEmails.push({ to: message.to, subject: message.subject });
  },
}));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "http://localhost:3001" }) }));
const { runPhotoJobs } = await import("@/lib/jobs/photo-jobs");

const prisma = createTestClient();
const storage = createTestStorage();
const deps = { prisma, storage };

async function makeUser(role: Role, name = role === "ADMIN" ? "Erik Admin" : "Jim Member") {
  const user = await prisma.user.create({
    data: { id: randomUUID(), name, email: `${randomUUID()}@example.test`, role, emailVerified: true },
  });
  return { id: user.id, role };
}

let jpegCounter = 0;
/** A distinct, real JPEG each time. */
async function sampleJpeg(width = 1200, height = 800): Promise<Buffer> {
  jpegCounter += 1;
  return sharp({ create: { width, height, channels: 3, background: { r: (jpegCounter * 40) % 255, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

/** Runs the browser half: ask for a URL, PUT the bytes, report completion. */
async function upload(actor: { id: string; role: Role }, body: Buffer, filename = "IMG_0001.JPG", contentType = "image/jpeg") {
  const created = await createUpload(deps, actor, { filename, contentType, size: body.byteLength });
  const response = await fetch(created.upload.url, {
    method: "PUT",
    headers: created.upload.headers,
    body: new Uint8Array(body),
  });
  expect(response.status).toBe(200);
  const result = await completeUpload(deps, actor, created.photoId);
  return { photoId: created.photoId, result };
}

async function current(id: string) {
  return prisma.photo.findUniqueOrThrow({ where: { id } });
}

async function describeAndRef(actor: { id: string; role: Role }, id: string, altText = "Jim mid-solo under red lights") {
  const photo = await current(id);
  await updatePhotoDetails(deps, actor, { id, version: photo.version, altText, caption: "Bourbon Theatre", credit: "Jake" });
  const updated = await current(id);
  return { id, version: updated.version };
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
  sentEmails.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("upload and processing", () => {
  it("turns an upload into a private draft with variants and deletes the original", async () => {
    const member = await makeUser("MEMBER");
    const { photoId, result } = await upload(member, await sampleJpeg(3000, 2000), "C:\\fakepath\\IMG_4411.JPG");
    expect(result).toEqual({ status: "DRAFT", photoId });

    const photo = await current(photoId);
    expect(photo).toMatchObject({ status: "DRAFT", width: 3000, height: 2000, originalFilename: "IMG_4411.JPG" });
    expect(photo.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    const files = parseStoredFiles(photo.variants);
    expect(files.map((file) => file.file)).toEqual(["w480.webp", "w960.webp", "w1600.webp", "w2400.webp", "full.jpg"]);
    for (const file of files) {
      expect(await storage.headPrivate(privateFileKey(photoId, file.file))).toMatchObject({ size: file.bytes });
    }
    expect(await storage.headPrivate(originalKey(photoId))).toBeNull();
    // Nothing is public yet.
    expect(publicImage(storage, photo)).toBeNull();
  });

  it("is idempotent and only completes for the uploader", async () => {
    const member = await makeUser("MEMBER");
    const other = await makeUser("MEMBER", "Mike Member");
    const { photoId } = await upload(member, await sampleJpeg());
    const version = (await current(photoId)).version;
    await expect(completeUpload(deps, member, photoId)).resolves.toEqual({ status: "DRAFT", photoId });
    expect((await current(photoId)).version).toBe(version);
    await expect(completeUpload(deps, other, photoId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("processes a photo once when completion is sent twice at the same time", async () => {
    const member = await makeUser("MEMBER");
    const body = await sampleJpeg();
    const created = await createUpload(deps, member, { filename: "a.jpg", contentType: "image/jpeg", size: body.byteLength });
    await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: new Uint8Array(body) });
    const results = await Promise.all([completeUpload(deps, member, created.photoId), completeUpload(deps, member, created.photoId)]);
    expect(results.map((result) => result.status)).toEqual(["DRAFT", "DRAFT"]);
    // UPLOADING -> PROCESSING -> DRAFT: exactly two bumps, so it ran once.
    expect((await current(created.photoId)).version).toBe(3);
  });

  it("reports a missing upload and lets the same upload be retried", async () => {
    const member = await makeUser("MEMBER");
    const body = await sampleJpeg();
    const created = await createUpload(deps, member, { filename: "a.jpg", contentType: "image/jpeg", size: body.byteLength });
    await expect(completeUpload(deps, member, created.photoId)).rejects.toMatchObject({ code: "UPLOAD_MISSING" });
    expect((await current(created.photoId)).status).toBe("UPLOADING");
    await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: new Uint8Array(body) });
    await expect(completeUpload(deps, member, created.photoId)).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("fails a file whose contents don't match its type and removes it", async () => {
    const member = await makeUser("MEMBER");
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#123456" } }).png().toBuffer();
    const { photoId, result } = await upload(member, png, "sneaky.jpg", "image/jpeg");
    expect(result).toMatchObject({ status: "FAILED", reason: expect.stringMatching(/don't match/) });
    expect(await storage.headPrivate(originalKey(photoId))).toBeNull();
    expect((await current(photoId)).failureReason).toMatch(/don't match/);
  });

  it("validates the upload request before issuing a URL", async () => {
    const member = await makeUser("MEMBER");
    const attempt = (filename: string, contentType: string, size: number) => createUpload(deps, member, { filename, contentType, size });
    await expect(attempt("a.gif", "image/gif", 100)).rejects.toThrow(/JPEG, PNG, WebP, and HEIC/);
    await expect(attempt("a.png", "image/jpeg", 100)).rejects.toThrow(/doesn't match/);
    await expect(attempt("a.exe", "image/jpeg", 100)).rejects.toThrow(/\.jpg, \.png/);
    await expect(attempt("a.jpg", "image/jpeg", 26 * 1024 * 1024)).rejects.toThrow(/25 MB/);
    await expect(attempt("a.jpg", "image/jpeg", 0)).rejects.toThrow(/empty/);
    expect(await prisma.photo.count()).toBe(0);
  });

  it("rejects a PUT that doesn't match the signed size", async () => {
    const member = await makeUser("MEMBER");
    const created = await createUpload(deps, member, { filename: "a.jpg", contentType: "image/jpeg", size: 1000 });
    const response = await fetch(created.upload.url, { method: "PUT", headers: created.upload.headers, body: new Uint8Array(5000) });
    expect(response.ok).toBe(false);
  });
});

describe("review workflow", () => {
  it("publishes Admin uploads directly", async () => {
    const admin = await makeUser("ADMIN");
    const { photoId } = await upload(admin, await sampleJpeg());
    const ref = await describeAndRef(admin, photoId);
    expect(await submitPhotos(deps, admin, [ref])).toEqual([{ id: photoId, outcome: "done" }]);

    const photo = await current(photoId);
    expect(photo).toMatchObject({ status: "APPROVED", decidedById: admin.id, decidedByRole: "ADMIN" });
    expect(photo.publicPrefix).toMatch(new RegExp(`^photos/${photoId}/[a-f0-9]{24}$`));
    const image = publicImage(storage, photo);
    for (const url of [...(image?.sources.map((source) => source.url) ?? []), image?.jpeg?.url ?? ""]) {
      const response = await fetch(url);
      expect(response.status, url).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    }
    expect(await prisma.auditLog.count({ where: { action: "photo.publish", targetId: photoId } })).toBe(1);
  });

  it("sends Member uploads to review, where an Admin approves them", async () => {
    const member = await makeUser("MEMBER");
    const admin = await makeUser("ADMIN");
    const { photoId } = await upload(member, await sampleJpeg());
    const ref = await describeAndRef(member, photoId);
    expect(await submitPhotos(deps, member, [ref])).toEqual([{ id: photoId, outcome: "done" }]);
    const pending = await current(photoId);
    expect(pending.status).toBe("PENDING_REVIEW");
    expect(pending.publicPrefix).toBeNull();

    await expect(approvePhotos(deps, member, [{ id: photoId, version: pending.version }])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await approvePhotos(deps, admin, [{ id: photoId, version: pending.version }])).toEqual([{ id: photoId, outcome: "done" }]);
    expect(await current(photoId)).toMatchObject({ status: "APPROVED", decidedById: admin.id });
    expect(await prisma.auditLog.count({ where: { action: "photo.approve", targetId: photoId } })).toBe(1);
  });

  it("requires alt text before submitting", async () => {
    const member = await makeUser("MEMBER");
    const { photoId } = await upload(member, await sampleJpeg());
    const photo = await current(photoId);
    expect(await submitPhotos(deps, member, [{ id: photoId, version: photo.version }])).toEqual([{ id: photoId, outcome: "needsAltText" }]);
    expect((await current(photoId)).status).toBe("DRAFT");
  });

  it("lets only the first of two simultaneous approvals win, leaving one set of public files", async () => {
    const member = await makeUser("MEMBER");
    const erik = await makeUser("ADMIN");
    const brandon = await makeUser("ADMIN", "Brandon Admin");
    const { photoId } = await upload(member, await sampleJpeg());
    await submitPhotos(deps, member, [await describeAndRef(member, photoId)]);
    const version = (await current(photoId)).version;

    const outcomes = await Promise.all([
      approvePhotos(deps, erik, [{ id: photoId, version }]),
      approvePhotos(deps, brandon, [{ id: photoId, version }]),
    ]);
    expect(outcomes.map((result) => result[0]?.outcome).sort()).toEqual(["conflict", "done"]);
    expect(await prisma.auditLog.count({ where: { action: "photo.approve" } })).toBe(1);
    const photo = await current(photoId);
    expect(photo.status).toBe("APPROVED");
    const winnerUrl = publicImage(storage, photo)?.src ?? "";
    expect((await fetch(winnerUrl)).status).toBe(200);
  });

  it("rejects with a reason; the uploader can fix and resubmit", async () => {
    const member = await makeUser("MEMBER");
    const admin = await makeUser("ADMIN");
    const { photoId } = await upload(member, await sampleJpeg());
    await submitPhotos(deps, member, [await describeAndRef(member, photoId)]);
    const pending = await current(photoId);

    expect(await rejectPhotos(deps, admin, [{ id: photoId, version: pending.version }], "  Blurry —  try another  ")).toEqual([
      { id: photoId, outcome: "done" },
    ]);
    expect(await current(photoId)).toMatchObject({ status: "REJECTED", rejectionReason: "Blurry — try another", decidedById: admin.id });
    // Stale second click.
    expect(await rejectPhotos(deps, admin, [{ id: photoId, version: pending.version }], "")).toEqual([{ id: photoId, outcome: "conflict" }]);

    const ref = await describeAndRef(member, photoId, "Better description");
    expect(await submitPhotos(deps, member, [ref])).toEqual([{ id: photoId, outcome: "done" }]);
    expect(await current(photoId)).toMatchObject({ status: "PENDING_REVIEW", rejectionReason: null });
  });

  it("enforces who can edit details", async () => {
    const member = await makeUser("MEMBER");
    const other = await makeUser("MEMBER", "Mike Member");
    const admin = await makeUser("ADMIN");
    const { photoId } = await upload(member, await sampleJpeg());
    const draft = await current(photoId);
    const details = { altText: "x", caption: "", credit: "" };
    await expect(updatePhotoDetails(deps, other, { id: photoId, version: draft.version, ...details })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await submitPhotos(deps, member, [await describeAndRef(member, photoId)]);
    let pending = await current(photoId);
    await expect(updatePhotoDetails(deps, member, { id: photoId, version: pending.version, ...details, altText: "  " })).rejects.toMatchObject({
      code: "ALT_TEXT_REQUIRED",
    });
    await approvePhotos(deps, admin, [{ id: photoId, version: pending.version }]);
    pending = await current(photoId);
    await expect(updatePhotoDetails(deps, member, { id: photoId, version: pending.version, ...details })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updatePhotoDetails(deps, admin, { id: photoId, version: pending.version, altText: "Erik's fix", caption: "", credit: "" });
    expect((await current(photoId)).altText).toBe("Erik's fix");
    await expect(updatePhotoDetails(deps, admin, { id: photoId, version: pending.version, ...details })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("deleting unpublished photos", () => {
  it("lets Members delete their own pending photos, files included", async () => {
    const member = await makeUser("MEMBER");
    const other = await makeUser("MEMBER", "Mike Member");
    const { photoId } = await upload(member, await sampleJpeg());
    await submitPhotos(deps, member, [await describeAndRef(member, photoId)]);
    const photo = await current(photoId);
    const files = parseStoredFiles(photo.variants);

    await expect(deleteUnpublishedPhoto(deps, other, { id: photoId, version: photo.version })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteUnpublishedPhoto(deps, member, { id: photoId, version: photo.version });
    expect(await prisma.photo.findUnique({ where: { id: photoId } })).toBeNull();
    for (const file of files) expect(await storage.headPrivate(privateFileKey(photoId, file.file))).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "photo.delete", targetId: photoId } })).toBe(1);
  });

  it("refuses to delete published photos this way", async () => {
    const admin = await makeUser("ADMIN");
    const { photoId } = await upload(admin, await sampleJpeg());
    await submitPhotos(deps, admin, [await describeAndRef(admin, photoId)]);
    const photo = await current(photoId);
    await expect(deleteUnpublishedPhoto(deps, admin, { id: photoId, version: photo.version })).rejects.toBeInstanceOf(PhotoError);
    expect((await current(photoId)).status).toBe("APPROVED");
  });
});

describe("photo queries", () => {
  it("shows Members their own pending photos and Admins everyone's; the public sees only approved", async () => {
    const member = await makeUser("MEMBER");
    const other = await makeUser("MEMBER", "Mike Member");
    const admin = await makeUser("ADMIN");
    const mine = await upload(member, await sampleJpeg());
    await submitPhotos(deps, member, [await describeAndRef(member, mine.photoId)]);
    const theirs = await upload(other, await sampleJpeg());
    await submitPhotos(deps, other, [await describeAndRef(other, theirs.photoId)]);
    const published = await upload(admin, await sampleJpeg());
    await submitPhotos(deps, admin, [await describeAndRef(admin, published.photoId, "The whole band")]);
    const draft = await upload(member, await sampleJpeg());

    const memberBoard = await getBandPhotoBoard(prisma, storage, member);
    expect(memberBoard.mine.map((photo) => photo.id)).toEqual([draft.photoId]);
    expect(memberBoard.pending.map((photo) => photo.id)).toEqual([mine.photoId]);
    expect(memberBoard.published.map((photo) => photo.id)).toEqual([published.photoId]);
    // Private previews are signed and actually load.
    const preview = memberBoard.mine[0]?.image?.sources[0]?.url ?? "";
    expect(preview).toContain("X-Amz-Signature=");
    expect((await fetch(preview)).status).toBe(200);

    const adminBoard = await getBandPhotoBoard(prisma, storage, admin);
    expect(adminBoard.pending.map((photo) => photo.id).sort()).toEqual([mine.photoId, theirs.photoId].sort());
    expect(adminBoard.mine).toEqual([]);

    const gallery = await listPublicPhotos(prisma, storage, 1);
    expect(gallery).toMatchObject({ total: 1, pageCount: 1 });
    expect(gallery.photos.map((photo) => [photo.id, photo.altText])).toEqual([[published.photoId, "The whole band"]]);
    expect(await getPublicPhoto(prisma, storage, mine.photoId)).toBeNull();
    expect(await getPublicPhoto(prisma, storage, published.photoId)).toMatchObject({ newerId: null, olderId: null });
  });
});

describe("photo jobs", () => {
  const NOW = new Date("2026-10-23T16:00:00Z"); // 11:00 in Lincoln

  it("cleans up abandoned and stuck uploads", async () => {
    const member = await makeUser("MEMBER");
    const abandoned = await createUpload(deps, member, { filename: "a.jpg", contentType: "image/jpeg", size: 100 });
    await fetch(abandoned.upload.url, { method: "PUT", headers: abandoned.upload.headers, body: new Uint8Array(100) });
    const stuck = await createUpload(deps, member, { filename: "b.jpg", contentType: "image/jpeg", size: 100 });
    const fresh = await createUpload(deps, member, { filename: "c.jpg", contentType: "image/jpeg", size: 100 });
    await prisma.photo.update({ where: { id: abandoned.photoId }, data: { uploadExpiresAt: new Date(NOW.getTime() - 2 * 3_600_000) } });
    await prisma.$executeRaw`UPDATE "photo" SET "status" = 'PROCESSING', "updatedAt" = ${new Date(NOW.getTime() - 20 * 60_000)} WHERE "id" = ${stuck.photoId}::uuid`;
    await prisma.photo.update({ where: { id: fresh.photoId }, data: { uploadExpiresAt: new Date(NOW.getTime() + 60_000) } });

    const result = await runPhotoJobs(prisma, storage, NOW);
    expect(result).toMatchObject({ ran: true, abandonedRemoved: 1, stuckFailed: 1 });
    expect(await prisma.photo.findUnique({ where: { id: abandoned.photoId } })).toBeNull();
    expect(await storage.headPrivate(originalKey(abandoned.photoId))).toBeNull();
    expect((await current(stuck.photoId)).status).toBe("FAILED");
    expect((await current(fresh.photoId)).status).toBe("UPLOADING");
  });

  it("emails Admins a review digest once a day, only after 9am and only when something waits", async () => {
    const member = await makeUser("MEMBER");
    const admin = await makeUser("ADMIN");
    const early = new Date("2026-10-23T12:00:00Z"); // 07:00 in Lincoln
    expect((await runPhotoJobs(prisma, storage, NOW)).digestsSent).toBe(0); // nothing pending

    const { photoId } = await upload(member, await sampleJpeg());
    await submitPhotos(deps, member, [await describeAndRef(member, photoId)]);
    const nextDay = new Date(NOW.getTime() + 24 * 3_600_000);
    expect((await runPhotoJobs(prisma, storage, new Date(early.getTime() + 24 * 3_600_000))).digestsSent).toBe(0);
    expect((await runPhotoJobs(prisma, storage, nextDay)).digestsSent).toBe(1);
    expect((await runPhotoJobs(prisma, storage, new Date(nextDay.getTime() + 3_600_000))).digestsSent).toBe(0);
    const adminEmail = (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).email;
    expect(sentEmails).toEqual([{ to: adminEmail, subject: "1 photo to review: The Leftovers" }]);
  });
});
