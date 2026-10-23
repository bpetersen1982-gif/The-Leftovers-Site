import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox } from "../support/mailpit";
import { resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jim@example.test", name: "Jim Test" };
const HEIC = readFileSync(new URL("../fixtures/photos/sample.heic", import.meta.url));

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
  await prisma.user.create({ data: { id: randomUUID(), name: MEMBER.name, email: MEMBER.email, role: "MEMBER", emailVerified: true } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Fails the test on any CSP violation (e.g. storage origins missing from img-src/connect-src). */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginByEmail(page, email);
  return page;
}

async function jpeg(): Promise<Buffer> {
  // Includes GPS EXIF, which must never reach the public file.
  return sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#7a2a2a" } })
    .withExif({ IFD0: { Make: "LeakyCam" } })
    .jpeg()
    .toBuffer();
}

async function expectImageLoaded(page: Page, alt: string): Promise<string> {
  const image = page.getByRole("img", { name: alt });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return image.evaluate((element: HTMLImageElement) => element.currentSrc);
}

test("a member's photo goes through review and appears on the public page", async ({ browser, page: anonymous }) => {
  const member = await signedInPage(browser, MEMBER.email);
  const memberCsp = watchCsp(member);
  await member.goto("/admin/photos");
  await member.getByLabel("Choose photos").setInputFiles({ name: "IMG_2001.JPG", mimeType: "image/jpeg", buffer: await jpeg() });
  await expect(member.getByText("Ready below")).toBeVisible({ timeout: 30_000 });
  await expect(member.getByRole("status").filter({ hasText: "1 uploaded" })).toBeVisible();

  const card = member.getByRole("article", { name: "IMG_2001.JPG" });
  await expect(card.getByRole("img")).toBeVisible();
  await card.getByRole("button", { name: "Save and send for review" }).click();
  await expect(card.getByText("Describe the photo in a few words (required).")).toBeVisible();
  await card.getByLabel("Alt text (required)").fill("Jim singing under red lights");
  await card.getByLabel("Photo credit").fill("Jake");
  await card.getByRole("button", { name: "Save and send for review" }).click();
  await expect(member.getByRole("heading", { name: "Waiting for an Admin (1)" })).toBeVisible();
  expect(memberCsp).toEqual([]);

  await anonymous.goto("/photos");
  await expect(anonymous.getByText("Photos from our shows are coming soon.")).toBeVisible();

  const admin = await signedInPage(browser, ADMIN.email);
  await admin.goto("/admin/photos");
  await expect(admin.getByRole("heading", { name: "Waiting for review (1)" })).toBeVisible();
  await admin.getByLabel(`Select photo from ${MEMBER.name}`).check();
  await admin.getByRole("button", { name: "Approve selected" }).click();
  await expect(admin.getByText("Approved 1 photo.")).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Published (1)" })).toBeVisible();

  const publicCsp = watchCsp(anonymous);
  await anonymous.goto("/photos");
  const src = await expectImageLoaded(anonymous, "Jim singing under red lights");
  const response = await anonymous.request.get(src);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect((await response.body()).includes(Buffer.from("LeakyCam"))).toBe(false);

  await anonymous.getByRole("link", { name: "Jim singing under red lights" }).click();
  await expect(anonymous).toHaveURL(/\/photos\/[0-9a-f-]{36}$/);
  await expectImageLoaded(anonymous, "Jim singing under red lights");
  await expect(anonymous.getByText("Photo: Jake")).toBeVisible();
  expect(publicCsp).toEqual([]);
});

test("an admin publishes an iPhone HEIC photo directly, and a member can delete their own pending photo", async ({ browser, page: anonymous }) => {
  const admin = await signedInPage(browser, ADMIN.email);
  await admin.goto("/admin/photos");
  await admin.getByLabel("Choose photos").setInputFiles({ name: "IMG_3001.HEIC", mimeType: "image/heic", buffer: HEIC });
  await expect(admin.getByText("Ready below")).toBeVisible({ timeout: 30_000 });
  const card = admin.getByRole("article", { name: "IMG_3001.HEIC" });
  await card.getByLabel("Alt text (required)").fill("The band on stage at the Zoo Bar");
  await card.getByRole("button", { name: "Save and publish" }).click();
  await expect(admin.getByRole("heading", { name: "Published (1)" })).toBeVisible();

  await anonymous.goto("/photos");
  await expectImageLoaded(anonymous, "The band on stage at the Zoo Bar");

  const member = await signedInPage(browser, MEMBER.email);
  await member.goto("/admin/photos");
  await member.getByLabel("Choose photos").setInputFiles({ name: "oops.jpg", mimeType: "image/jpeg", buffer: await jpeg() });
  await expect(member.getByText("Ready below")).toBeVisible({ timeout: 30_000 });
  const mine = member.getByRole("article", { name: "oops.jpg" });
  await mine.getByLabel("Alt text (required)").fill("Blurry");
  await mine.getByRole("button", { name: "Save and send for review" }).click();
  await expect(member.getByRole("heading", { name: "Waiting for an Admin (1)" })).toBeVisible();
  member.once("dialog", (dialog) => void dialog.accept());
  await member.getByRole("article", { name: "oops.jpg" }).getByRole("button", { name: "Delete oops.jpg" }).click();
  await expect(member.getByRole("heading", { name: "Waiting for an Admin (0)" })).toBeVisible();
  // Members can't edit or remove published photos from here.
  await expect(member.getByRole("article", { name: "The band on stage at the Zoo Bar" }).getByText("Edit details")).toHaveCount(0);
});

test("files that aren't photos are refused", async ({ browser }) => {
  const member = await signedInPage(browser, MEMBER.email);
  await member.goto("/admin/photos");
  await member.getByLabel("Choose photos").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script></html>") },
  ]);
  await expect(member.getByText("Not a JPEG, PNG, WebP, or HEIC photo.")).toBeVisible();
  const failed = member.getByRole("article", { name: "fake.jpg" });
  await expect(failed.getByRole("alert")).toHaveText("This file isn't a JPEG, PNG, WebP, or HEIC photo.", { timeout: 30_000 });
  member.once("dialog", (dialog) => void dialog.accept());
  await failed.getByRole("button", { name: "Remove fake.jpg" }).click();
  await expect(member.getByRole("heading", { name: "Your unpublished photos (0)" })).toBeVisible();
});
