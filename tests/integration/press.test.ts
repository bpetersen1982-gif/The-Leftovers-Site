import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { getPressKit } from "@/lib/press/queries";
import { completePressUpload, deletePressFile, listPressFiles, setPressPhotos, startPressUpload } from "@/lib/press/service";
import { createTestStorage, resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const storage = createTestStorage();
const deps = { prisma, storage };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function makeUser(role: Role) {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: role, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role };
}

async function upload(actor: { id: string; role: Role }, kind: string, filename: string, contentType: string, body: Buffer) {
  const started = await startPressUpload(deps, actor, { kind, filename, contentType, size: body.byteLength });
  const put = await fetch(started.upload.url, { method: "PUT", headers: started.upload.headers, body: new Uint8Array(body) });
  expect(put.status).toBe(200);
  await completePressUpload(deps, actor, { kind, uploadId: started.uploadId });
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("press files", () => {
  it("accepts a real PDF and logo, serves them as downloads, and replacing deletes the old file", async () => {
    const admin = await makeUser("ADMIN");
    await upload(admin, "RIDER", "Our Rider v2.pdf", "application/pdf", PDF);
    const first = (await listPressFiles(prisma, storage)).RIDER;
    const response = await fetch(first?.url ?? "");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="the-leftovers-tech-rider.pdf"');

    await upload(admin, "RIDER", "rider-v3.pdf", "application/pdf", Buffer.concat([PDF, Buffer.from("% v3\n")]));
    const second = (await listPressFiles(prisma, storage)).RIDER;
    expect(second?.url).not.toBe(first?.url);
    expect((await fetch(first?.url ?? "")).ok).toBe(false);

    const logo = await sharp({ create: { width: 2400, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    await upload(admin, "LOGO", "logo.png", "image/png", logo);
    expect((await listPressFiles(prisma, storage)).LOGO).toMatchObject({ width: 2400, height: 1200 });

    await deletePressFile(deps, admin, "RIDER");
    expect((await listPressFiles(prisma, storage)).RIDER).toBeUndefined();
    expect((await fetch(second?.url ?? "")).ok).toBe(false);
  });

  it("checks files by their contents and limits who can upload", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await expect(startPressUpload(deps, member, { kind: "RIDER", filename: "r.pdf", contentType: "application/pdf", size: 10 })).rejects.toThrow(/Only Admins/);
    await expect(startPressUpload(deps, admin, { kind: "RIDER", filename: "r.docx", contentType: "application/pdf", size: 10 })).rejects.toThrow(/PDF/);
    await expect(startPressUpload(deps, admin, { kind: "LOGO", filename: "l.gif", contentType: "image/gif", size: 10 })).rejects.toThrow(/PNG or JPEG/);
    await expect(upload(admin, "RIDER", "fake.pdf", "application/pdf", Buffer.from("<html><script>x</script></html>"))).rejects.toThrow(/isn't a PDF/);
    await expect(upload(admin, "LOGO", "fake.png", "image/png", PDF)).rejects.toThrow(/isn't a PNG or JPEG/);
    expect(await prisma.pressFile.count()).toBe(0);
  });
});

describe("press kit contents", () => {
  it("shows only chosen photos that are still published, and starts empty", async () => {
    const admin = await makeUser("ADMIN");
    const empty = await getPressKit(prisma, storage);
    expect(empty).toMatchObject({ shortBio: [], longBio: [], rider: [], photos: [], videos: [], songs: [] });

    const photo = (status: "APPROVED" | "DRAFT") =>
      prisma.photo.create({
        data: { status, uploaderId: admin.id, originalFilename: "a.jpg", declaredType: "image/jpeg", declaredSize: 1, originalKey: `originals/${randomUUID()}`, uploadExpiresAt: new Date(), altText: "x" },
      });
    const [published, draft] = [await photo("APPROVED"), await photo("DRAFT")];
    expect(await setPressPhotos(prisma, admin, [published.id, draft.id])).toBe(1);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: draft.id } })).isPressPhoto).toBe(false);
    expect(await setPressPhotos(prisma, admin, [])).toBe(0);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: published.id } })).isPressPhoto).toBe(false);
    await expect(setPressPhotos(prisma, admin, Array.from({ length: 25 }, () => randomUUID()))).rejects.toThrow(/up to 24/);
  });
});
