import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { publicDayState } from "@/lib/availability/service";
import {
  BookingError,
  acceptQuote,
  createDateContact,
  declineQuote,
  getRequestForProspect,
  saveDraft,
  submitWizard,
} from "@/lib/booking/requests";
import type { ContactInput, DetailsInput, WhenInput } from "@/lib/booking/validation";
import { addDays, todayInBandTimeZone } from "@/lib/dates";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const NOW = new Date("2026-10-23T15:00:00Z");
const TODAY = todayInBandTimeZone(NOW); // 2026-10-23 (Friday)
const SATURDAY = "2026-11-14";

const when = (overrides: Partial<WhenInput> = {}): WhenInput => ({
  flexible: false,
  eventDate: SATURDAY,
  startTime: "20:00",
  endTime: "00:00",
  sets: 4,
  eventType: "BAR_CLUB",
  ...overrides,
});
const contact = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  contactName: "Pat Venue",
  email: "pat@example.test",
  phone: "(402) 555-0123",
  organization: "The Zoo Bar",
  street: "136 N 14th St",
  city: "Lincoln",
  state: "NE",
  zip: "68508",
  ...overrides,
});
const details: DetailsInput = { attendance: 150, setting: "INDOOR", soundProvided: "YES", message: "" };

async function expectCode(promise: Promise<unknown>, code: BookingError["code"]) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof BookingError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await prisma.pricingSettings.create({ data: { id: 1 } });
  await prisma.rateRule.create({ data: { eventType: "BAR_CLUB", dayCategory: "FRI_SAT", ratePerSetCents: 40_000 } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("submitWizard", () => {
  it("quotes sets × rate with a 72-hour expiry when every rule passes", async () => {
    const result = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    expect(result).toMatchObject({ outcome: "QUOTED", isConflict: false, quote: { ratePerSetCents: 40_000, sets: 4, totalCents: 160_000 } });
    expect(result.quote?.expiresAt.getTime()).toBe(NOW.getTime() + 72 * 3_600_000);
    expect(result.reference).toMatch(/^LO-[2-9A-HJ-NP-Z]{6}$/);
    const stored = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: result.requestId } });
    expect(stored.accessTokenHash).not.toBe(result.token);
    expect(stored.distanceMiles).toBeLessThan(1);
  });

  it("sends ineligible requests to the contact path and records why (internally)", async () => {
    const far = await submitWizard(prisma, { when: when(), contact: contact({ zip: "68801" }), details }, NOW);
    expect(far).toMatchObject({ outcome: "AWAITING_CONTACT", quote: null, ineligibleReasons: ["TOO_FAR"] });
    const soon = await submitWizard(prisma, { when: when({ eventDate: addDays(TODAY, 3) }), contact: contact(), details }, NOW);
    expect(soon.ineligibleReasons).toContain("TOO_SOON");
    const noRate = await submitWizard(prisma, { when: when({ eventType: "WEDDING" }), contact: contact(), details }, NOW);
    expect(noRate.ineligibleReasons).toEqual(["NO_RATE"]);
    const flexible = await submitWizard(prisma, { when: when({ flexible: true, eventDate: undefined }), contact: contact(), details }, NOW);
    expect(flexible).toMatchObject({ outcome: "AWAITING_CONTACT", quote: null });
  });

  it("refuses band-wide unavailable dates", async () => {
    const admin = await prisma.user.create({ data: { id: randomUUID(), email: "a@example.test", name: "A", role: "ADMIN" } });
    await prisma.availabilityBlock.create({
      data: { scope: "BAND", startDate: new Date(`${SATURDAY}T00:00:00Z`), endDate: new Date(`${SATURDAY}T00:00:00Z`), createdById: admin.id },
    });
    await expectCode(submitWizard(prisma, { when: when(), contact: contact(), details }, NOW), "DATE_UNAVAILABLE");
  });

  it("flags a second request for the same date as a conflict", async () => {
    await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    const second = await submitWizard(prisma, { when: when(), contact: contact({ email: "other@example.test" }), details }, NOW);
    expect(second.isConflict).toBe(true);
  });

  it("finishes the step-2 draft instead of creating a duplicate", async () => {
    const draft = await saveDraft(prisma, { when: when(), contact: contact() });
    expect(await prisma.bookingRequest.count({ where: { status: "IN_PROGRESS" } })).toBe(1);
    expect(await getRequestForProspect(prisma, draft.token, NOW)).toBeNull();
    const result = await submitWizard(prisma, { draftToken: draft.token, when: when(), contact: contact(), details }, NOW);
    expect(result.token).toBe(draft.token);
    expect(await prisma.bookingRequest.count()).toBe(1);
  });
});

