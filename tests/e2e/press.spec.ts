import { expect, test } from "@playwright/test";
import { bootstrapAdmin } from "@/lib/users/service";
import { loginByEmail } from "../support/e2e-auth";
import { clearInbox } from "../support/mailpit";
import { resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("an empty press kit says coming soon; an admin fills it in", async ({ page, browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/");
  await visitor.getByRole("link", { name: "Press kit" }).click();
  await expect(visitor.getByRole("heading", { level: 1, name: "Press kit" })).toBeVisible();
  await expect(visitor.getByText("Coming soon.").first()).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Add it" })).toHaveCount(0);

  await loginByEmail(page, ADMIN.email);
  await page.goto("/admin/press");
  await page.getByRole("link", { name: "Edit short bio" }).click();
  await page.getByLabel("Page text").fill("The Leftovers play 90s and 2000s rock all over Lincoln.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.", { exact: false })).toBeVisible();

  await page.goto("/admin/press");
  await page.getByLabel("Upload Tech rider").setInputFiles({ name: "rider.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("Uploaded. It's on the press kit now.")).toBeVisible();
  await page.getByLabel("Upload Stage plot").setInputFiles({ name: "plot.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") });
  await expect(page.getByText("That file isn't a PDF.")).toBeVisible();

  await visitor.reload();
  await expect(visitor.getByText("The Leftovers play 90s and 2000s rock all over Lincoln.")).toBeVisible();
  const rider = visitor.getByRole("link", { name: /Download tech rider \(PDF/ });
  const response = await visitor.request.get((await rider.getAttribute("href")) ?? "");
  expect(response.headers()["content-type"]).toBe("application/pdf");
  await expect(visitor.getByRole("link", { name: /Download stage plot/ })).toHaveCount(0);
});
