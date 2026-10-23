import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/site-chrome";
import { PUBLIC_DAY_LABELS, type PublicDayState, publicDayStates } from "@/lib/availability/service";
import { getSiteSettings } from "@/lib/content/service";
import {
  type IsoDate,
  calendarHorizon,
  calendarMonths,
  compareDates,
  datesInMonth,
  formatLongDate,
  formatMonth,
  isMonthKey,
  monthGrid,
  monthOf,
  todayInBandTimeZone,
} from "@/lib/dates";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Book the band",
  description: "Check The Leftovers' availability and request a date. Lincoln, NE 90s & 2000s rock cover band.",
  alternates: { canonical: "/book" },
};

const WEEKDAYS = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
] as const;

/** Visible short labels: state is always shown as text, never by color alone (A11Y-2). */
const SHORT_LABELS: Record<PublicDayState, string> = {
  available: "Open",
  limited: "Limited",
  unavailable: "Unavailable",
  past: "",
};

const CELL_STYLES: Record<PublicDayState, string> = {
  available: "border-cream/70 bg-charcoal hover:bg-cream hover:text-ink",
  limited: "border-olive bg-olive/30 hover:bg-cream hover:text-ink",
  unavailable: "border-transparent bg-ink/60 text-cream/90",
  past: "border-transparent text-cream/50",
};

const REQUESTABLE: ReadonlySet<PublicDayState> = new Set(["available", "limited"]);

function requestHref(bookingEmail: string, date: IsoDate): string {
  const subject = `Booking request: ${formatLongDate(date)}`;
  const body = `Hi Leftovers,\n\nWe'd like to book you for ${formatLongDate(date)}.\n\nVenue / event:\nCity:\nStart and end time:\nNumber of sets:\nPhone:\n`;
  return `mailto:${bookingEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default async function BookPage({ searchParams }: { searchParams: Promise<{ month?: string; view?: string }> }) {
  const params = await searchParams;
  const today = todayInBandTimeZone();
  const months = calendarMonths(today);
  const month = params.month && isMonthKey(params.month) && months.includes(params.month) ? params.month : (months[0] as string);
  const view = params.view === "list" ? "list" : "month";
  const horizon = calendarHorizon(today);

  const days = datesInMonth(month);
  const [states, settings] = await Promise.all([
    publicDayStates(db(), { from: days[0] as IsoDate, to: days.at(-1) as IsoDate }, today),
    getSiteSettings(db()),
  ]);
  // Dates past the 18-month window are shown as unavailable to request.
  const stateOf = (date: IsoDate): PublicDayState =>
    compareDates(date, horizon) > 0 ? "unavailable" : (states.get(date) ?? "unavailable");

  const index = months.indexOf(month);
  const previous = months[index - 1];
  const next = months[index + 1];
  const link = (target: { month?: string; view?: string }) => {
    const query = new URLSearchParams({ month: target.month ?? month, ...(target.view ?? view) === "list" ? { view: "list" } : {} });
    return `/book?${query.toString()}`;
  };

  return (
    <PageBody title="Book the band">
      <p className="leading-relaxed">
        Pick an open date to send us a request. We play bars, clubs, festivals, weddings, graduations, private parties, and
        corporate events. Dates are open up to 18 months out.
      </p>

      <dl className="mt-6 grid gap-2 text-sm sm:grid-cols-3">
        <div className="flex items-baseline gap-2">
          <dt className="font-heading tracking-wider uppercase">Open</dt>
          <dd>Available to book.</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="font-heading tracking-wider uppercase">Limited</dt>
          <dd>Still bookable. We&apos;ll confirm the lineup with you.</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="font-heading tracking-wider uppercase">Unavailable</dt>
          <dd>Not taking requests.</dd>
        </div>
      </dl>

      <nav aria-label="Calendar months" className="mt-8 flex flex-wrap items-center justify-between gap-4">
        {previous ? (
          <Link href={link({ month: previous })} className="underline">
            ← {formatMonth(previous)}
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
        <form action="/book" method="get" className="flex items-center gap-2">
          <label htmlFor="month" className="sr-only">
            Jump to month
          </label>
          <select id="month" name="month" defaultValue={month} className="border-2 border-cream/60 bg-charcoal px-2 py-1">
            {months.map((key) => (
              <option key={key} value={key}>
                {formatMonth(key)}
              </option>
            ))}
          </select>
          {view === "list" && <input type="hidden" name="view" value="list" />}
          <button type="submit" className="border border-cream/70 px-3 py-1 font-heading tracking-wider uppercase hover:bg-cream hover:text-ink">
            Go
          </button>
        </form>
        {next ? (
          <Link href={link({ month: next })} className="underline">
            {formatMonth(next)} →
          </Link>
        ) : (
          <span aria-hidden="true" />
        )}
      </nav>

      <p className="mt-4 text-sm">
        {view === "month" ? (
          <Link href={link({ view: "list" })} className="underline">
            Show as a list
          </Link>
        ) : (
          <Link href={link({ view: "month" })} className="underline">
            Show as a calendar
          </Link>
        )}
      </p>

      <h2 className="mt-4 font-heading text-2xl font-bold tracking-wider uppercase">{formatMonth(month)}</h2>

      {view === "month" ? (
        <table className="mt-3 w-full table-fixed border-separate border-spacing-1 text-center">
          <caption className="sr-only">Availability for {formatMonth(month)}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map(([short, long]) => (
                <th key={short} scope="col" className="font-heading text-xs tracking-wider uppercase sm:text-sm">
                  <abbr title={long} className="no-underline">
                    {short}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(month).map((week, weekIndex) => (
              <tr key={weekIndex}>
                {week.map((date, dayIndex) => {
                  if (!date) return <td key={dayIndex} />;
                  const state = stateOf(date);
                  const day = Number(date.slice(8));
                  const fullLabel = `${formatLongDate(date)}: ${PUBLIC_DAY_LABELS[state]}`;
                  const content = (
                    <>
                      <span className="block font-heading text-lg">{day}</span>
                      <span className="block text-[0.6rem] leading-tight tracking-wide uppercase sm:text-xs">{SHORT_LABELS[state]}</span>
                    </>
                  );
                  const cell = `block min-h-14 border px-1 py-1 sm:min-h-16 ${CELL_STYLES[state]}`;
                  return (
                    <td key={date} className="p-0 align-top">
                      {REQUESTABLE.has(state) ? (
                        <a href={requestHref(settings.bookingEmail, date)} aria-label={`${fullLabel}. Request this date.`} className={cell}>
                          {content}
                        </a>
                      ) : (
                        <span aria-label={fullLabel} className={cell}>
                          {content}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mt-3 divide-y divide-olive/50 border-y border-olive/50">
          {days
            .filter((date) => stateOf(date) !== "past")
            .map((date) => {
              const state = stateOf(date);
              return (
                <li key={date} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span>
                    {formatLongDate(date)} &middot; <strong>{PUBLIC_DAY_LABELS[state]}</strong>
                  </span>
                  {REQUESTABLE.has(state) && (
                    <a href={requestHref(settings.bookingEmail, date)} className="underline" aria-label={`Request ${formatLongDate(date)}`}>
                      Request this date
                    </a>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      <p className="mt-8 text-sm">
        Date not listed, or flexible?{" "}
        <a href={`mailto:${settings.bookingEmail}`} className="underline">
          Email {settings.bookingEmail}
        </a>
        . Requests open your email app with the date filled in; an online booking form is coming soon.
      </p>
      {monthOf(today) === month && <p className="sr-only">Today is {formatLongDate(today)}.</p>}
    </PageBody>
  );
}
