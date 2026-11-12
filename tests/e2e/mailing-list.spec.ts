import { expect, test } from "@playwright/test";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox, waitForLink, waitForLinkContaining } from "../support/mailpit";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a fan signs up, confirms by email, an admin exports the list, and the fan leaves", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get show emails" }).click();
  const form = page.getByRole("form", { name: "Join the mailing list" });
  await form.getByLabel("Email").fill("fan@example.test");
  await expect(form.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 });
  await page.waitForTimeout(2_100);
  await form.getByRole("button", { name: "Sign me up" }).click();
  await expect(page.getByText("Check your inbox for a confirmation email.")).toBeVisible();

  // Opening the link alone doesn't subscribe (email scanners open links); the button does.
  await page.goto(await waitForLink("fan@example.test", "Confirm you want"));
  expect(await prisma.subscriber.count({ where: { status: "CONFIRMED" } })).toBe(0);
  await page.getByRole("button", { name: "Yes, sign me up" }).click();
  await expect(page.getByText("You're on the list. Thanks!")).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await loginByEmail(admin, ADMIN.email);
  await admin.goto("/admin/mailing-list");
  await expect(admin.getByText("1 confirmed subscriber.")).toBeVisible();
  const download = await admin.request.get("/admin/mailing-list/export");
  expect(download.headers()["content-type"]).toContain("text/csv");
  expect(await download.text()).toMatch(/^email,confirmed_at\r\nfan@example\.test,20/);
  const anonymous = await (await browser.newContext()).request.get("/admin/mailing-list/export");
  expect(anonymous.status()).toBe(401);

  await page.goto(await waitForLinkContaining("fan@example.test", "Confirm you want", "/unsubscribe"));
  await page.getByRole("button", { name: "Remove me from the list" }).click();
  await expect(page.getByText("You're off the list. Your email has been deleted.")).toBeVisible();
  expect(await prisma.subscriber.count()).toBe(0);
});
