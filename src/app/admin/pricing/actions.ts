"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { DAY_CATEGORIES, EVENT_TYPES, rateKey } from "@/lib/booking/eligibility";
import {
  PricingError,
  addSpecialDate,
  clearAllRates,
  pricingInputSchema,
  removeSpecialDate,
  savePricing,
  specialDateInputSchema,
} from "@/lib/booking/pricing";
import { lookupZip } from "@/lib/booking/zip-distance";
import { isIsoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { getRequestId } from "@/lib/request-id";
import type { ActionState } from "../action-state";
import type { SaveState } from "../content-actions";

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    // Rate cells report as "rate.EVENT:DAY" to match the form field names.
    const key = issue.path[0] === "rates" ? `rate.${String(issue.path[1])}` : String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}

function expectedFailure(error: unknown): ActionState {
  if (error instanceof PricingError) return { ok: false, message: error.message };
  throw error;
}

export async function savePricingAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const actor = await requirePermission("pricing:manage");
  const rates: Record<string, string> = {};
  for (const eventType of EVENT_TYPES) {
    for (const dayCategory of DAY_CATEGORIES) {
      const key = rateKey(eventType, dayCategory);
      rates[key] = String(formData.get(`rate.${key}`) ?? "");
    }
  }
  const parsed = pricingInputSchema.safeParse({
    version: formData.get("version"),
    minSets: formData.get("minSets"),
    maxSets: formData.get("maxSets"),
    quoteValidityHours: formData.get("quoteValidityHours"),
    minNoticeDays: formData.get("minNoticeDays"),
    travelRadiusMiles: formData.get("travelRadiusMiles"),
    originZip: formData.get("originZip"),
    rates,
  });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  if (!(await lookupZip(parsed.data.originZip))) {
    return { ok: false, message: "Fix the highlighted fields.", fieldErrors: { originZip: "That ZIP code isn't in our ZIP table" } };
  }

  try {
    const version = await savePricing(db(), { actor, pricing: parsed.data, requestId: await getRequestId() });
    const priced = Object.values(parsed.data.rates).filter((cents) => cents !== null).length;
    revalidatePath("/admin/pricing");
    return {
      ok: true,
      version,
      message:
        priced === 0
          ? "Saved. No rates are set, so every request gets “we'll contact you.”"
          : `Saved. ${priced} event/day combination${priced === 1 ? "" : "s"} now show an instant quote.`,
    };
  } catch (error) {
    return expectedFailure(error);
  }
}

export async function clearRatesAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("pricing:manage");
  if (formData.get("confirm") !== "yes") return { ok: false, message: "Check the box to confirm." };
  const removed = await clearAllRates(db(), { actor, requestId: await getRequestId() });
  revalidatePath("/admin/pricing");
  return { ok: true, message: `Cleared ${removed} rate${removed === 1 ? "" : "s"}. No prices show publicly now.` };
}

export async function addSpecialDateAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("pricing:manage");
  const parsed = specialDateInputSchema.safeParse({ date: formData.get("date"), label: formData.get("label") });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  try {
    await addSpecialDate(db(), { actor, ...parsed.data, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidatePath("/admin/pricing");
  return { ok: true, message: `Added ${parsed.data.label}.` };
}

export async function removeSpecialDateAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("pricing:manage");
  const date = String(formData.get("date") ?? "");
  if (!isIsoDate(date)) return { ok: false, message: "Invalid date." };
  try {
    await removeSpecialDate(db(), { actor, date, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidatePath("/admin/pricing");
  return { ok: true, message: "Removed." };
}
