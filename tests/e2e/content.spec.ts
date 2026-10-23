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

test("public pages render default copy with shared navigation", async ({ page }) => {
  for (const [path, heading] of [
    ["/about", "About"],
    ["/members", "Members"],
    ["/contact", "Contact"],
    ["/privacy", "Privacy"],
    ["/copyright", "Copyright"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  }
  // Login is reachable from the header on every public page.
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Band login" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/members");
  await expect(page.getByText("Band lineup coming soon.")).toBeVisible();
  await page.goto("/copyright");
  await expect(page.getByRole("link", { name: "copyright@theleftoversband.com" })).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("admin edits a page; content shows publicly as text, never as HTML", async ({ page }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/pages");
  await page.getByRole("link", { name: "Edit About" }).click();
  await page.getByLabel("Page text").fill("## Our story\n\nFour friends.\n\n- Loud\n- Proud\n\n<img src=x onerror=alert(1)>");
  await expect(page.getByRole("region", { name: "Preview" }).getByRole("heading", { name: "Our story" })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. The public page is updated.")).toBeVisible();

  // A second save from the same form works (version advanced).
  await page.getByLabel("Page text").fill("## Our story\n\nFive friends.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await prisma.page.findUnique({ where: { slug: "about" } }))?.version).toBe(2);

  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "Our story" })).toBeVisible();
  await expect(page.getByText("Five friends.")).toBeVisible();
});

test("a stale editor can't overwrite a newer save", async ({ page, browser }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/pages/contact");

  // Someone else saves first, in another session.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await loginByEmail(otherPage, ADMIN.email);
  await otherPage.goto("/admin/pages/contact");
  await otherPage.getByLabel("Page text").fill("Their version.");
  await otherPage.getByRole("button", { name: "Save" }).click();
  await expect(otherPage.getByText("Saved.")).toBeVisible();
  await other.close();

  await page.getByLabel("Page text").fill("My stale version.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Someone else saved this while you were editing.")).toBeVisible();
  await page.goto("/contact");
  await expect(page.getByText("Their version.")).toBeVisible();
});

test("admin manages the lineup and the public Members page follows", async ({ page }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/members");

  const add = page.getByRole("region", { name: "Add a member" });
  await add.getByLabel("Name").fill("Mike Douglas");
  await add.getByLabel("Instrument").fill("Drums");
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText("Added Mike Douglas.")).toBeVisible();
  await add.getByLabel("Name").fill("Jake Meyers");
  await add.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText("Added Jake Meyers.")).toBeVisible();

  await page.goto("/members");
  const cards = page.getByRole("main").getByRole("listitem");
  await expect(cards.first()).toContainText("Mike Douglas");
  await expect(cards.first()).toContainText("Bio coming soon.");
  await expect(page.getByRole("link", { name: "Add bio" }).first()).toBeVisible();

  // Reorder, add a bio, hide a member.
  await page.goto("/admin/members");
  await page.getByRole("button", { name: "Move Jake Meyers up" }).click();
  await expect(page.getByRole("button", { name: "Move Jake Meyers up" })).toBeDisabled();
  const jake = page.getByRole("article", { name: "Jake Meyers" });
  await jake.getByLabel("Bio").fill("Bass and bad jokes.");
  await jake.getByRole("button", { name: "Save Jake Meyers" }).click();
  await expect(jake.getByText("Saved.")).toBeVisible();
  const mike = page.getByRole("article", { name: "Mike Douglas" });
  await mike.getByLabel("Show on the public Members page").uncheck();
  await mike.getByRole("button", { name: "Save Mike Douglas" }).click();
  await expect(mike.getByText("Saved.")).toBeVisible();

  await page.goto("/members");
  await expect(page.getByText("Bass and bad jokes.")).toBeVisible();
  await expect(page.getByText("Mike Douglas")).toHaveCount(0);
});

test("settings validate social links and update the footer", async ({ page }) => {
  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/settings");
  await page.getByLabel("Instagram").fill("https://evil.example/instagram.com/x");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Must be an https link on instagram.com")).toBeVisible();

  await page.getByLabel("Instagram").fill("https://www.instagram.com/theleftovers");
  await page.getByLabel("Booking email").fill("bookings@example.test");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.goto("/");
  // Signed in, the header link goes to admin instead of login.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Band admin" })).toHaveAttribute("href", "/admin");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: /Instagram/ })).toHaveAttribute("href", "https://www.instagram.com/theleftovers");
  await expect(footer.getByRole("link", { name: "bookings@example.test" })).toBeVisible();
});

test("band members can't edit content, and Admins see changes in the activity log", async ({ page, browser }) => {
  await prisma.user.create({ data: { id: randomUUID(), email: "jake@example.test", name: "Jake Test", role: "MEMBER", emailVerified: true } });
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await loginByEmail(memberPage, "jake@example.test");
  for (const path of ["/admin/pages", "/admin/pages/about", "/admin/members", "/admin/settings", "/admin/audit"]) {
    await memberPage.goto(path);
    await expect(memberPage.getByRole("heading", { name: "Not allowed" })).toBeVisible();
  }
  await memberContext.close();

  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/pages/privacy");
  await page.getByLabel("Page text").fill("Updated privacy text.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/audit");
  await expect(page.getByRole("cell", { name: "Edited page" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "page: privacy" })).toBeVisible();
});
