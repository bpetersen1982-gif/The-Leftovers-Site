import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DayCategory, EventType } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { type IsoDate, fromUtc, isIsoDate, toDbDate } from "../dates";
import { DAY_CATEGORIES, EVENT_TYPES, type PricingRules, type RateTable, rateKey } from "./eligibility";

/**
 * Pricing settings, the rate grid, and special dates (requirements BOOK-3, RATE-1..5, ELIG-2a).
 * Admin-only; every change is audited with before/after values.
 */

export const MAX_RATE_DOLLARS = 100_000;

export interface PricingSettingsView extends PricingRules {
  readonly quoteValidityHours: number;
  readonly originZip: string;
  readonly version: number;
}

export const DEFAULT_PRICING: PricingSettingsView = {
  minSets: 1,
  maxSets: 4,
  quoteValidityHours: 72,
  minNoticeDays: 7,
  travelRadiusMiles: 60,
  originZip: "68508",
  version: 1,
};

export interface PricingSnapshot {
  readonly settings: PricingSettingsView;
  readonly rates: RateTable;
  readonly specialDates: readonly { date: IsoDate; label: string }[];
}

export class PricingError extends Error {
  override readonly name = "PricingError";
  constructor(readonly code: "CONFLICT" | "NOT_FOUND" | "DUPLICATE") {
    super(
      code === "CONFLICT"
        ? "Someone else changed pricing while you were editing. Reload and try again."
        : code === "DUPLICATE"
          ? "That date is already on the list."
          : "That item no longer exists.",
    );
  }
}

/** Works with the full client or a transaction client. */
type PricingReader = Pick<PrismaClient, "pricingSettings" | "rateRule" | "specialDate">;

export async function getPricing(prisma: PricingReader): Promise<PricingSnapshot> {
  const [row, rates, specials] = await Promise.all([
    prisma.pricingSettings.findUnique({ where: { id: 1 } }),
    prisma.rateRule.findMany(),
    prisma.specialDate.findMany({ orderBy: { date: "asc" } }),
  ]);
  return {
    settings: row
      ? {
          minSets: row.minSets,
          maxSets: row.maxSets,
          quoteValidityHours: row.quoteValidityHours,
          minNoticeDays: row.minNoticeDays,
          travelRadiusMiles: row.travelRadiusMiles,
          originZip: row.originZip,
          version: row.version,
        }
      : DEFAULT_PRICING,
    rates: new Map(rates.map((rate) => [rateKey(rate.eventType, rate.dayCategory), rate.ratePerSetCents])),
    specialDates: specials.map((special) => ({ date: fromUtc(special.date), label: special.label })),
  };
}

// ---------------------------------------------------------------- validation

const wholeNumber = (label: string, min: number, max: number) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);

/** Blank = no rate (contact path). Otherwise whole dollars, stored as cents. */
const rateDollars = z
  .string()
  .trim()
  .transform((value) => value.replace(/[$,\s]/g, ""))
  .refine((value) => value === "" || /^\d+$/.test(value), "Whole dollars only (e.g. 400)")
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || (value >= 1 && value <= MAX_RATE_DOLLARS), `Between $1 and $${MAX_RATE_DOLLARS.toLocaleString("en-US")}`)
  .transform((value) => (value === null ? null : value * 100));

export const pricingInputSchema = z
  .strictObject({
    version: z.coerce.number().int().min(1),
    minSets: wholeNumber("Minimum sets", 1, 8),
    maxSets: wholeNumber("Maximum sets", 1, 8),
    quoteValidityHours: wholeNumber("Quote validity", 1, 720),
    minNoticeDays: wholeNumber("Minimum notice", 0, 365),
    travelRadiusMiles: wholeNumber("Travel radius", 1, 500),
    originZip: z.string().trim().regex(/^\d{5}$/, "Enter a 5-digit ZIP code"),
    rates: z.record(z.string(), rateDollars),
  })
  .superRefine((value, ctx) => {
    if (value.maxSets < value.minSets) ctx.addIssue({ code: "custom", path: ["maxSets"], message: "Maximum sets can't be less than minimum" });
    for (const key of Object.keys(value.rates)) {
      const [eventType, dayCategory] = key.split(":");
      if (!EVENT_TYPES.includes(eventType as EventType) || !DAY_CATEGORIES.includes(dayCategory as DayCategory)) {
        ctx.addIssue({ code: "custom", path: ["rates", key], message: "Unknown rate cell" });
      }
    }
  });

