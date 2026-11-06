import { randomUUID } from "node:crypto";
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

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await loginByEmail(page, email);
  return page;
}

/** Fills the form, waits for the (test-key) spam check, and posts. */
async function post(page: Page, fields: { name: string; message: string; email?: string }) {
  const form = page.getByRole("form", { name: "Post on the Fan Wall" });
  await form.getByLabel("Your name").fill(fields.name);
  if (fields.email) await form.getByLabel("Email (optional, never shown)").fill(fields.email);
  await form.getByLabel("Message", { exact: true }).fill(fields.message);
  await expect(form.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 });
  await page.waitForTimeout(3_100);
  await form.getByRole("button", { name: "Post" }).click();
}

test("a fan posts with a photo; a band member approves it; the email never shows", async ({ page: fan, browser }) => {
  const csp = watchCsp(fan);
  await fan.goto("/fan-wall");
  await expect(fan.getByText("No posts yet. Be the first.")).toBeVisible();
  const form = fan.getByRole("form", { name: "Post on the Fan Wall" });
  // Links are refused (server side, too).
  await post(fan, { name: "Kelsey", message: "Get cheap tickets at scam.shop" });
  await expect(form.getByText("Messages can't include links or web addresses.")).toBeVisible();

  const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#335577" } }).jpeg().toBuffer();
  await form.getByLabel("Photo (optional, up to 10 MB)").setInputFiles({ name: "crowd.jpg", mimeType: "image/jpeg", buffer: photo });
  await form.getByLabel("Describe the photo (optional)").fill("Crowd with hands up");
  await form.getByLabel("I took this photo, and The Leftovers can show it on this site.").check();
  await post(fan, { name: "Kelsey", message: "Best night!\nPlay Everlong again.", email: "kelsey@example.test" });
  await expect(form.getByText("Thanks! A band member will read it soon.")).toBeVisible({ timeout: 30_000 });
  await fan.reload();
  await expect(fan.getByText("Best night!")).toHaveCount(0);
  expect(csp).toEqual([]);

  const jim = await signedIn(browser, MEMBER.email);
  await jim.goto("/admin/fan-wall");
  await expect(jim.getByRole("heading", { name: "Waiting for review (1)" })).toBeVisible();
  await expect(jim.getByRole("link", { name: "kelsey@example.test" })).toBeVisible();
  await jim.getByLabel("Select post from Kelsey").check();
  await jim.getByRole("button", { name: "Approve selected" }).click();
  await expect(jim.getByText("Approved 1 post.")).toBeVisible();

  await fan.reload();
  const card = fan.getByRole("article", { name: "From Kelsey" });
  await expect(card.getByText("Play Everlong again.")).toBeVisible();
  const image = card.getByRole("img", { name: "Crowd with hands up" });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(await fan.content()).not.toContain("kelsey@example.test");
});

test("an admin's decision is final; a member's can be overridden", async ({ page: fan, browser }) => {
  await fan.goto("/fan-wall");
  await post(fan, { name: "Sam", message: "You guys rock" });
  await expect(fan.getByText("Thanks! A band member will read it soon.")).toBeVisible({ timeout: 30_000 });

  const jim = await signedIn(browser, MEMBER.email);
  await jim.goto("/admin/fan-wall");
  await jim.getByLabel("Select post from Sam").check();
  await jim.getByRole("button", { name: "Reject selected" }).click();
  await expect(jim.getByText("Rejected 1 post.")).toBeVisible();

  const erik = await signedIn(browser, ADMIN.email);
  await erik.goto("/admin/fan-wall?show=members");
  await expect(erik.getByRole("heading", { name: "Recent band member decisions (1)" })).toBeVisible();
  await expect(erik.getByText(`Rejected by ${MEMBER.name} (Band Member)`)).toBeVisible();
  await erik.getByLabel("Reason (optional)").fill("Harmless, it's fine");
  await erik.getByRole("button", { name: "Override: Approve post from Sam" }).click();
  // It leaves the "band members' decisions" view once an Admin has decided it.
  await expect(erik.getByRole("heading", { name: "Recent band member decisions (0)" })).toBeVisible();
  await erik.goto("/admin/fan-wall");
  await expect(erik.getByText(`Approved by ${ADMIN.name} (Admin)`)).toBeVisible();
  await expect(erik.getByText("Reason: Harmless, it's fine")).toBeVisible();

  await jim.reload();
  await expect(jim.getByText("An Admin made this call, so only an Admin can change it.")).toBeVisible();
  await fan.reload();
  await expect(fan.getByText("You guys rock")).toBeVisible();
});
