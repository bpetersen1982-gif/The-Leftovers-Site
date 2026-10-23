import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Test database. Fixed to the local docker compose `leftovers_test` database (or
 * LEFTOVERS_TEST_DATABASE_URL in CI); never reads the dev or any other project's URL.
 */
export const TEST_DATABASE_URL =
  process.env.LEFTOVERS_TEST_DATABASE_URL ??
  "postgresql://leftovers:leftovers_dev_only@127.0.0.1:5433/leftovers_test";

if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
  throw new Error("Test database name must end in _test");
}

export function createTestClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL, max: 10 }) });
}

/** Empties every application table (fast, keeps schema). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "push_subscription", "booking_event", "date_claim", "quote", "booking_request", "rate_rule", "special_date", "pricing_settings", "availability_block", "audit_log", "invite", "passkey", "session", "account", "verification",
      "rateLimit", "band_member", "page", "site_settings", "user" RESTART IDENTITY CASCADE`);
}
