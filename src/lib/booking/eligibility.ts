import type { DayCategory, EventType } from "@/generated/prisma/enums";
import { type IsoDate, compareDates, daysBetween, dayOfWeek } from "../dates";

/**
 * Instant-quote eligibility (requirements §6.5). Pure: every input is passed in, so the
 * rules can be tested exhaustively. A request gets an instant quote only if ALL hold;
 * otherwise it goes to the "we'll contact you" path. The prospect is never told why.
 */

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  BAR_CLUB: "Bar / club",
  FESTIVAL: "Festival",
  WEDDING: "Wedding",
  GRADUATION: "Graduation",
  PRIVATE_PARTY: "Private party",
  CORPORATE: "Corporate",
  OTHER: "Other",
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as EventType[];

export const DAY_CATEGORY_LABELS: Record<DayCategory, string> = {
  SUN_THU: "Sun–Thu",
  FRI_SAT: "Fri–Sat",
  SPECIAL: "Holiday / special dates",
};

export const DAY_CATEGORIES = Object.keys(DAY_CATEGORY_LABELS) as DayCategory[];

export interface PricingRules {
  readonly minSets: number;
  readonly maxSets: number;
  readonly minNoticeDays: number;
  readonly travelRadiusMiles: number;
}

export type RateTable = ReadonlyMap<string, number>;

export function rateKey(eventType: EventType, dayCategory: DayCategory): string {
  return `${eventType}:${dayCategory}`;
}

/** Day category from the event date (RATE-2): Special if listed, else Fri/Sat vs. Sun–Thu. */
export function dayCategoryOf(date: IsoDate, specialDates: ReadonlySet<IsoDate>): DayCategory {
  if (specialDates.has(date)) return "SPECIAL";
  const weekday = dayOfWeek(date);
  return weekday === 5 || weekday === 6 ? "FRI_SAT" : "SUN_THU";
}

/** Why a request didn't get an instant quote. Internal only (Admins see it, prospects don't). */
export type IneligibleReason =
  | "NO_RATE"
  | "TOO_SOON"
  | "TOO_FAR"
  | "LOCATION_UNKNOWN"
  | "DATE_NOT_OPEN"
  | "SETS_OUT_OF_RANGE";

export const INELIGIBLE_REASON_LABELS: Record<IneligibleReason, string> = {
  NO_RATE: "No rate set for this event type and day",
  TOO_SOON: "Less than the minimum notice",
  TOO_FAR: "Outside the travel radius",
  LOCATION_UNKNOWN: "ZIP code not found",
  DATE_NOT_OPEN: "Date isn't open (pending, booked, or unavailable)",
  SETS_OUT_OF_RANGE: "Number of sets outside the allowed range",
};

export interface EligibilityInput {
  readonly date: IsoDate;
  readonly today: IsoDate;
  readonly eventType: EventType;
  readonly sets: number;
  /** Null when the venue ZIP isn't in the table. */
  readonly distanceMiles: number | null;
  /** Whether the date is Available or Limited right now. */
  readonly dateIsOpen: boolean;
  readonly rules: PricingRules;
  readonly rates: RateTable;
  readonly specialDates: ReadonlySet<IsoDate>;
}

export type EligibilityResult =
  | {
      readonly eligible: true;
      readonly dayCategory: DayCategory;
      readonly ratePerSetCents: number;
      readonly totalCents: number;
    }
  | { readonly eligible: false; readonly dayCategory: DayCategory; readonly reasons: readonly IneligibleReason[] };

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const dayCategory = dayCategoryOf(input.date, input.specialDates);
  const reasons: IneligibleReason[] = [];

  const rate = input.rates.get(rateKey(input.eventType, dayCategory));
  if (rate === undefined || input.eventType === "OTHER") reasons.push("NO_RATE");
  if (compareDates(input.date, input.today) < 0 || daysBetween(input.today, input.date) < input.rules.minNoticeDays) {
    reasons.push("TOO_SOON");
  }
  if (input.distanceMiles === null) reasons.push("LOCATION_UNKNOWN");
  else if (input.distanceMiles > input.rules.travelRadiusMiles) reasons.push("TOO_FAR");
  if (!input.dateIsOpen) reasons.push("DATE_NOT_OPEN");
  if (!Number.isInteger(input.sets) || input.sets < input.rules.minSets || input.sets > input.rules.maxSets) {
    reasons.push("SETS_OUT_OF_RANGE");
  }

  if (reasons.length > 0 || rate === undefined) return { eligible: false, dayCategory, reasons };
  return { eligible: true, dayCategory, ratePerSetCents: rate, totalCents: rate * input.sets };
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}
