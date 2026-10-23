import { z } from "zod";
import { type IsoDate, calendarHorizon, compareDates, isIsoDate } from "../dates";
import { emailSchema, personNameSchema } from "../users/validation";
import { EVENT_TYPES } from "./eligibility";

/** Booking form validation (requirements BOOK-3, BOOK-9, BOOK-26). Shared by client and server. */

export const RESPONSE_NOTE_MAX = 250;
export const MESSAGE_MAX = 1_000;

/** "HH:MM" in 15-minute steps (requirements §6.3). */
export const timeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Pick a time in 15-minute steps");

/** Minutes from start to end; an end at or before the start means after midnight. */
export function performanceMinutes(start: string, end: string): number {
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const diff = toMinutes(end) - toMinutes(start);
  return diff <= 0 ? diff + 24 * 60 : diff;
}

/** BOOK-28: roughly one set per hour including breaks. */
export function suggestedSets(start: string, end: string, maxSets: number): number {
  return Math.max(1, Math.min(maxSets, Math.round(performanceMinutes(start, end) / 60)));
}

/** True if the chosen sets clearly don't fit the time range (warn, don't block). */
export function setsMismatch(start: string, end: string, sets: number): boolean {
  const hours = performanceMinutes(start, end) / 60;
  return sets > hours + 0.5 || sets < hours - 1.5;
}

const US_STATE = /^(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/;

/** US phone, normalized to "(402) 555-0123". */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""))
  .refine((digits) => /^[2-9]\d{2}[2-9]\d{6}$/.test(digits), "Enter a 10-digit US phone number")
  .transform((digits) => `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);

const plainText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer`)
    // Control characters other than newlines/tabs are never legitimate here.
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), `${label} contains invalid characters`);

export const eventTypeSchema = z.enum(EVENT_TYPES as [string, ...string[]], "Choose an event type").transform((value) => value as (typeof EVENT_TYPES)[number]);

/** Event date within the public window. */
export function eventDateSchema(today: IsoDate) {
  return z
    .string()
    .trim()
    .refine(isIsoDate, "Choose a date")
    .refine((date) => compareDates(date, today) >= 0, "That date has passed")
    .refine((date) => compareDates(date, calendarHorizon(today)) <= 0, "We book up to 18 months out");
}

export function whenSchema(today: IsoDate, rules: { minSets: number; maxSets: number }) {
  return z.strictObject({
    flexible: z.boolean(),
    eventDate: z.string().trim().optional(),
    startTime: timeSchema,
    endTime: timeSchema,
    sets: z.coerce.number().int("Whole sets only").min(rules.minSets, `At least ${rules.minSets} set`).max(rules.maxSets, `At most ${rules.maxSets} sets`),
    eventType: eventTypeSchema,
  }).superRefine((value, ctx) => {
    if (value.startTime === value.endTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be different from start time" });
    if (value.flexible) return;
    const date = eventDateSchema(today).safeParse(value.eventDate ?? "");
    if (!date.success) ctx.addIssue({ code: "custom", path: ["eventDate"], message: date.error.issues[0]?.message ?? "Choose a date" });
  });
}

export const contactSchema = z.strictObject({
  contactName: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  organization: plainText(120, "Venue or organization"),
  street: plainText(160, "Street address"),
  city: plainText(80, "City").pipe(z.string().min(1, "Enter the city")),
  state: z.string().trim().toUpperCase().regex(US_STATE, "Use the 2-letter state code (e.g. NE)"),
  zip: z.string().trim().regex(/^\d{5}$/, "Enter a 5-digit ZIP code"),
});

export const detailsSchema = z.strictObject({
  attendance: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value)))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= 100_000), "Enter a whole number, or leave blank"),
  setting: z.enum(["INDOOR", "OUTDOOR", "UNSURE"]),
  soundProvided: z.enum(["YES", "NO", "PARTIAL", "UNSURE"]),
  message: plainText(MESSAGE_MAX, "Message"),
});

export type WhenInput = z.infer<ReturnType<typeof whenSchema>>;
export type ContactInput = z.infer<typeof contactSchema>;
export type DetailsInput = z.infer<typeof detailsSchema>;

export const responseNoteSchema = plainText(RESPONSE_NOTE_MAX, "Note");

/** BOOK-26: contact the band about a Pending/Booked date, or generally. */
export function dateContactSchema(today: IsoDate) {
  return z.strictObject({
    eventDate: z.union([z.literal(""), eventDateSchema(today)]),
    contactName: personNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    organization: plainText(120, "Venue or organization"),
    eventType: eventTypeSchema,
    message: plainText(MESSAGE_MAX, "Message").pipe(z.string().min(1, "Tell us a little about the event")),
  });
}

export type DateContactInput = z.infer<ReturnType<typeof dateContactSchema>>;
