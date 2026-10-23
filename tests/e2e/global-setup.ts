import { execFileSync } from "node:child_process";
import { TEST_DATABASE_URL } from "../support/test-db";

/** Migrates the test database before the browser suite. */
export default function globalSetup(): void {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, LEFTOVERS_DATABASE_URL: TEST_DATABASE_URL },
  });
}
