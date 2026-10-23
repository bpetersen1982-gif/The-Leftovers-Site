"use client";

import { useActionForm } from "../use-action-form";
import { useState } from "react";
import type { DayCategory, EventType } from "@/generated/prisma/enums";
import { DAY_CATEGORIES, DAY_CATEGORY_LABELS, EVENT_TYPES, EVENT_TYPE_LABELS, rateKey } from "@/lib/booking/eligibility";
import { INITIAL_ACTION_STATE } from "../action-state";
import type { SaveState } from "../content-actions";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { addSpecialDateAction, clearRatesAction, removeSpecialDateAction, savePricingAction } from "./actions";

export interface PricingFormValues {
  readonly version: number;
  readonly minSets: number;
  readonly maxSets: number;
  readonly quoteValidityHours: number;
  readonly minNoticeDays: number;
  readonly travelRadiusMiles: number;
  readonly originZip: string;
  /** rateKey -> whole dollars */
  readonly rates: Readonly<Record<string, number>>;
}

const RULE_FIELDS = [
  { name: "travelRadiusMiles", label: "Travel radius (miles)", help: "Venues farther than this get “we'll contact you.”", min: 1, max: 500 },
  { name: "originZip", label: "Measured from ZIP", help: "Default 68508 (Lincoln), the band's central point.", min: 0, max: 0 },
  { name: "minNoticeDays", label: "Minimum notice (days)", help: "Closer dates get “we'll contact you.”", min: 0, max: 365 },
  { name: "quoteValidityHours", label: "Quote valid for (hours)", help: "72 hours = 3 days.", min: 1, max: 720 },
  { name: "minSets", label: "Minimum sets", help: "1 set ≈ 1 hour.", min: 1, max: 8 },
  { name: "maxSets", label: "Maximum sets", help: "4 sets ≈ 4–4.5 hours.", min: 1, max: 8 },
] as const;

export function PricingForm({ initial }: { initial: PricingFormValues }) {
  const [state, formAction, pending] = useActionForm<SaveState>(savePricingAction, {
    ok: false,
    message: null,
    version: initial.version,
  });
  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <form onSubmit={formAction} noValidate className="space-y-8">
      <input type="hidden" name="version" value={state.version ?? initial.version} />

      <fieldset>
        <legend className="font-heading text-xl font-bold tracking-wider uppercase">Rules</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RULE_FIELDS.map((field) => (
            <div key={field.name}>
              <label htmlFor={field.name} className={LABEL_CLASS}>
                {field.label}
              </label>
              <input
                id={field.name}
                name={field.name}
                inputMode="numeric"
                defaultValue={initial[field.name]}
                maxLength={field.name === "originZip" ? 5 : 3}
                aria-invalid={Boolean(error(field.name))}
                aria-describedby={`${field.name}-help${error(field.name) ? ` ${field.name}-error` : ""}`}
                className={DARK_INPUT_CLASS}
              />
              <p id={`${field.name}-help`} className="mt-1 text-sm text-cream/90">
                {field.help}
              </p>
              <FieldError id={`${field.name}-error`} message={error(field.name)} />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-heading text-xl font-bold tracking-wider uppercase">Price per set</legend>
        <p className="mt-1 text-sm text-cream/90">
          Whole dollars. Leave a cell blank to require a quote: those requests get “someone from the band will contact you”
          and never see a price. Anyone who completes the booking form sees the rate for their combination.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left">
            <caption className="sr-only">Price per set by event type and day</caption>
            <thead className="font-heading tracking-wider uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3">Event type</th>
                {DAY_CATEGORIES.map((day) => (
                  <th key={day} scope="col" className="py-2 pr-3">{DAY_CATEGORY_LABELS[day]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENT_TYPES.map((eventType) => (
                <tr key={eventType} className="border-t border-olive/40">
                  <th scope="row" className="py-2 pr-3 font-normal">{EVENT_TYPE_LABELS[eventType]}</th>
                  {DAY_CATEGORIES.map((day) => (
                    <td key={day} className="py-2 pr-3 align-top">
                      <RateCell eventType={eventType} day={day} initial={initial.rates[rateKey(eventType, day)]} error={error(`rate.${rateKey(eventType, day)}`)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Saving…" : "Save pricing"}
        </button>
        <FormMessage ok={state.ok} message={state.message} />
      </div>
    </form>
  );
}

function RateCell({ eventType, day, initial, error }: { eventType: EventType; day: DayCategory; initial?: number; error?: string }) {
  const id = `rate-${eventType}-${day}`;
  const label = `${EVENT_TYPE_LABELS[eventType]}, ${DAY_CATEGORY_LABELS[day]}, dollars per set`;
  if (eventType === "OTHER") {
    return <span className="text-sm text-cream/90">Always a quote</span>;
  }
  return (
    <>
      <div className="flex items-center gap-1">
        <span aria-hidden="true">$</span>
        <input id={id} name={`rate.${rateKey(eventType, day)}`} inputMode="numeric" maxLength={7} defaultValue={initial ?? ""}
          aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          placeholder="quote" className={`${DARK_INPUT_CLASS} w-24`} />
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </>
  );
}

export function ClearRatesForm({ hasRates }: { hasRates: boolean }) {
  const [state, formAction, pending] = useActionForm(clearRatesAction, INITIAL_ACTION_STATE);
  if (!hasRates && !state.ok) return <p className="text-cream/90">No rates are set. Every request gets “we&apos;ll contact you.”</p>;
  return (
    <form onSubmit={formAction} className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="confirm" value="yes" required />
        Confirm
      </label>
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {pending ? "Clearing…" : "Clear all rates"}
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function AddSpecialDateForm() {
  const [state, formAction, pending] = useActionForm(addSpecialDateAction, INITIAL_ACTION_STATE);
  const [seen, setSeen] = useState(state);
  const [resetKey, setResetKey] = useState(0);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setResetKey((key) => key + 1);
  }
  const error = (name: string) => state.fieldErrors?.[name];
  return (
    <form key={resetKey} onSubmit={formAction} noValidate className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
      <div>
        <label htmlFor="special-date" className={LABEL_CLASS}>Date</label>
        <input id="special-date" name="date" type="date" className={DARK_INPUT_CLASS} aria-describedby={error("date") ? "special-date-error" : undefined} />
        <FieldError id="special-date-error" message={error("date")} />
      </div>
      <div>
        <label htmlFor="special-label" className={LABEL_CLASS}>Name</label>
        <input id="special-label" name="label" maxLength={60} placeholder="New Year's Eve" className={DARK_INPUT_CLASS}
          aria-describedby={error("label") ? "special-label-error" : undefined} />
        <FieldError id="special-label-error" message={error("label")} />
      </div>
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        {pending ? "Adding…" : "Add date"}
      </button>
      <div className="sm:col-span-3">
        <FormMessage ok={state.ok} message={state.message} />
      </div>
    </form>
  );
}

export function RemoveSpecialDateButton({ date, label }: { date: string; label: string }) {
  const [state, formAction, pending] = useActionForm(removeSpecialDateAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={formAction} className="flex items-center gap-3">
      <input type="hidden" name="date" value={date} />
      <button type="submit" disabled={pending} aria-label={`Remove ${label}`} className={SECONDARY_BUTTON}>
        {pending ? "Removing…" : "Remove"}
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
