import { type Page, expect } from "@playwright/test";
import { waitForLink } from "./mailpit";

/** Logs in through the real UI and the emailed magic link. */
export async function loginByEmail(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a login link" }).click();
  await expect(page.getByText("a login link is on its way")).toBeVisible();
  await page.goto(await waitForLink(email, "login link"));
  await expect(page).toHaveURL(/\/admin/);
}
