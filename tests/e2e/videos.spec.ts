import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { bootstrapAdmin } from "@/lib/users/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ORIGIN = "https://customer-testcode123.cloudflarestream.com";

test.beforeEach(async () => {
  await resetDatabase(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function publishedVideo(title: string, status: "PUBLISHED" | "READY" = "PUBLISHED") {
  const admin = await bootstrapAdmin(prisma, { email: `${randomUUID()}@example.test`, name: "Erik Test" });
  const uid = randomBytes(16).toString("hex");
  const video = await prisma.video.create({
    data: {
      streamUid: uid,
      status,
      uploaderId: admin.userId,
      originalFilename: "clip.mov",
      sizeBytes: 1000n,
      uploadExpiresAt: new Date(),
      durationSeconds: 95,
      playbackOrigin: ORIGIN,
      title,
      posterSeconds: 7,
      captionsLanguage: "en",
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      streamPublic: status === "PUBLISHED",
    },
  });
  return { id: video.id, uid };
}

test("the public videos page shows a poster first and loads the player only on play", async ({ page }) => {
  const { id, uid } = await publishedVideo("Mr. Brightside (Zoo Bar)");
  await publishedVideo("Unpublished draft", "READY");
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  await page.goto("/videos");
  await expect(page.getByRole("heading", { level: 2, name: "Mr. Brightside (Zoo Bar)" })).toBeVisible();
  await expect(page.getByText("Unpublished draft")).toHaveCount(0);
  await expect(page.getByText("1:35")).toBeVisible();
  // No player (and no autoplay) until the visitor asks.
  await expect(page.locator("iframe")).toHaveCount(0);
  const poster = await page.locator("main img").first().getAttribute("src");
  expect(poster).toBe(`${ORIGIN}/${uid}/thumbnails/thumbnail.jpg?time=7s&height=720`);

  await page.getByRole("button", { name: "Play video: Mr. Brightside (Zoo Bar)" }).click();
  const frame = page.locator("iframe[title='Mr. Brightside (Zoo Bar)']");
  await expect(frame).toHaveCount(1);
  const src = new URL((await frame.getAttribute("src")) ?? "");
  expect(src.origin + src.pathname).toBe(`${ORIGIN}/${uid}/iframe`);
  expect(src.searchParams.get("defaultTextTrack")).toBe("en");
  expect(violations).toEqual([]);

  await page.goto(`/videos/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Mr. Brightside (Zoo Bar)" })).toBeVisible();
  const draftResponse = await page.goto(`/videos/${randomUUID()}`);
  expect(draftResponse?.status()).toBe(404);
});

/** Node's http client, because fetch() won't let a test set the Host header. */
function getWithHost(path: string, host: string): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: 3001, path, headers: { host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location });
    });
    req.on("error", reject);
    req.end();
  });
}

test("www redirects permanently to the main address, keeping the path", async () => {
  expect(await getWithHost("/photos?page=2", "www.theleftoversband.com")).toEqual({
    status: 308,
    location: "https://theleftoversband.com/photos?page=2",
  });
  expect((await getWithHost("/photos", "localhost:3001")).status).toBe(200);
});

test("the sitemap lists public albums and the videos page", async ({ request }) => {
  const admin = await bootstrapAdmin(prisma, { email: "admin@example.test", name: "Erik Test" });
  const photo = await prisma.photo.create({
    data: {
      status: "APPROVED",
      uploaderId: admin.userId,
      originalFilename: "a.jpg",
      declaredType: "image/jpeg",
      declaredSize: 1,
      originalKey: `originals/${randomUUID()}`,
      uploadExpiresAt: new Date(),
      altText: "x",
      publishedAt: new Date(),
    },
  });
  const shown = await prisma.album.create({ data: { slug: "zoo-bar-oct-2026", title: "Zoo Bar", isPublic: true, createdById: admin.userId } });
  const hidden = await prisma.album.create({ data: { slug: "rehearsal", title: "Rehearsal", isPublic: false, createdById: admin.userId } });
  await prisma.albumItem.createMany({ data: [shown, hidden].map((album) => ({ albumId: album.id, photoId: photo.id, sortOrder: 1 })) });

  const body = await (await request.get("/sitemap.xml")).text();
  expect(body).toContain("https://theleftoversband.com/videos");
  expect(body).toContain("https://theleftoversband.com/photos/albums/zoo-bar-oct-2026");
  expect(body).not.toContain("rehearsal");
});
