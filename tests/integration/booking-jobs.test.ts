import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "../support/test-db";

// Notifications are covered elsewhere; here we only check what the job decides to send.
const notifyBand = vi.fn(async () => 1);
vi.mock("@/lib/booking/notifications", () => ({ notifyBand: (...args: unknown[]) => notifyBand(...(args as [])) }));
const { runBookingJobs } = await import("@/lib/jobs/booking-jobs");

const prisma = createTestClient();
const NOW = new Date("2026-10-23T15:00:00Z");
const HOUR = 3_600_000;

async function accepted(hoursAgo: number) {
  return prisma.bookingRequest.create({
    data: {
      reference: `LO-${randomUUID().slice(0, 6).toUpperCase()}`, kind: "WIZARD", status: "ACCEPTED", eventDate: new Date("2026-11-14T00:00:00Z"),
      contactName: "P", email: "p@example.test", phone: "(402) 555-0123", accessTokenHash: randomUUID(), respondedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
  notifyBand.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runBookingJobs", () => {
  it("sends the 24h and 72h reminders once each", async () => {
    const fresh = await accepted(2);
    const day = await accepted(25);
    const old = await accepted(80);

    const first = await runBookingJobs(prisma, NOW);
    expect(first).toMatchObject({ ran: true, reminders24: 1, reminders72: 1 });
    expect(notifyBand.mock.calls.map((call) => [(call as unknown[])[1], (call as unknown[])[2]])).toEqual([
      ["REMINDER_72H", old.id],
      ["REMINDER_24H", day.id],
    ]);

    notifyBand.mockClear();
    await runBookingJobs(prisma, NOW);
    expect(notifyBand).not.toHaveBeenCalled();
    expect((await prisma.bookingRequest.findUniqueOrThrow({ where: { id: fresh.id } })).reminder24SentAt).toBeNull();

    // Two days later, the 25h one crosses 72h.
    await runBookingJobs(prisma, new Date(NOW.getTime() + 48 * HOUR));
    expect(notifyBand.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["REMINDER_72H", "REMINDER_24H"]);
  });

  it("warns once before a hold expires", async () => {
    const request = await accepted(1);
    await prisma.bookingRequest.update({ where: { id: request.id }, data: { status: "CONTACTED" } });
    await prisma.dateClaim.create({
      data: { date: new Date("2026-11-14T00:00:00Z"), kind: "PENDING", requestId: request.id, expiresAt: new Date(NOW.getTime() + 20 * HOUR) },
    });
    expect((await runBookingJobs(prisma, NOW)).holdWarnings).toBe(1);
    expect((await runBookingJobs(prisma, NOW)).holdWarnings).toBe(0);
  });

  it("purges unfinished drafts older than 90 days, keeps newer ones and real requests", async () => {
    const old = new Date(NOW.getTime() - 91 * 24 * HOUR);
    const base = { kind: "WIZARD" as const, contactName: "P", email: "p@example.test", phone: "(402) 555-0123" };
    await prisma.bookingRequest.create({ data: { ...base, reference: "LO-OLD234", status: "IN_PROGRESS", accessTokenHash: randomUUID(), createdAt: old } });
    await prisma.bookingRequest.create({ data: { ...base, reference: "LO-NEW234", status: "IN_PROGRESS", accessTokenHash: randomUUID() } });
    await prisma.bookingRequest.create({ data: { ...base, reference: "LO-REAL23", status: "AWAITING_CONTACT", accessTokenHash: randomUUID(), createdAt: old } });
    expect((await runBookingJobs(prisma, NOW)).draftsPurged).toBe(1);
    expect((await prisma.bookingRequest.findMany({ orderBy: { reference: "asc" } })).map((row) => row.reference)).toEqual(["LO-NEW234", "LO-REAL23"]);
  });

  it("only one of two simultaneous runs does the work", async () => {
    await accepted(30);
    const [a, b] = await Promise.all([runBookingJobs(prisma, NOW), runBookingJobs(prisma, NOW)]);
    expect(a.reminders24 + b.reminders24).toBe(1);
    expect(notifyBand).toHaveBeenCalledTimes(1);
  });
});
