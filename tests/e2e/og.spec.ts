import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { addDays, todayInBandTimeZone } from "@/lib/dates";
import { bootstrapAdmin } from "@/lib/users/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();

test.beforeEach(async () => {
  await resetDatabase(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function ogImageOf(page: import("@playwright/test").Page, path: string): Promise<string> {
  await page.goto(path);
  const content = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  if (!content) throw new Error(`no og:image on ${path}`);
  return new URL(content).pathname + new URL(content).search;
}

async function expectCard(request: import("@playwright/test").APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  const meta = await sharp(await response.body()).metadata();
  expect([meta.width, meta.height]).toEqual([1200, 630]);
}

test("pages share with a branded preview; shows get their own card", async ({ page, request }) => {
  const admin = await bootstrapAdmin(prisma, { email: "admin@example.test", name: "Erik Test" });
  const date = addDays(todayInBandTimeZone(), 10);
  await prisma.show.create({
    data: { slug: `${date}-zoo-bar`, date: new Date(`${date}T00:00:00Z`), startTime: "21:00", venueName: "Zoo Bar", city: "Lincoln", state: "NE", status: "SOLD_OUT", createdById: admin.userId },
  });

  for (const path of ["/", "/songs", "/fan-wall"]) {
    const image = await ogImageOf(page, path);
    expect(image, path).toMatch(/^\/opengraph-image/);
  }
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expectCard(request, await ogImageOf(page, "/"));

  const showCard = await ogImageOf(page, `/shows/${date}-zoo-bar`);
  expect(showCard).toMatch(new RegExp(`^/shows/${date}-zoo-bar/opengraph-image`));
  await expectCard(request, showCard);
  // A missing show still gets a generic card rather than a broken image.
  await expectCard(request, showCard.replace(`${date}-zoo-bar`, "not-a-real-show"));
});
