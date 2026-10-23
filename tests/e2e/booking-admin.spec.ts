import { randomUUID } from "node:crypto";
import { type Page, expect, test } from "@playwright/test";
import { addDays, dayOfWeek, formatLongDate, monthOf, todayInBandTimeZone } from "@/lib/dates";
import { hashToken } from "@/lib/tokens";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox, senderOf, waitForLink, waitForMessage } from "../support/mailpit";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jake@example.test", name: "Jake Test" };

function nextSaturday(): string {
  let date = addDays(todayInBandTimeZone(), 14);
  while (dayOfWeek(date) !== 6) date = addDays(date, 1);
  return date;
}
const SATURDAY = nextSaturday();
const dbDate = new Date(`${SATURDAY}T00:00:00Z`);

/** Creates a request directly (the wizard itself is covered in booking.spec.ts). */
async function makeRequest(input: { email: string; status: "ACCEPTED" | "AWAITING_CONTACT"; claim?: boolean; eventType?: "BAR_CLUB" | "WEDDING" }) {
  const request = await prisma.bookingRequest.create({
    data: {
      reference: `LO-${randomUUID().slice(0, 6).toUpperCase()}`,
      kind: "WIZARD",
      status: input.status,
      eventDate: dbDate,
      startTime: "20:00",
      endTime: "00:00",
      sets: 4,
      eventType: input.eventType ?? "BAR_CLUB",
      contactName: `Prospect ${input.email}`,
      email: input.email,
      phone: "(402) 555-0123",
      city: "Lincoln",
      state: "NE",
      zip: "68508",
      accessTokenHash: hashToken(randomUUID()),
      submittedAt: new Date(),
    },
  });
  if (input.claim) await prisma.dateClaim.create({ data: { date: dbDate, kind: "PENDING", requestId: request.id } });
  return request;
}

