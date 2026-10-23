/**
 * Calendar-date helpers. Booking works in calendar days in the band's timezone
 * (requirements BOOK-21), so dates are handled as "YYYY-MM-DD" strings and computed
 * with UTC arithmetic on those strings: no local-timezone or DST surprises.
 */

export const BAND_TIME_ZONE = "America/Chicago";

/** Public calendar horizon (requirements BOOK-1). */
export const CALENDAR_MONTHS_AHEAD = 18;

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Today's date in the band's timezone. */
export function todayInBandTimeZone(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: BAND_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const value = toUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return fromUtc(value);
}

/** Adds months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "YYYY-MM" of a date. */
export function monthOf(date: IsoDate): string {
  return date.slice(0, 7);
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Last date of the public calendar window (inclusive). */
export function calendarHorizon(today: IsoDate): IsoDate {
  return addDays(addMonths(today, CALENDAR_MONTHS_AHEAD), -1);
}

/** Month keys from today's month through the horizon month. */
export function calendarMonths(today: IsoDate): string[] {
  const months: string[] = [];
  const last = monthOf(calendarHorizon(today));
  for (let cursor = `${monthOf(today)}-01`; monthOf(cursor) <= last; cursor = addMonths(cursor, 1)) {
    months.push(monthOf(cursor));
  }
  return months;
}

/** Every date in a month. */
export function datesInMonth(monthKey: string): IsoDate[] {
  const first = `${monthKey}-01`;
  const dates: IsoDate[] = [];
  for (let cursor = first; monthOf(cursor) === monthKey; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return toUtc(date).getUTCDay();
}

/**
 * Month grid as weeks (Sunday first). Cells outside the month are null.
 */
export function monthGrid(monthKey: string): (IsoDate | null)[][] {
  const dates = datesInMonth(monthKey);
  const cells: (IsoDate | null)[] = [...Array<null>(dayOfWeek(dates[0] as IsoDate)).fill(null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

const LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function formatLongDate(date: IsoDate): string {
  return LONG.format(toUtc(date));
}

export function formatShortDate(date: IsoDate): string {
  return SHORT.format(toUtc(date));
}

export function formatMonth(monthKey: string): string {
  return MONTH.format(toUtc(`${monthKey}-01`));
}

/** "Sat, Jun 12, 2027" or "Sat, Jun 12 – Mon, Jun 14, 2027". */
export function formatDateRange(start: IsoDate, end: IsoDate): string {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** Prisma @db.Date values come back as UTC-midnight Dates. */
export function toDbDate(date: IsoDate): Date {
  return toUtc(date);
}
