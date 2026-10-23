import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { addDays, dayOfWeek, formatLongDate, monthOf, todayInBandTimeZone } from "@/lib/dates";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox, countMessagesTo, waitForLink } from "../support/mailpit";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jake@example.test", name: "Jake Test" };
const PROSPECT = { name: "Pat Venue", email: "pat@example.test" };

/** First Saturday at least 14 days out (inside notice, gets the Fri–Sat rate). */
function nextSaturday(): string {
  let date = addDays(todayInBandTimeZone(), 14);
  while (dayOfWeek(date) !== 6) date = addDays(date, 1);
  return date;
}
const SATURDAY = nextSaturday();

async function fillWizard(page: Page, options: { eventType: string; zip?: string }) {
  await expect(page.getByRole("heading", { name: "When", exact: true })).toBeVisible();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(SATURDAY);
  await page.getByLabel("Event type").selectOption({ label: options.eventType });
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Who", exact: true })).toBeVisible();
  await page.getByLabel("Your name").fill(PROSPECT.name);
  await page.getByLabel("Venue or organization (optional)").fill("The Zoo Bar");
  await page.getByLabel("Email").fill(PROSPECT.email);
  await page.getByLabel("Phone").fill("402-555-0123");
  await page.getByLabel("City").fill("Lincoln");
  await page.getByLabel("ZIP code").fill(options.zip ?? "68508");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();
  await page.getByLabel("Expected attendance (optional)").fill("150");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  // Real people take a few seconds; instant submissions are treated as bots.
  await page.waitForTimeout(3_100);
  await page.getByRole("button", { name: "Send request" }).click();
}

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
  await prisma.user.create({ data: { id: randomUUID(), email: MEMBER.email, name: MEMBER.name, role: "MEMBER", emailVerified: true } });
  await prisma.pricingSettings.create({ data: { id: 1 } });
  await prisma.rateRule.create({ data: { eventType: "BAR_CLUB", dayCategory: "FRI_SAT", ratePerSetCents: 40_000 } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("calendar → wizard → instant quote → accept with note → date shows Pending; band is notified", async ({ page, browser }) => {
  await page.goto(`/book?month=${monthOf(SATURDAY)}`);
  await page.getByLabel(new RegExp(`^${formatLongDate(SATURDAY)}: Available`)).click();
  await fillWizard(page, { eventType: "Bar / club" });

  await expect(page).toHaveURL(/\/booking\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("heading", { name: "Your quote" })).toBeVisible();
  await expect(page.getByText("$1,600")).toBeVisible();
  await expect(page.getByText("4 sets × $400 per set. Travel included.")).toBeVisible();

  // The prospect got an email with the same private link.
  const link = await waitForLink(PROSPECT.email, "Your booking request");
  expect(new URL(link).pathname).toBe(new URL(page.url()).pathname);

  await page.getByLabel("Note to the band (optional)").fill("Can you start at 8:30?");
  await expect(page.getByText("228 characters left")).toBeVisible();
  await page.getByRole("button", { name: "Accept with note" }).click();
  await expect(page.getByText("You accepted the quote. Your date is now pending")).toBeVisible();

  await page.goto(`/book?month=${monthOf(SATURDAY)}`);
  await expect(page.getByLabel(new RegExp(`^${formatLongDate(SATURDAY)}: `))).toHaveAccessibleName(
    `${formatLongDate(SATURDAY)}: Pending. Contact the band about this date.`,
  );

  // Every band account got notified; only the Admin's copy shows the price.
  await waitForLink(ADMIN.email, "Quote accepted");
  await waitForLink(MEMBER.email, "Quote accepted");

  // The inbox lists it under "Needs action"; Members see contact info but no price.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await loginByEmail(memberPage, MEMBER.email);
  await memberPage.goto("/admin/bookings");
  await memberPage.getByRole("link", { name: new RegExp(formatLongDate(SATURDAY)) }).click();
  await expect(memberPage.getByRole("link", { name: "Call (402) 555-0123" })).toBeVisible();
  await expect(memberPage.getByRole("region", { name: "Their note on the quote" })).toContainText("Can you start at 8:30?");
  await expect(memberPage.getByText("$1,600")).toHaveCount(0);
  await memberContext.close();

  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/bookings");
  await expect(page.getByText("$1,600")).toBeVisible();
});

test("no rate for the event type: no price, 'we'll contact you', and the Admin sees why", async ({ page }) => {
  await page.goto(`/book/request?date=${SATURDAY}`);
  await fillWizard(page, { eventType: "Wedding" });
  await expect(page.getByText("Someone from The Leftovers will contact you")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your quote" })).toHaveCount(0);

  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/bookings");
  await page.getByRole("link", { name: new RegExp(formatLongDate(SATURDAY)) }).click();
  await expect(page.getByText("No rate set for this event type and day")).toBeVisible();
});

test("too far away: no price, even with a rate", async ({ page }) => {
  await page.goto(`/book/request?date=${SATURDAY}`);
  await fillWizard(page, { eventType: "Bar / club", zip: "68801" });
  await expect(page.getByText("Someone from The Leftovers will contact you")).toBeVisible();
  await expect(page.getByText("$1,600")).toHaveCount(0);
});

test("a pending date sends people to 'contact the band', flagged as a conflict", async ({ page }) => {
  const request = await prisma.bookingRequest.create({
    data: {
      reference: "LO-TEST22", kind: "WIZARD", status: "ACCEPTED", eventDate: new Date(`${SATURDAY}T00:00:00Z`),
      contactName: "First", email: "first@example.test", phone: "(402) 555-0100", accessTokenHash: randomUUID(),
    },
  });
  await prisma.dateClaim.create({ data: { date: new Date(`${SATURDAY}T00:00:00Z`), kind: "PENDING", requestId: request.id } });

  await page.goto(`/book/request?date=${SATURDAY}`);
  await expect(page.getByRole("heading", { name: "Contact the band about this date" })).toBeVisible();
  await page.getByLabel("Your name").fill("Big Fest");
  await page.getByLabel("Email").fill("fest@example.test");
  await page.getByLabel("Phone").fill("4025550199");
  await page.getByLabel("Event type").selectOption({ label: "Festival" });
  await page.getByRole("button", { name: "Send to the band" }).click();
  await expect(page.getByText("Tell us a little about the event")).toBeVisible();
  // Typed values survive the error.
  await expect(page.getByLabel("Your name")).toHaveValue("Big Fest");
  await page.getByLabel("Tell us about the event").fill("Headliner slot, 2 sets.");
  await page.getByRole("button", { name: "Send to the band" }).click();
  await expect(page.getByText("Request sent")).toBeVisible();
  await waitForLink(ADMIN.email, "[CONFLICT]");
});

test("validation keeps people on the step with the problem", async ({ page }) => {
  await page.goto("/book/request?flexible=1");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Choose an event type")).toBeVisible();
  await page.getByLabel("Event type").selectOption({ label: "Corporate" });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Enter a 10-digit US phone number")).toBeVisible();
  await expect(page.getByText("Enter a 5-digit ZIP code")).toBeVisible();
  expect(await countMessagesTo(ADMIN.email)).toBe(0);
});