const dayCell = (page: Page) => page.getByLabel(new RegExp(`^${formatLongDate(SATURDAY)}: `));

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
  await prisma.user.create({ data: { id: randomUUID(), email: MEMBER.email, name: MEMBER.name, role: "MEMBER", emailVerified: true } });
  await prisma.pricingSettings.create({ data: { id: 1 } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("Admin confirms an accepted request: date shows Booked, prospect gets a confirmation from booking@", async ({ page }) => {
  const request = await makeRequest({ email: "pat@example.test", status: "ACCEPTED", claim: true });
  await loginByEmail(page, ADMIN.email);
  await page.goto(`/admin/bookings/${request.id}`);

  const confirm = page.getByRole("region", { name: "Confirm booking" });
  await confirm.getByLabel("Agreed price ($)").fill("1500");
  await confirm.getByLabel("Load-in (optional)").selectOption("18:30");
  await confirm.getByRole("button", { name: "Confirm: mark Booked" }).click();
  await expect(page.getByText("Booked.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Edit booking details" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cancel this booking" })).toBeVisible();

  const link = await waitForLink("pat@example.test", "You're booked");
  expect(await senderOf("pat@example.test", "You're booked")).toBe("booking@mail.example.test");
  await waitForLink(MEMBER.email, "Gig booked");

  await page.goto(link);
  await expect(page.getByText("Your date is confirmed.")).toBeVisible();
  await page.goto(`/book?month=${monthOf(SATURDAY)}`);
  await expect(dayCell(page)).toHaveAccessibleName(`${formatLongDate(SATURDAY)}: Booked. Contact the band about this date.`);
});

test("confirming over another request's date requires an override, which releases the other one", async ({ page }) => {
  const holder = await makeRequest({ email: "first@example.test", status: "ACCEPTED", claim: true });
  const bigger = await makeRequest({ email: "fest@example.test", status: "AWAITING_CONTACT" });
  await loginByEmail(page, ADMIN.email);
  await page.goto(`/admin/bookings/${bigger.id}`);

  const confirm = page.getByRole("region", { name: "Confirm booking" });
  await confirm.getByLabel("Agreed price ($)").fill("4000");
  await confirm.getByLabel("Email them the confirmation from booking@").uncheck();
  await confirm.getByRole("button", { name: "Confirm: mark Booked" }).click();
  await expect(page.getByText(/already pending for Prospect first@example\.test/)).toBeVisible();

  await confirm.getByLabel("Override: why bump the other request?").fill("Festival headliner");
  await confirm.getByRole("button", { name: "Override and book" }).click();
  await expect(page.getByText("The other request was released: contact them personally.")).toBeVisible();

  expect((await prisma.bookingRequest.findUniqueOrThrow({ where: { id: holder.id } })).status).toBe("RELEASED");
  await waitForLink(ADMIN.email, "Bumped by an override");
  await page.goto("/admin/audit");
  await expect(page.getByRole("cell", { name: "Overrode a date (bumped another request)" })).toBeVisible();
});

test("Admin sends a manual quote to a contact-path request; the prospect accepts with the new link", async ({ page, browser }) => {
  const request = await makeRequest({ email: "wed@example.test", status: "AWAITING_CONTACT", eventType: "WEDDING" });
  await loginByEmail(page, ADMIN.email);
  await page.goto(`/admin/bookings/${request.id}`);
  const quote = page.getByRole("region", { name: "Send a quote" });
  await quote.getByLabel("Price per set ($)").fill("650");
  await quote.getByLabel("Sets").fill("3");
  await quote.getByLabel("Message (optional, above the price)").fill("Includes ceremony music.");
  await quote.getByRole("button", { name: "Send quote" }).click();
  await expect(page.getByText("Quote sent with a new private link.")).toBeVisible();

  const link = await waitForLink("wed@example.test", "Your quote from The Leftovers");
  const prospect = await (await browser.newContext()).newPage();
  await prospect.goto(link);
  await expect(prospect.getByText("$1,950")).toBeVisible();
  await prospect.getByRole("button", { name: "Accept quote" }).click();
  await expect(prospect.getByText("You accepted the quote.")).toBeVisible();
});

test("members can reply from booking@ and log calls, but can't confirm or decline", async ({ page }) => {
  const request = await makeRequest({ email: "pat@example.test", status: "AWAITING_CONTACT" });
  await loginByEmail(page, MEMBER.email);
  await page.goto(`/admin/bookings/${request.id}`);
  await expect(page.getByRole("region", { name: "Confirm booking" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Decline" })).toHaveCount(0);

  const reply = page.getByRole("region", { name: "Reply by email" });
  await reply.getByLabel("Message").fill("Hi! Are you flexible on the start time?");
  await reply.getByRole("button", { name: "Send email" }).click();
  await expect(page.getByText("Sent from booking@.")).toBeVisible();
  await waitForMessage("pat@example.test", `Your request ${request.reference}`);
  expect(await senderOf("pat@example.test", `Your request ${request.reference}`)).toBe("booking@mail.example.test");

  const notes = page.getByRole("region", { name: "Notes" });
  await notes.getByLabel("Note").fill("Left a voicemail");
  await notes.getByRole("button", { name: "I contacted them" }).click();
  await expect(page.getByText("Logged. The band can see you reached out.")).toBeVisible();
  await expect(page.getByText("Contacted", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Emailed them")).toBeVisible();
});

test("decline frees the date and sends the edited message; holds show Pending", async ({ page }) => {
  const accepted = await makeRequest({ email: "pat@example.test", status: "ACCEPTED", claim: true });
  await loginByEmail(page, ADMIN.email);
  await page.goto(`/admin/bookings/${accepted.id}`);
  const decline = page.getByRole("region", { name: "Decline" });
  await decline.getByLabel("Message (edit before sending)").fill("Sorry, we're out of town that weekend.");
  await decline.getByLabel("Confirm decline").check();
  await decline.getByRole("button", { name: "Decline request" }).click();
  await expect(page.getByText("Declined. The date is free again.")).toBeVisible();
  await waitForMessage("pat@example.test", "Your request with The Leftovers");
  expect(await prisma.dateClaim.count()).toBe(0);

  const open = await makeRequest({ email: "next@example.test", status: "AWAITING_CONTACT" });
  await page.goto(`/admin/bookings/${open.id}`);
  await page.getByRole("region", { name: "Hold the date" }).getByRole("button", { name: "Hold date" }).click();
  await expect(page.getByText("Date held for 7 days. It shows Pending publicly.")).toBeVisible();
  await page.goto(`/book?month=${monthOf(SATURDAY)}`);
  await expect(dayCell(page)).toHaveAccessibleName(`${formatLongDate(SATURDAY)}: Pending. Contact the band about this date.`);
});

test("the wizard flags an unrecognized ZIP once, then lets them continue", async ({ page }) => {
  await page.goto(`/book/request?date=${SATURDAY}`);
  await page.getByLabel("Event type").selectOption({ label: "Wedding" });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Your name").fill("Pat Venue");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Phone").fill("402-555-0123");
  await page.getByLabel("City").fill("Lincoln");
  await page.getByLabel("ZIP code").fill("69527");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("We don't recognize that ZIP code.")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();
});
