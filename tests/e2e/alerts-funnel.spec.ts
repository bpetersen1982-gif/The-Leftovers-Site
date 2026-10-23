import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox, countMessagesTo, waitForLink } from "../support/mailpit";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jake@example.test", name: "Jake Test" };

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
  await prisma.user.create({ data: { id: randomUUID(), email: MEMBER.email, name: MEMBER.name, role: "MEMBER", emailVerified: true } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("turning off email alerts stops booking emails for that person only", async ({ page }) => {
  await loginByEmail(page, MEMBER.email);
  await page.goto("/admin/account");
  await expect(page.getByRole("heading", { name: "Booking alerts" })).toBeVisible();
  // Headless test browsers may lack PushManager; either state is a correct render.
  await expect(
    page.getByRole("button", { name: "Turn on alerts for this device" }).or(page.getByText("This browser doesn't support push alerts.")),
  ).toBeVisible();
  await page.getByLabel("Email me about booking requests").uncheck();
  await page.getByRole("button", { name: "Save alert settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect((await prisma.user.findUniqueOrThrow({ where: { email: MEMBER.email } })).bookingEmailAlerts).toBe(false);

  // A new request now emails the Admin but not the member who opted out.
  await page.goto("/book/request?flexible=1");
  await page.getByLabel("Event type").selectOption({ label: "Wedding" });
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Your name").fill("Pat Venue");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Phone").fill("402-555-0123");
  await page.getByLabel("City").fill("Lincoln");
  await page.getByLabel("ZIP code").fill("68508");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(3_100);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Someone from The Leftovers will contact you")).toBeVisible();
  await waitForLink(ADMIN.email, "New booking request");
  expect(await countMessagesTo(MEMBER.email)).toBe(1); // only the earlier login link
});

test("the funnel lists declined quotes with contact info, Admins only", async ({ page, browser }) => {
  const request = await prisma.bookingRequest.create({
    data: {
      reference: "LO-FUNNL2", kind: "WIZARD", status: "DECLINED_BY_PROSPECT", contactName: "Sam Planner", email: "sam@example.test",
      phone: "(402) 555-0177", accessTokenHash: randomUUID(), responseNote: "Over our budget", respondedAt: new Date(),
    },
  });
  await prisma.quote.create({
    data: { requestId: request.id, eventType: "WEDDING", dayCategory: "FRI_SAT", ratePerSetCents: 50_000, sets: 3, totalCents: 150_000, expiresAt: new Date(Date.now() + 86_400_000) },
  });

  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/bookings");
  await page.getByRole("link", { name: "Funnel: declined, expired, unfinished" }).click();
  const declined = page.getByRole("region", { name: /Declined a quote/ });
  await expect(declined.getByRole("link", { name: "Sam Planner" })).toBeVisible();
  await expect(declined.getByText("Over our budget")).toBeVisible();
  await expect(declined.getByText("quoted $1,500")).toBeVisible();
  await expect(declined.getByRole("link", { name: "(402) 555-0177" })).toHaveAttribute("href", "tel:4025550177");

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await loginByEmail(memberPage, MEMBER.email);
  await memberPage.goto("/admin/bookings/funnel");
  await expect(memberPage.getByRole("heading", { name: "Not allowed" })).toBeVisible();
  await memberContext.close();
});

test("the web app manifest and service worker are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ short_name: "Leftovers", start_url: "/admin", display: "standalone" });
  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain("showNotification");
});
