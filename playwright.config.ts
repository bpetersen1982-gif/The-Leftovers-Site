import { defineConfig, devices } from "@playwright/test";
import webpush from "web-push";

/**
 * End-to-end tests against a production build (`next start`), the `leftovers_test`
 * database, and the local Mailpit inbox. Run `pnpm build` first.
 */
const PORT = 3001;
// Throwaway VAPID keys per test run, so the phone-alerts UI renders its real (configured) path.
const VAPID = webpush.generateVAPIDKeys();
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DATABASE_URL =
  process.env.LEFTOVERS_TEST_DATABASE_URL ?? "postgresql://leftovers:leftovers_dev_only@127.0.0.1:5433/leftovers_test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      LEFTOVERS_DATABASE_URL: TEST_DATABASE_URL,
      // Explicit, so a stray LEFTOVERS_ENV=production in the shell can never leak in.
      LEFTOVERS_ENV: "e2e",
      APP_URL: BASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-000",
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: process.env.SMTP_PORT ?? "1026",
      MAIL_FROM: "The Leftovers <no-reply@mail.example.test>",
      MAIL_REPLY_TO: "booking@example.test",
      LOG_LEVEL: "warn",
      VAPID_PUBLIC_KEY: VAPID.publicKey,
      VAPID_PRIVATE_KEY: VAPID.privateKey,
      VAPID_SUBJECT: "mailto:booking@example.test",
    },
  },
});
