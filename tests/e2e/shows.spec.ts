import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { addDays, todayInBandTimeZone } from "@/lib/dates";
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

test("an admin adds a show; visitors see it with structured data and a calendar file", async ({ page, browser }) => {
  const date = addDays(todayInBandTimeZone(), 20);
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/shows");
  const form = page.getByRole("region", { name: "Add a show" });
  await form.getByLabel("Date").fill(date);
  await form.getByLabel("Starts (optional)").fill("21:00");
  await form.getByLabel("Venue").fill("Zoo Bar");
  await form.getByLabel("Ticket link (optional)").fill("https://tickets.example/zoo");
  await form.getByLabel("Price (optional)").fill("$10");
  await form.getByRole("button", { name: "Add show" }).click();
  await expect(page.getByText("Show added.")).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  await expect(visitor.getByRole("heading", { name: "Next shows" })).toBeVisible();
  await visitor.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shows" }).click();
  await expect(visitor.getByRole("link", { name: "Tickets for Zoo Bar (opens in a new tab)" })).toHaveAttribute("href", "https://tickets.example/zoo");
  await expect(visitor).toHaveURL(/\/shows$/);
  const blocks = await visitor.locator('script[type="application/ld+json"]').allTextContents();
  const ld = blocks.map((text) => JSON.parse(text) as unknown).find(Array.isArray) as { name: string; startDate: string }[] | undefined;
  if (!ld) throw new Error("no MusicEvent structured data");
  expect(ld[0]?.name).toBe("The Leftovers at Zoo Bar");
  expect(ld[0]?.startDate).toMatch(new RegExp(`^${date}T21:00:00-0[56]:00$`));

  await visitor.getByRole("link", { name: "Zoo Bar", exact: true }).click();
  await expect(visitor.getByRole("heading", { level: 1, name: "Zoo Bar" })).toBeVisible();
  const ics = await visitor.request.get(`${new URL(visitor.url()).pathname}/calendar.ics`);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  expect(await ics.text()).toContain("SUMMARY:The Leftovers at Zoo Bar");
});

test("a confirmed wedding becomes a private show in one click", async ({ page }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  const booking = await prisma.bookingRequest.create({
    data: {
      reference: "LO-WED123",
      kind: "WIZARD",
      status: "CONFIRMED",
      eventDate: new Date(`${addDays(todayInBandTimeZone(), 40)}T00:00:00Z`),
      startTime: "19:00",
      endTime: "23:00",
      eventType: "WEDDING",
      contactName: "Sam Couple",
      email: "sam@example.test",
      phone: "(402) 555-0100",
      street: "1 Private Ln",
      city: "Lincoln",
      state: "NE",
      accessTokenHash: randomUUID(),
      confirmedAt: new Date(),
      confirmedById: admin.id,
    },
  });
  await loginByEmail(page, ADMIN.email);
  await page.goto(`/admin/bookings/${booking.id}`);
  await page.getByRole("button", { name: "Create show from this booking" }).click();
  await expect(page.getByText("Show created from the booking.")).toBeVisible();
  await expect(page.getByLabel("Venue")).toHaveValue("Private event");
  await expect(page.getByLabel(/Show on the public Shows page/)).not.toBeChecked();
  await expect(page.getByLabel("Street (optional)")).toHaveValue("");

  await page.goto(`/admin/bookings/${booking.id}`);
  await expect(page.getByText("Listed as a private show.")).toBeVisible();
  await page.goto("/shows");
  await expect(page.getByText("Private event")).toHaveCount(0);
});
