import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { rateKey } from "@/lib/booking/eligibility";
import {
  DEFAULT_PRICING,
  PricingError,
  addSpecialDate,
  clearAllRates,
  getPricing,
  pricingInputSchema,
  removeSpecialDate,
  savePricing,
} from "@/lib/booking/pricing";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
let admin: { id: string; role: "ADMIN" };

const form = (overrides: Record<string, unknown> = {}) =>
  pricingInputSchema.parse({
    version: "1",
    minSets: "1",
    maxSets: "4",
    quoteValidityHours: "72",
    minNoticeDays: "7",
    travelRadiusMiles: "60",
    originZip: "68508",
    rates: { "WEDDING:FRI_SAT": "$1,200", "BAR_CLUB:FRI_SAT": "400", "BAR_CLUB:SUN_THU": "" },
    ...overrides,
  });

async function expectCode(promise: Promise<unknown>, code: PricingError["code"]) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof PricingError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase(prisma);
  const user = await prisma.user.create({ data: { id: randomUUID(), email: "a@example.test", name: "Admin", role: "ADMIN" } });
  admin = { id: user.id, role: "ADMIN" };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pricing", () => {
  it("defaults to no rates and the agreed rules", async () => {
    const pricing = await getPricing(prisma);
    expect(pricing.settings).toEqual(DEFAULT_PRICING);
    expect(pricing.rates.size).toBe(0);
  });

  it("saves rules and rates in cents; blanks mean no rate", async () => {
    const version = await savePricing(prisma, { actor: admin, pricing: form({ travelRadiusMiles: "55" }) });
    const pricing = await getPricing(prisma);
    expect(version).toBe(2);
    expect(pricing.settings.travelRadiusMiles).toBe(55);
    expect(pricing.rates.get(rateKey("WEDDING", "FRI_SAT"))).toBe(120_000);
    expect(pricing.rates.get(rateKey("BAR_CLUB", "FRI_SAT"))).toBe(40_000);
    expect(pricing.rates.has(rateKey("BAR_CLUB", "SUN_THU"))).toBe(false);
  });

  it("removes a rate when its cell is cleared and never stores rates for Other", async () => {
    await savePricing(prisma, { actor: admin, pricing: form({ rates: { "WEDDING:FRI_SAT": "1000", "OTHER:FRI_SAT": "50" } }) });
    await savePricing(prisma, { actor: admin, pricing: form({ version: "2", rates: { "WEDDING:FRI_SAT": "" } }) });
    expect((await getPricing(prisma)).rates.size).toBe(0);
  });

  it("rejects stale saves", async () => {
    await savePricing(prisma, { actor: admin, pricing: form() });
    await expectCode(savePricing(prisma, { actor: admin, pricing: form() }), "CONFLICT");
  });

  it("works even if the settings row is missing (falls back to defaults)", async () => {
    // resetDatabase truncates the seeded row, which is exactly this case.
    expect(await prisma.pricingSettings.count()).toBe(0);
    await savePricing(prisma, { actor: admin, pricing: form() });
    expect(await prisma.pricingSettings.count()).toBe(1);
  });

  it("audits before/after including rates", async () => {
    await savePricing(prisma, { actor: admin, pricing: form() });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "pricing.update" } });
    expect(audit.after).toMatchObject({ travelRadiusMiles: 60, rates: { "WEDDING:FRI_SAT": 120_000 } });
  });

  it("clears every rate in one action", async () => {
    await savePricing(prisma, { actor: admin, pricing: form() });
    expect(await clearAllRates(prisma, { actor: admin })).toBe(2);
    expect((await getPricing(prisma)).rates.size).toBe(0);
  });
});

describe("pricing input validation", () => {
  it("rejects bad numbers, inverted set ranges, bad ZIPs, and unknown cells", () => {
    const parse = (overrides: Record<string, unknown>) => pricingInputSchema.safeParse({ ...form(), version: "1", rates: {}, ...overrides });
    expect(parse({ maxSets: "0" }).success).toBe(false);
    expect(parse({ minSets: "3", maxSets: "2" }).success).toBe(false);
    expect(parse({ travelRadiusMiles: "501" }).success).toBe(false);
    expect(parse({ originZip: "6850" }).success).toBe(false);
    expect(parse({ rates: { "WEDDING:FRI_SAT": "12.50" } }).success).toBe(false);
    expect(parse({ rates: { "WEDDING:FRI_SAT": "-5" } }).success).toBe(false);
    expect(parse({ rates: { "HACK:FRI_SAT": "5" } }).success).toBe(false);
  });

  it("the database refuses out-of-range values even if validation is bypassed", async () => {
    await expect(prisma.rateRule.create({ data: { eventType: "WEDDING", dayCategory: "FRI_SAT", ratePerSetCents: 0 } })).rejects.toThrow();
    await expect(prisma.pricingSettings.create({ data: { id: 1, minSets: 3, maxSets: 2 } })).rejects.toThrow();
    await expect(prisma.pricingSettings.create({ data: { id: 2 } })).rejects.toThrow();
  });
});

describe("special dates", () => {
  it("adds, rejects duplicates, lists in order, and removes", async () => {
    await addSpecialDate(prisma, { actor: admin, date: "2027-12-31", label: "New Year's Eve" });
    await addSpecialDate(prisma, { actor: admin, date: "2027-07-04", label: "Fourth of July" });
    await expectCode(addSpecialDate(prisma, { actor: admin, date: "2027-12-31", label: "Again" }), "DUPLICATE");
    expect((await getPricing(prisma)).specialDates.map((special) => special.date)).toEqual(["2027-07-04", "2027-12-31"]);
    await removeSpecialDate(prisma, { actor: admin, date: "2027-07-04" });
    await expectCode(removeSpecialDate(prisma, { actor: admin, date: "2027-07-04" }), "NOT_FOUND");
  });
});
