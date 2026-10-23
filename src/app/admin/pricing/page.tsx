import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { getPricing } from "@/lib/booking/pricing";
import { SAMPLE_TOWNS, milesBetweenZips } from "@/lib/booking/zip-distance";
import { formatLongDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { AddSpecialDateForm, ClearRatesForm, PricingForm, RemoveSpecialDateButton } from "./pricing-forms";

export const metadata: Metadata = { title: "Pricing" };

export default async function PricingPage() {
  await requirePermission("pricing:manage");
  const pricing = await getPricing(db());
  const { settings } = pricing;
  const towns = await Promise.all(
    SAMPLE_TOWNS.map(async (town) => ({ ...town, miles: await milesBetweenZips(settings.originZip, town.zip) })),
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Pricing &amp; booking rules</h1>
        <p className="mt-2 text-cream/90">
          A request gets an instant quote only when a rate is set for its event type and day, the venue is inside the travel
          radius, and the date is far enough out. Everything else gets “someone from The Leftovers will contact you.” Changes
          apply to new quotes only; quotes already sent keep their price.
        </p>
      </div>

      <PricingForm
        initial={{
          version: settings.version,
          minSets: settings.minSets,
          maxSets: settings.maxSets,
          quoteValidityHours: settings.quoteValidityHours,
          minNoticeDays: settings.minNoticeDays,
          travelRadiusMiles: settings.travelRadiusMiles,
          originZip: settings.originZip,
          rates: Object.fromEntries([...pricing.rates].map(([key, cents]) => [key, cents / 100])),
        }}
      />

      <section aria-labelledby="radius-heading">
        <h2 id="radius-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          What {settings.travelRadiusMiles} miles from {settings.originZip} covers
        </h2>
        <p className="mt-1 text-sm text-cream/90">Straight-line distance from the saved settings. Driving distance is usually longer.</p>
        <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {towns.map((town) => {
            const inside = town.miles !== null && town.miles <= settings.travelRadiusMiles;
            return (
              <li key={town.zip}>
                {town.name}: {town.miles === null ? "unknown" : `${Math.round(town.miles)} mi`} &middot;{" "}
                <strong>{inside ? "instant quote" : "contact path"}</strong>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="special-heading" className="space-y-4">
        <h2 id="special-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Holiday / special dates
        </h2>
        <p className="text-sm text-cream/90">These dates use the “Holiday / special dates” column instead of their weekday price.</p>
        {pricing.specialDates.length === 0 ? (
          <p>None yet.</p>
        ) : (
          <ul className="divide-y divide-olive/50 border-y border-olive/50">
            {pricing.specialDates.map((special) => (
              <li key={special.date} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <strong>{special.label}</strong> &middot; {formatLongDate(special.date)}
                </span>
                <RemoveSpecialDateButton date={special.date} label={special.label} />
              </li>
            ))}
          </ul>
        )}
        <AddSpecialDateForm />
      </section>

      <section aria-labelledby="clear-heading" className="space-y-3 border-t border-olive/60 pt-6">
        <h2 id="clear-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Stop showing prices
        </h2>
        <p className="text-sm text-cream/90">Removes every rate at once. Every request then gets “we&apos;ll contact you.”</p>
        <ClearRatesForm hasRates={pricing.rates.size > 0} />
      </section>
    </div>
  );
}
