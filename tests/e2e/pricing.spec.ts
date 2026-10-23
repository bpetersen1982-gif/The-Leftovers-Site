import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox } from "../support/mailpit";
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

test("admin sets rates and rules; blanks stay quote-only; radius preview follows the setting", async ({ page }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/pricing");
  await expect(page.getByText("No rates are set.")).toBeVisible();
  await expect(page.getByText(/Columbus: 57 mi · instant quote/)).toBeVisible();

  await page.getByLabel("Wedding, Fri–Sat, dollars per set").fill("1200");
  await page.getByLabel("Bar / club, Fri–Sat, dollars per set").fill("$400");
  await page.getByLabel("Travel radius (miles)").fill("55");
  await page.getByRole("button", { name: "Save pricing" }).click();
  await expect(page.getByText("Saved. 2 event/day combinations now show an instant quote.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Wedding, Fri–Sat, dollars per set")).toHaveValue("1200");
  await expect(page.getByLabel("Wedding, Sun–Thu, dollars per set")).toHaveValue("");
  await expect(page.getByText(/Columbus: 57 mi · contact path/)).toBeVisible();
  await expect(page.getByText("Other")).toBeVisible();
  await expect(page.getByText("Always a quote").first()).toBeVisible();

  const rate = await prisma.rateRule.findUniqueOrThrow({ where: { eventType_dayCategory: { eventType: "WEDDING", dayCategory: "FRI_SAT" } } });
  expect(rate.ratePerSetCents).toBe(120_000);
});

test("validation errors point at the right field", async ({ page }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/pricing");
  await page.getByLabel("Wedding, Fri–Sat, dollars per set").fill("12.50");
  await page.getByLabel("Measured from ZIP").fill("00000");
  await page.getByLabel("Minimum sets").fill("5");
  await page.getByRole("button", { name: "Save pricing" }).click();
  await expect(page.getByText("Whole dollars only (e.g. 400)")).toBeVisible();
  await expect(page.getByText("Maximum sets can't be less than minimum")).toBeVisible();
  expect(await prisma.rateRule.count()).toBe(0);
  // What the Admin typed is still there after a validation error.
  await expect(page.getByLabel("Measured from ZIP")).toHaveValue("00000");
  await expect(page.getByLabel("Wedding, Fri–Sat, dollars per set")).toHaveValue("12.50");

  await page.getByLabel("Wedding, Fri–Sat, dollars per set").fill("1000");
  await page.getByLabel("Minimum sets").fill("1");
  await page.getByRole("button", { name: "Save pricing" }).click();
  await expect(page.getByText("That ZIP code isn't in our ZIP table")).toBeVisible();
});

test("special dates and clearing all rates", async ({ page }) => {
  await prisma.rateRule.create({ data: { eventType: "WEDDING", dayCategory: "FRI_SAT", ratePerSetCents: 100_000 } });
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/pricing");

  await page.getByLabel("Date", { exact: true }).fill("2027-12-31");
  await page.getByLabel("Name", { exact: true }).fill("New Year's Eve");
  await page.getByRole("button", { name: "Add date" }).click();
  await expect(page.getByText("Added New Year's Eve.")).toBeVisible();
  await expect(page.getByText("Friday, December 31, 2027")).toBeVisible();
  await page.getByRole("button", { name: "Add date" }).click();
  await expect(page.getByText("Enter a valid date")).toBeVisible();

  await page.getByRole("region", { name: "Stop showing prices" }).getByLabel("Confirm").check();
  await page.getByRole("button", { name: "Clear all rates" }).click();
  await expect(page.getByText("Cleared 1 rate. No prices show publicly now.")).toBeVisible();
  expect(await prisma.rateRule.count()).toBe(0);
});

test("band members can't see or change pricing", async ({ page }) => {
  await prisma.user.create({ data: { id: randomUUID(), email: "jake@example.test", name: "Jake Test", role: "MEMBER", emailVerified: true } });
  await loginByEmail(page, "jake@example.test");
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Pricing" })).toHaveCount(0);
  await page.goto("/admin/pricing");
  await expect(page.getByRole("heading", { name: "Not allowed" })).toBeVisible();
});