describe("responding to a quote", () => {
  it("accepting claims the date as Pending and is single-use", async () => {
    const { token } = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    expect(await acceptQuote(prisma, { token, note: "See you there" }, NOW)).toMatchObject({ outcome: "ACCEPTED" });
    expect(await publicDayState(prisma, SATURDAY, TODAY)).toBe("pending");
    expect(await getRequestForProspect(prisma, token, NOW)).toMatchObject({ status: "ACCEPTED", responseNote: "See you there" });
    await expectCode(acceptQuote(prisma, { token, note: "" }, NOW), "ALREADY_RESPONDED");
  });

  it("two prospects accepting the same date at once: exactly one gets it", async () => {
    const a = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    const b = await submitWizard(prisma, { when: when(), contact: contact({ email: "b@example.test" }), details }, NOW);
    const results = await Promise.all([acceptQuote(prisma, { token: a.token, note: "" }, NOW), acceptQuote(prisma, { token: b.token, note: "" }, NOW)]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["ACCEPTED", "DATE_TAKEN"]);
    expect(await prisma.dateClaim.count()).toBe(1);
    const loser = results.find((result) => result.outcome === "DATE_TAKEN");
    expect(await prisma.bookingRequest.findUniqueOrThrow({ where: { id: loser?.requestId } })).toMatchObject({ status: "AWAITING_CONTACT", isConflict: true });
  });

  it("refuses to accept after the quote expires, or after the band blocks the date", async () => {
    const { token } = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    const later = new Date(NOW.getTime() + 72 * 3_600_000 + 1);
    await expectCode(acceptQuote(prisma, { token, note: "" }, later), "EXPIRED");
    expect((await getRequestForProspect(prisma, token, later))?.status).toBe("EXPIRED");

    const other = await submitWizard(prisma, { when: when(), contact: contact({ email: "c@example.test" }), details }, NOW);
    const admin = await prisma.user.create({ data: { id: randomUUID(), email: "a@example.test", name: "A", role: "ADMIN" } });
    await prisma.availabilityBlock.create({
      data: { scope: "BAND", startDate: new Date(`${SATURDAY}T00:00:00Z`), endDate: new Date(`${SATURDAY}T00:00:00Z`), createdById: admin.id },
    });
    expect((await acceptQuote(prisma, { token: other.token, note: "" }, NOW)).outcome).toBe("DATE_TAKEN");
    expect(await prisma.dateClaim.count()).toBe(0);
  });

  it("declining records the note and frees nothing", async () => {
    const { token } = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    await declineQuote(prisma, { token, note: "Over budget" }, NOW);
    expect(await getRequestForProspect(prisma, token, NOW)).toMatchObject({ status: "DECLINED_BY_PROSPECT", responseNote: "Over budget" });
    expect(await publicDayState(prisma, SATURDAY, TODAY)).toBe("available");
    await expectCode(declineQuote(prisma, { token, note: "" }, NOW), "ALREADY_RESPONDED");
  });

  it("quotes keep their price when rates change later", async () => {
    const { token } = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    await prisma.rateRule.updateMany({ data: { ratePerSetCents: 99_900 } });
    expect((await getRequestForProspect(prisma, token, NOW))?.quote?.totalCents).toBe(160_000);
  });

  it("rejects malformed and unknown tokens", async () => {
    expect(await getRequestForProspect(prisma, "nope", NOW)).toBeNull();
    await expectCode(acceptQuote(prisma, { token: "A".repeat(43), note: "" }, NOW), "NOT_FOUND");
  });
});

describe("contact about a date", () => {
  it("creates a conflict-flagged request when the date is already claimed", async () => {
    const { token } = await submitWizard(prisma, { when: when(), contact: contact(), details }, NOW);
    await acceptQuote(prisma, { token, note: "" }, NOW);
    const result = await createDateContact(
      prisma,
      { eventDate: SATURDAY, contactName: "Big Fest", email: "fest@example.test", phone: "(402) 555-0199", organization: "Fest", eventType: "FESTIVAL", message: "Headliner slot?" },
      NOW,
    );
    expect(result.isConflict).toBe(true);
    expect(await prisma.bookingRequest.findUniqueOrThrow({ where: { id: result.requestId } })).toMatchObject({ kind: "DATE_CONTACT", status: "AWAITING_CONTACT" });
  });
});

