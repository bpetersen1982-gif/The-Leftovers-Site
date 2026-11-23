import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { addDays, todayInBandTimeZone } from "@/lib/dates";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox } from "../support/mailpit";
import { resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

/**
 * Automated accessibility checks (requirements A11Y-1): every public page and the main band
 * pages are scanned with axe-core against WCAG 2.2 A/AA. Pages are seeded with realistic
 * content so lists, cards, and tables are checked, not just empty states.
 *
 * axe catches roughly a third to half of real problems; a manual keyboard and screen-reader
 * pass is still needed before launch.
 */

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jim@example.test", name: "Jim Test" };
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let showSlug = "";
let videoId = "";

async function seed(): Promise<void> {
  const admin = await bootstrapAdmin(prisma, ADMIN);
  await prisma.user.create({ data: { id: randomUUID(), name: MEMBER.name, email: MEMBER.email, role: "MEMBER", emailVerified: true } });
  const today = todayInBandTimeZone();
  const upcoming = await prisma.show.create({
    data: {
      slug: `${addDays(today, 14)}-zoo-bar`,
      date: new Date(`${addDays(today, 14)}T00:00:00Z`),
      startTime: "21:00",
      venueName: "Zoo Bar",
      city: "Lincoln",
      state: "NE",
      ticketUrl: "https://tickets.example/zoo",
      priceText: "$10",
      createdById: admin.userId,
    },
  });
  await prisma.show.create({
    data: { slug: `${addDays(today, -10)}-bourbon`, date: new Date(`${addDays(today, -10)}T00:00:00Z`), venueName: "Bourbon Theatre", city: "Lincoln", state: "NE", status: "SCHEDULED", createdById: admin.userId },
  });
  showSlug = upcoming.slug;
  await prisma.song.createMany({
    data: [
      { title: "Everlong", artist: "Foo Fighters", year: 1997, matchKey: "foo fighters|everlong" },
      { title: "Mr. Brightside", artist: "The Killers", year: 2003, matchKey: "killers|mr brightside", note: "Always closes the night" },
    ],
  });
  await prisma.fanPost.create({ data: { status: "APPROVED", displayName: "Kelsey", message: "Best night ever!", decidedAt: new Date(), decidedByRole: "ADMIN" } });
  await prisma.fanPost.create({ data: { status: "PENDING", displayName: "Sam", message: "You guys rock", email: "sam@example.test" } });
  const video = await prisma.video.create({
    data: {
      streamUid: randomBytes(16).toString("hex"),
      status: "PUBLISHED",
      uploaderId: admin.userId,
      originalFilename: "clip.mov",
      sizeBytes: 1000n,
      uploadExpiresAt: new Date(),
      durationSeconds: 95,
      playbackOrigin: "https://customer-testcode123.cloudflarestream.com",
      title: "Mr. Brightside (Zoo Bar)",
      publishedAt: new Date(),
      streamPublic: true,
    },
  });
  videoId = video.id;
}

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
  await clearInbox();
  await seed();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Readable summary of violations, so a failure says what to fix and where. */
function describe(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.slice(0, 5).map((node) => `[${violation.impact}] ${violation.id}: ${violation.help} -> ${node.target.join(" ")}`),
  );
}

async function scan(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // Third-party frames (Turnstile, Stream player) aren't ours to fix.
    .exclude('iframe[src*="challenges.cloudflare.com"]')
    .exclude('iframe[src*="cloudflarestream.com"]')
    .analyze();
  return describe(results.violations).map((line) => `${path} ${line}`);
}

test("public pages have no WCAG 2.2 AA violations axe can detect", async ({ page }) => {
  const paths = [
    "/",
    "/shows",
    `/shows/${showSlug}`,
    "/photos",
    "/videos",
    `/videos/${videoId}`,
    "/songs",
    "/fan-wall",
    "/mailing-list",
    "/press",
    "/book",
    "/about",
    "/members",
    "/contact",
    "/privacy",
    "/copyright",
    "/login",
  ];
  const problems: string[] = [];
  for (const path of paths) problems.push(...(await scan(page, path)));
  expect(problems, problems.join("\n")).toEqual([]);
});

test("band pages have no WCAG 2.2 AA violations axe can detect", async ({ page, browser }) => {
  await loginByEmail(page, ADMIN.email);
  const adminPaths = [
    "/admin",
    "/admin/bookings",
    "/admin/shows",
    "/admin/availability",
    "/admin/photos",
    "/admin/photos/albums",
    "/admin/videos",
    "/admin/fan-wall",
    "/admin/songs",
    "/admin/mailing-list",
    "/admin/press",
    "/admin/pricing",
    "/admin/pages",
    "/admin/members",
    "/admin/users",
    "/admin/settings",
    "/admin/audit",
    "/admin/account",
  ];
  const problems: string[] = [];
  for (const path of adminPaths) problems.push(...(await scan(page, path)));

  const member = await (await browser.newContext()).newPage();
  await loginByEmail(member, MEMBER.email);
  for (const path of ["/admin", "/admin/fan-wall", "/admin/photos", "/admin/videos"]) problems.push(...(await scan(member, path)));
  expect(problems, problems.join("\n")).toEqual([]);
});