export type PricingInput = z.infer<typeof pricingInputSchema>;

export const specialDateInputSchema = z.strictObject({
  date: z.string().trim().refine(isIsoDate, "Enter a valid date"),
  label: z.string().trim().min(1, "Give it a name (e.g. New Year's Eve)").max(60, "60 characters or fewer"),
});

// ---------------------------------------------------------------- writes

interface RequestMeta {
  readonly requestId?: string | null;
}

function ratesAsRecord(rates: RateTable): Record<string, number> {
  return Object.fromEntries([...rates.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Saves rules and the full rate grid atomically, with optimistic concurrency. */
export async function savePricing(
  prisma: PrismaClient,
  input: { actor: AuditActor; pricing: PricingInput } & RequestMeta,
): Promise<number> {
  const { version, rates, ...rules } = input.pricing;
  return prisma.$transaction(async (tx) => {
    const before = await getPricing(tx);
    const existing = await tx.pricingSettings.findUnique({ where: { id: 1 } });
    if (!existing) {
      if (version !== DEFAULT_PRICING.version) throw new PricingError("CONFLICT");
      await tx.pricingSettings.create({ data: { id: 1, ...rules, version: 2 } });
    } else {
      const updated = await tx.pricingSettings.updateMany({ where: { id: 1, version }, data: { ...rules, version: { increment: 1 } } });
      if (updated.count !== 1) throw new PricingError("CONFLICT");
    }

    for (const eventType of EVENT_TYPES) {
      for (const dayCategory of DAY_CATEGORIES) {
        const cents = rates[rateKey(eventType, dayCategory)] ?? null;
        // "Other" always goes to the contact path, whatever is submitted.
        if (cents === null || eventType === "OTHER") {
          await tx.rateRule.deleteMany({ where: { eventType, dayCategory } });
        } else {
          await tx.rateRule.upsert({
            where: { eventType_dayCategory: { eventType, dayCategory } },
            create: { eventType, dayCategory, ratePerSetCents: cents },
            update: { ratePerSetCents: cents },
          });
        }
      }
    }

    const after = await getPricing(tx);
    await writeAudit(tx, {
      actor: input.actor,
      action: "pricing.update",
      targetType: "pricing",
      targetId: "1",
      before: { ...before.settings, rates: ratesAsRecord(before.rates) },
      after: { ...after.settings, rates: ratesAsRecord(after.rates) },
      requestId: input.requestId,
    });
    return after.settings.version;
  });
}

/** RATE-4: one click switches the whole site to "we'll contact you". */
export async function clearAllRates(prisma: PrismaClient, input: { actor: AuditActor } & RequestMeta): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.rateRule.findMany();
    const removed = await tx.rateRule.deleteMany({});
    await writeAudit(tx, {
      actor: input.actor,
      action: "pricing.clearRates",
      targetType: "pricing",
      targetId: "1",
      before: { rates: Object.fromEntries(before.map((rate) => [rateKey(rate.eventType, rate.dayCategory), rate.ratePerSetCents])) },
      after: { rates: {} },
      requestId: input.requestId,
    });
    return removed.count;
  });
}

export async function addSpecialDate(
  prisma: PrismaClient,
  input: { actor: AuditActor; date: IsoDate; label: string } & RequestMeta,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.specialDate.findUnique({ where: { date: toDbDate(input.date) } });
    if (existing) throw new PricingError("DUPLICATE");
    await tx.specialDate.create({ data: { date: toDbDate(input.date), label: input.label } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "specialDate.add",
      targetType: "specialDate",
      targetId: input.date,
      after: { label: input.label },
      requestId: input.requestId,
    });
  });
}

export async function removeSpecialDate(prisma: PrismaClient, input: { actor: AuditActor; date: IsoDate } & RequestMeta): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.specialDate.findUnique({ where: { date: toDbDate(input.date) } });
    if (!existing) throw new PricingError("NOT_FOUND");
    await tx.specialDate.delete({ where: { date: existing.date } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "specialDate.remove",
      targetType: "specialDate",
      targetId: input.date,
      before: { label: existing.label },
      requestId: input.requestId,
    });
  });
}
