import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/site-chrome";
import { publicDayState } from "@/lib/availability/service";
import { getPricing } from "@/lib/booking/pricing";
import { calendarHorizon, compareDates, formatLongDate, isIsoDate, monthOf, todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { DateContactForm } from "./date-contact-form";
import { BookingWizard } from "./wizard";

export const metadata: Metadata = {
  title: "Request a date",
  description: "Request a date with The Leftovers.",
  robots: { index: false, follow: true },
};

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ date?: string; flexible?: string }> }) {
  const params = await searchParams;
  const today = todayInBandTimeZone();
  const { settings } = await getPricing(db());
  const date = params.date && isIsoDate(params.date) && compareDates(params.date, today) >= 0 && compareDates(params.date, calendarHorizon(today)) <= 0 ? params.date : null;
  const state = date ? await publicDayState(db(), date, today) : null;

  if (date && state === "unavailable") {
    return (
      <PageBody title="Date unavailable">
        <p>{formatLongDate(date)} isn&apos;t available.</p>
        <p className="mt-4">
          <Link href={`/book?month=${monthOf(date)}`} className="underline">
            Pick another date
          </Link>
        </p>
      </PageBody>
    );
  }

  // BOOK-26: Pending/Booked dates can't go through the wizard; talk to the band instead.
  if (date && (state === "pending" || state === "booked")) {
    return (
      <PageBody title="Contact the band about this date">
        <p className="leading-relaxed">
          {formatLongDate(date)} is currently <strong>{state === "booked" ? "booked" : "pending"}</strong>. Tell us about your
          event and someone from The Leftovers will get back to you.
        </p>
        <DateContactForm date={date} />
      </PageBody>
    );
  }

  return (
    <PageBody title="Request a date">
      <BookingWizard
        today={today}
        horizon={calendarHorizon(today)}
        initialDate={date}
        initialFlexible={!date && params.flexible === "1"}
        minSets={settings.minSets}
        maxSets={settings.maxSets}
      />
    </PageBody>
  );
}
