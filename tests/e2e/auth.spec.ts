import { expect, test } from "@playwright/test";
import { bootstrapAdmin } from "@/lib/users/service";
import { clearInbox, countMessagesTo, waitForLink } from "../support/mailpit";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const ADMIN = { email: "admin@example.test", name: "Erik Test" };
const MEMBER = { email: "jake@example.test", name: "Jake Test" };

test.beforeEach(async () => {
  await resetDatabase(prisma);
  await clearInbox();
  await bootstrapAdmin(prisma, ADMIN);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("admin logs in by email, invites a member, member accepts and is logged in", async ({ page, browser }) => {
  // Admin requests a magic link and follows it.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByRole("button", { name: "Email me a login link" }).click();
  await expect(page.getByText("a login link is on its way")).toBeVisible();
  await page.goto(await waitForLink(ADMIN.email, "login link"));
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: `Hey, ${ADMIN.name}` })).toBeVisible();

  // Admin invites a band member from the Users page.
  await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Users" }).click();
  await page.getByLabel("Name").fill(MEMBER.name);
  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByLabel("Role").selectOption("MEMBER");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invite sent to ${MEMBER.name}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending invites (1)" })).toBeVisible();

  // Member opens the invite in a fresh browser and accepts.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const inviteUrl = await waitForLink(MEMBER.email, "invited");
  await memberPage.goto(inviteUrl);
  await expect(memberPage.getByRole("heading", { name: `Welcome, ${MEMBER.name}` })).toBeVisible();
  await memberPage.getByRole("button", { name: "Accept invite" }).click();
  await expect(memberPage).toHaveURL(/\/admin\/account\?welcome=1$/);
  await expect(memberPage.getByText(`You're in, ${MEMBER.name}`)).toBeVisible();

  // Members can't manage users: no nav link, and the page itself is forbidden.
  await expect(memberPage.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Users" })).toHaveCount(0);
  await memberPage.goto("/admin/users");
  await expect(memberPage.getByRole("heading", { name: "Not allowed" })).toBeVisible();

  // The invite link is single-use.
  await memberPage.goto(inviteUrl);
  await expect(memberPage.getByText("That invite was already used")).toBeVisible();
  await memberContext.close();

  // Signing out lands on the public home page, and admin is closed again.
  const signOutContext = await browser.newContext();
  const signOutPage = await signOutContext.newPage();
  await signOutPage.goto(await (async () => {
    await signOutPage.goto("/login");
    await signOutPage.getByLabel("Email").fill(MEMBER.email);
    await signOutPage.getByRole("button", { name: "Email me a login link" }).click();
    return waitForLink(MEMBER.email, "login link");
  })());
  await signOutPage.getByRole("button", { name: "Sign out" }).click();
  await expect(signOutPage).toHaveURL(/\/$/);
  await expect(signOutPage.getByRole("heading", { name: "Book the band" })).toBeVisible();
  await signOutPage.goto("/admin");
  await expect(signOutPage).toHaveURL(/\/login$/);
  await signOutContext.close();

  // Admin sees the member as active.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Active users (2)" })).toBeVisible();
  await expect(page.getByText(MEMBER.email)).toBeVisible();
});

test("login doesn't reveal accounts and sends nothing to unknown emails", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("stranger@example.test");
  await page.getByRole("button", { name: "Email me a login link" }).click();
  await expect(page.getByText("a login link is on its way")).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(await countMessagesTo("stranger@example.test")).toBe(0);
});

test("signed-out visitors are sent to login, and used login links fail cleanly", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByRole("button", { name: "Email me a login link" }).click();
  const link = await waitForLink(ADMIN.email, "login link");
  await page.goto(link);
  await expect(page).toHaveURL(/\/admin$/);

  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByText(/login link isn't valid|didn't work/)).toBeVisible();
});

test("removed users are logged out and can't get a new link", async ({ page, browser }) => {
  const member = await prisma.user.create({
    data: { id: crypto.randomUUID(), email: MEMBER.email, name: MEMBER.name, role: "MEMBER", emailVerified: true },
  });

  // Member logs in.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/login");
  await memberPage.getByLabel("Email").fill(MEMBER.email);
  await memberPage.getByRole("button", { name: "Email me a login link" }).click();
  await memberPage.goto(await waitForLink(MEMBER.email, "login link"));
  await expect(memberPage).toHaveURL(/\/admin$/);

  // Admin removes them.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByRole("button", { name: "Email me a login link" }).click();
  await page.goto(await waitForLink(ADMIN.email, "login link"));
  await page.goto("/admin/users");
  const row = page.getByRole("listitem").filter({ hasText: MEMBER.email });
  await row.getByLabel("Confirm").check();
  await row.getByRole("button", { name: `Remove ${MEMBER.name}` }).click();
  await expect(page.getByText("User removed and logged out everywhere.")).toBeVisible();

  // Their session is gone, and a new link request sends nothing.
  await memberPage.goto("/admin");
  await expect(memberPage).toHaveURL(/\/login$/);
  await clearInbox();
  await memberPage.getByLabel("Email").fill(MEMBER.email);
  await memberPage.getByRole("button", { name: "Email me a login link" }).click();
  await expect(memberPage.getByText("a login link is on its way")).toBeVisible();
  await memberPage.waitForTimeout(1_000);
  expect(await countMessagesTo(MEMBER.email)).toBe(0);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).deactivatedAt).not.toBeNull();
  await memberContext.close();
});

test("the last Admin can't demote themselves", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByRole("button", { name: "Email me a login link" }).click();
  await page.goto(await waitForLink(ADMIN.email, "login link"));
  await page.goto("/admin/users");
  await page.getByRole("button", { name: `Make Band Member: ${ADMIN.name}` }).click();
  await expect(page.getByText("The site must always have at least one active Admin.")).toBeVisible();
});

test("pages ship a nonce-based CSP and no browser console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  await expect(page.getByRole("heading", { name: "Book the band" })).toBeVisible();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Email me a login link" })).toBeEnabled();
  expect(errors).toEqual([]);
});
