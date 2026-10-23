import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { publicDayState } from "@/lib/availability/service";
import {
  BookingAdminError,
  addBookingNote,
  cancelBooking,
  confirmBooking,
  confirmInputSchema,
  declineByBand,
  manualQuoteSchema,
  placeHold,
  releaseHold,
  sendManualQuote,
} from "@/lib/booking/admin";
import { acceptQuote, getRequestForProspect, submitWizard } from "@/lib/booking/requests";
import { todayInBandTimeZone } from "@/lib/dates";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const NOW = new Date("2026-10-23T15:00:00Z");
const TODAY = todayInBandTimeZone(NOW);
const SATURDAY = "2026-11-14";
let admin: { id: string; role: "ADMIN" };
let member: { id: string; role: "MEMBER" };

const contact = (email: string) => ({
  contactName: "Pat Venue", email, phone: "(402) 555-0123", organization: "Zoo Bar", street: "", city: "Lincoln", state: "NE", zip: "68508",
});
const details = { attendance: null, setting: "INDOOR" as const, soundProvided: "YES" as const, message: "" };
const when = { flexible: false, eventDate: SATURDAY, startTime: "20:00", endTime: "00:00", sets: 4, eventType: "BAR_CLUB" as const };

async function request(email = "pat@example.test", accept = false, at: Date = NOW) {
  const result = await submitWizard(prisma, { when, contact: contact(email), details }, at);
  if (accept) await acceptQuote(prisma, { token: result.token, note: "" }, at);
  const row = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: result.requestId } });
  return { id: row.id, version: row.version, token: result.token };
}

const confirmDetails = (overrides: Record<string, unknown> = {}) =>
  confirmInputSchema(TODAY).parse({ eventDate: SATURDAY, startTime: "20:00", endTime: "00:00", loadInTime: "18:30", sets: "4", agreedPrice: "$1,500", note: "", ...overrides });

async function expectCode(promise: Promise<unknown>, code: BookingAdminError["code"]) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof BookingAdminError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.pricingSettings.create({ data: { id: 1 } });
  await prisma.rateRule.create({ data: { eventType: "BAR_CLUB", dayCategory: "FRI_SAT", ratePerSetCents: 40_000 } });
  admin = { id: (await prisma.user.create({ data: { id: randomUUID(), email: "a@example.test", name: "Erik", role: "ADMIN" } })).id, role: "ADMIN" };
  member = { id: (await prisma.user.create({ data: { id: randomUUID(), email: "m@example.test", name: "Jake", role: "MEMBER" } })).id, role: "MEMBER" };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("confirm", () => {
  it("turns an accepted quote into a Booked date with the agreed details", async () => {
    const accepted = await request("pat@example.test", true);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("pending");
    await confirmBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, details: confirmDetails() }, NOW);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("booked");
    expect(await prisma.bookingRequest.findUniqueOrThrow({ where: { id: accepted.id } })).toMatchObject({
      status: "CONFIRMED", agreedPriceCents: 150_000, loadInTime: "18:30", confirmedById: admin.id,
    });
    expect((await getRequestForProspect(prisma, accepted.token, NOW))?.status).toBe("CONFIRMED");
  });

  it("is Admin-only and version-checked", async () => {
    const accepted = await request("pat@example.test", true);
    await expectCode(confirmBooking(prisma, { actor: member, requestId: accepted.id, version: accepted.version, details: confirmDetails() }, NOW), "FORBIDDEN");
    await expectCode(confirmBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version - 1, details: confirmDetails() }, NOW), "CONFLICT");
  });

  it("two Admins confirming at once: exactly one succeeds", async () => {
    const accepted = await request("pat@example.test", true);
    const results = await Promise.allSettled([
      confirmBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, details: confirmDetails() }, NOW),
      confirmBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, details: confirmDetails({ agreedPrice: "9" }) }, NOW),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("refuses to take another request's date without an override, then bumps it with one", async () => {
    const first = await request("first@example.test", true);
    const second = await request("second@example.test");
    const attempt = confirmBooking(prisma, { actor: admin, requestId: second.id, version: second.version, details: confirmDetails() }, NOW);
    await expect(attempt).rejects.toSatisfy((error) => error instanceof BookingAdminError && error.code === "NEEDS_OVERRIDE" && error.holder?.id === first.id);

    const result = await confirmBooking(
      prisma,
      { actor: admin, requestId: second.id, version: second.version, details: confirmDetails({ overrideReason: "Bigger gig" }) },
      NOW,
    );
    expect(result.releasedRequestId).toBe(first.id);
    expect(await prisma.bookingRequest.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "RELEASED", isConflict: true });
    expect(await prisma.dateClaim.findFirstOrThrow()).toMatchObject({ requestId: second.id, kind: "BOOKED" });
    expect(await prisma.auditLog.count({ where: { action: "booking.override" } })).toBe(1);
  });

  it("moves the claim when the date changes on confirm", async () => {
    const accepted = await request("pat@example.test", true);
    await confirmBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, details: confirmDetails({ eventDate: "2026-11-21" }) }, NOW);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("available");
    expect(await publicDayState(prisma, "2026-11-21", TODAY, NOW)).toBe("booked");
  });
});

