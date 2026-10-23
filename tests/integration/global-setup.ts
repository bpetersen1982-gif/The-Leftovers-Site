import { execFileSync } from "node:child_process";
import { TEST_DATABASE_URL } from "../support/test-db";

/** Applies migrations to the test database once before the integration suite. */
export default function setup(): void {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, LEFTOVERS_DATABASE_URL: TEST_DATABASE_URL },
  });
}
