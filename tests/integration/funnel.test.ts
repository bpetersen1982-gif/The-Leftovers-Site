import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { BookingStatus } from "@/generated/prisma/enums";
import { getFunnel } from "@/lib/booking/funnel";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const NOW = new Date("2026-10-23T15:00:00Z");

async function make(status: BookingStatus, overrides: { createdAt?: Date; quoteExpiresAt?: Date; note?: string } = {}) {
  const request = await prisma.bookingRequest.create({
    data: {
      reference: `LO-${randomUUID().slice(0, 6).toUpperCase()}`, kind: "WIZARD", status, contactName: status, email: "p@example.test",
      phone: "(402) 555-0123", accessTokenHash: randomUUID(), responseNote: overrides.note ?? "", respondedAt: NOW,
      createdAt: overrides.createdAt ?? NOW,
    },
  });
  if (overrides.quoteExpiresAt) {
    await prisma.quote.create({
      data: { requestId: request.id, eventType: "BAR_CLUB", dayCategory: "FRI_SAT", ratePerSetCents: 40_000, sets: 4, totalCents: 160_000, expiresAt: overrides.quoteExpiresAt },
    });
  }
  return request;
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getFunnel", () => {
  it("lists declined, expired, and abandoned requests, and counts by month", async () => {
    await make("DECLINED_BY_PROSPECT", { note: "Too pricey", quoteExpiresAt: new Date(NOW.getTime() + 1) });
    await make("QUOTED", { quoteExpiresAt: new Date(NOW.getTime() - 1) });
    await make("QUOTED", { quoteExpiresAt: new Date(NOW.getTime() + 3_600_000) }); // still live: not expired
    await make("IN_PROGRESS", { createdAt: new Date(NOW.getTime() - 2 * 3_600_000) });
    await make("IN_PROGRESS", { createdAt: new Date(NOW.getTime() - 5 * 60_000) }); // probably still typing
    await make("CONFIRMED", { quoteExpiresAt: new Date(NOW.getTime() + 1) });

    const funnel = await getFunnel(prisma, NOW);
    expect(funnel.declined.map((row) => row.note)).toEqual(["Too pricey"]);
    expect(funnel.expired).toHaveLength(1);
    expect(funnel.abandoned).toHaveLength(1);
    expect(funnel.months).toHaveLength(6);
    expect(funnel.months.at(-1)).toEqual({ month: "2026-10", requests: 4, quoted: 4, accepted: 1, declined: 1, confirmed: 1, abandoned: 2 });
  });
});
