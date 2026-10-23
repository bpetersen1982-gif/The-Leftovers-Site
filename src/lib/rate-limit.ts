import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Fixed-window rate limiter stored in Postgres (shares Better Auth's rateLimit table,
 * namespaced by key prefix). Atomic single-statement upsert, so it's correct with any
 * number of app instances and under concurrent requests.
 */
export async function consumeRateLimit(
  prisma: PrismaClient,
  input: { key: string; max: number; windowMs: number; now?: number },
): Promise<{ allowed: boolean; count: number }> {
  const now = input.now ?? Date.now();
  const windowStart = now - input.windowMs;
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${input.key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rateLimit"."lastRequest" < ${windowStart} THEN 1 ELSE "rateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "rateLimit"."lastRequest" < ${windowStart} THEN ${now} ELSE "rateLimit"."lastRequest" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  return { allowed: count <= input.max, count };
}
