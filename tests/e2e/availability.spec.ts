import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, formatLongDate, monthOf, todayInBandTimeZone } from "@/lib/dates";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox } from "../support/mailpit";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jake@example.test", name: "Jake Test" };

const today = todayInBandTimeZone();
const outDay = addDays(today, 10);
const bandOffDay = addDays(today, 12);

/** The public calendar cell for a date, found by its accessible label. */
const dayCell = (page: import("@playwright/test").Page, date: string) =>
  page.getByLabel(new RegExp(`^${formatLongDate(date)}: `));

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
  await prisma.user.create({ data: { id: randomUUID(), email: MEMBER.email, name: MEMBER.name, role: "MEMBER", emailVerified: true } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a member's out-of-office day shows as Limited publicly, without their name or note", async ({ page, browser }) => {
  await loginByEmail(page, MEMBER.email);
  await page.goto("/admin/availability");
  // Members only manage their own dates: no band-wide option, no person picker.
  await expect(page.getByLabel("Whole band is unavailable")).toHaveCount(0);
  await expect(page.getByLabel("Person", { exact: true })).toHaveCount(0);

  await page.getByLabel("First day").fill(outDay);
  await page.getByLabel(/Private note/).fill("Sister's graduation");
  await page.getByRole("button", { name: "Add dates" }).click();
  await expect(page.getByText("Out-of-office dates added.")).toBeVisible();
  await expect(page.getByText("Note: Sister's graduation")).toBeVisible();

  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(`/book?month=${monthOf(outDay)}`);
  await expect(dayCell(publicPage, outDay)).toHaveAccessibleName(`${formatLongDate(outDay)}: Limited availability. Request this date.`);
  await expect(dayCell(publicPage, outDay)).toHaveAttribute("href", `/book/request?date=${outDay}`);
  await expect(publicPage.getByText(MEMBER.name)).toHaveCount(0);
  await expect(publicPage.getByText("Sister's graduation")).toHaveCount(0);
  await visitor.close();
});

test("an Admin can mark the whole band off; that date can't be requested", async ({ page }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/availability");
  await page.getByLabel("Whole band is unavailable").check();
  await expect(page.getByLabel("Person", { exact: true })).toHaveCount(0);
  await page.getByLabel("First day").fill(bandOffDay);
  await page.getByRole("button", { name: "Add dates" }).click();
  await expect(page.getByText("Band marked unavailable.")).toBeVisible();

  await page.goto(`/book?month=${monthOf(bandOffDay)}`);
  const cell = dayCell(page, bandOffDay);
  await expect(cell).toHaveAccessibleName(`${formatLongDate(bandOffDay)}: Unavailable`);
  expect(await cell.evaluate((element) => element.tagName)).toBe("SPAN");
});

test("members see each other's dates but can only remove their own; Admins can remove any", async ({ page, browser }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  await prisma.availabilityBlock.create({
    data: { scope: "MEMBER", userId: admin.id, startDate: new Date(`${outDay}T00:00:00Z`), endDate: new Date(`${outDay}T00:00:00Z`), note: "Private", createdById: admin.id },
  });

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await loginByEmail(memberPage, MEMBER.email);
  await memberPage.goto("/admin/availability");
  await expect(memberPage.getByText(ADMIN.name)).toBeVisible();
  await expect(memberPage.getByText("Note: Private")).toHaveCount(0);
  await expect(memberPage.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await memberContext.close();

  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/availability");
  await page.getByRole("button", { name: new RegExp(`^Remove ${ADMIN.name}`) }).click();
  await expect(page.getByText("Nobody is out. Every date is open.")).toBeVisible();
});

test("the public calendar has a list view, month navigation, and rejects past dates", async ({ page }) => {
  await page.goto("/book");
  await expect(page.getByRole("heading", { level: 1, name: "Book the band" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Book us" })).toHaveAttribute("href", "/book");

  // Today is requestable, yesterday (when in the same month) is not.
  await expect(dayCell(page, today)).toHaveAccessibleName(`${formatLongDate(today)}: Available. Request this date.`);
  const yesterday = addDays(today, -1);
  if (monthOf(yesterday) === monthOf(today)) {
    await expect(dayCell(page, yesterday)).toHaveAccessibleName(`${formatLongDate(yesterday)}: Past`);
  }

  await page.getByRole("link", { name: "Show as a list" }).click();
  await expect(page.getByRole("link", { name: `Request this date: ${formatLongDate(today)}` })).toBeVisible();

  await page.getByRole("navigation", { name: "Calendar months" }).getByRole("link", { name: /→$/ }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page).toHaveURL(new RegExp(`month=${monthOf(addDays(`${monthOf(today)}-28`, 7))}`));

  // Out-of-range or junk month parameters fall back to the current month.
  await page.goto("/book?month=1999-01");
  await expect(dayCell(page, today)).toBeVisible();
});