describe("decline, cancel", () => {
  it("declining an accepted request frees its date", async () => {
    const accepted = await request("pat@example.test", true);
    await declineByBand(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, reason: "Double-booked" }, NOW);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("available");
    expect((await prisma.bookingRequest.findUniqueOrThrow({ where: { id: accepted.id } })).status).toBe("DECLINED_BY_BAND");
  });

  it("cancelling a confirmed booking frees the date; only confirmed bookings can be cancelled", async () => {
    const accepted = await request("pat@example.test", true);
    await expectCode(cancelBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, reason: "x" }, NOW), "INVALID_STATE");
    await confirmBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version, details: confirmDetails() }, NOW);
    await cancelBooking(prisma, { actor: admin, requestId: accepted.id, version: accepted.version + 1, reason: "Venue closed" }, NOW);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("available");
  });
});

describe("manual quotes", () => {
  it("quotes a contact-path request, supersedes old quotes, and the prospect can accept it", async () => {
    const result = await submitWizard(prisma, { when: { ...when, eventType: "WEDDING" }, contact: contact("w@example.test"), details }, NOW);
    expect(result.outcome).toBe("AWAITING_CONTACT");
    const row = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: result.requestId } });
    const quote = manualQuoteSchema(TODAY).parse({ eventDate: SATURDAY, sets: "3", ratePerSet: "700", validHours: "48" });
    const sent = await sendManualQuote(prisma, { actor: admin, requestId: row.id, version: row.version, quote }, NOW);
    expect(sent.totalCents).toBe(210_000);
    expect((await getRequestForProspect(prisma, result.token, NOW))?.quote?.totalCents).toBe(210_000);
    expect((await acceptQuote(prisma, { token: result.token, note: "" }, NOW)).outcome).toBe("ACCEPTED");
  });

  it("is Admin-only", async () => {
    const pending = await request();
    const quote = manualQuoteSchema(TODAY).parse({ eventDate: SATURDAY, sets: "3", ratePerSet: "700", validHours: "48" });
    await expectCode(sendManualQuote(prisma, { actor: member, requestId: pending.id, version: pending.version, quote }, NOW), "FORBIDDEN");
  });
});

describe("holds", () => {
  it("shows Pending, blocks other accepts, and expires on its own", async () => {
    const held = await request("held@example.test");
    const other = await request("other@example.test");
    const { expiresAt } = await placeHold(prisma, { actor: admin, requestId: held.id, version: held.version, days: 7 }, NOW);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("pending");
    expect((await acceptQuote(prisma, { token: other.token, note: "" }, NOW)).outcome).toBe("DATE_TAKEN");

    const later = new Date(expiresAt.getTime() + 1);
    expect(await publicDayState(prisma, SATURDAY, TODAY, later)).toBe("available");
    // A new request after the hold lapsed gets a quote and can take the date.
    const third = await request("third@example.test", false, later);
    expect((await acceptQuote(prisma, { token: third.token, note: "" }, later)).outcome).toBe("ACCEPTED");
  });

  it("can be released", async () => {
    const held = await request();
    await placeHold(prisma, { actor: admin, requestId: held.id, version: held.version, days: 3 }, NOW);
    await releaseHold(prisma, { actor: admin, requestId: held.id, version: held.version + 1 }, NOW);
    expect(await publicDayState(prisma, SATURDAY, TODAY, NOW)).toBe("available");
  });
});

describe("notes", () => {
  it("members can add notes; logging contact moves 'needs contact' to 'contacted'", async () => {
    const result = await submitWizard(prisma, { when: { ...when, eventType: "WEDDING" }, contact: contact("w@example.test"), details }, NOW);
    await addBookingNote(prisma, { actor: member, requestId: result.requestId, kind: "NOTE", body: "Bride's cousin knows Jim" }, NOW);
    await addBookingNote(prisma, { actor: member, requestId: result.requestId, kind: "CONTACTED", body: "Called, left voicemail" }, NOW);
    expect((await prisma.bookingRequest.findUniqueOrThrow({ where: { id: result.requestId } })).status).toBe("CONTACTED");
    expect(await prisma.bookingEvent.count({ where: { requestId: result.requestId, authorId: member.id } })).toBe(3);
  });
});
