"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import type { z } from "zod";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/booking/eligibility";
import { formatTime } from "@/lib/booking/format";
import { contactSchema, detailsSchema, setsMismatch, suggestedSets, whenSchema } from "@/lib/booking/validation";
import { formatLongDate } from "@/lib/dates";
import { type FieldErrors, type WizardStep, saveDraftAction, submitBookingAction } from "../actions";
import { Field, Honeypot, PUBLIC_INPUT, fieldAria } from "./form-bits";

const STEPS = [
  { key: "when", label: "When" },
  { key: "contact", label: "Who" },
  { key: "details", label: "Details" },
  { key: "review", label: "Review" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

/** 15-minute options across the whole day. */
const TIMES = Array.from({ length: 96 }, (_, index) => {
  const value = `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`;
  return { value, label: formatTime(value) };
});

const SETTING_LABELS = { INDOOR: "Indoor", OUTDOOR: "Outdoor", UNSURE: "Not sure yet" } as const;
const SOUND_LABELS = { YES: "Yes, sound is provided", PARTIAL: "Partly", NO: "No, the band brings sound", UNSURE: "Not sure" } as const;

function errorsOf(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

export function BookingWizard(props: {
  today: string;
  horizon: string;
  initialDate: string | null;
  initialFlexible: boolean;
  minSets: number;
  maxSets: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>("when");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // When the form was opened; too-fast submissions are treated as bots.
  const [startedAt] = useState(() => Date.now());
  const draftToken = useRef<string | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [when, setWhen] = useState({
    flexible: props.initialFlexible,
    eventDate: props.initialDate ?? "",
    startTime: "20:00",
    endTime: "00:00",
    sets: String(Math.min(4, props.maxSets)),
    eventType: "",
  });
  const [setsTouched, setSetsTouched] = useState(false);
  const [contact, setContact] = useState({ contactName: "", email: "", phone: "", organization: "", street: "", city: "", state: "NE", zip: "" });
  const [details, setDetails] = useState({ attendance: "", setting: "UNSURE", soundProvided: "UNSURE", message: "" });
  const [website, setWebsite] = useState("");

  const whenParser = whenSchema(props.today, { minSets: props.minSets, maxSets: props.maxSets });
  const whenPayload = () => ({ ...when, eventDate: when.flexible ? undefined : when.eventDate });

  function goTo(next: StepKey) {
    setErrors({});
    setFormMessage(null);
    setStep(next);
    // Move focus to the new step's heading so keyboard and screen-reader users follow along.
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function updateTimes(patch: Partial<typeof when>) {
    setWhen((current) => {
      const next = { ...current, ...patch };
      if (!setsTouched) next.sets = String(suggestedSets(next.startTime, next.endTime, props.maxSets));
      return next;
    });
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "when") {
      const parsed = whenParser.safeParse(whenPayload());
      if (!parsed.success) return setErrors(errorsOf(parsed.error));
      return goTo("contact");
    }
    if (step === "contact") {
      const parsed = contactSchema.safeParse(contact);
      if (!parsed.success) return setErrors(errorsOf(parsed.error));
      startTransition(async () => {
        // Save contact details now, so the band can follow up if the form isn't finished.
        const saved = await saveDraftAction({ token: draftToken.current, when: whenPayload(), contact });
        if (saved.ok) draftToken.current = saved.token;
        goTo("details");
      });
      return;
    }
    if (step === "details") {
      const parsed = detailsSchema.safeParse(details);
      if (!parsed.success) return setErrors(errorsOf(parsed.error));
      return goTo("review");
    }
    startTransition(async () => {
      const result = await submitBookingAction({
        draftToken: draftToken.current,
        when: whenPayload(),
        contact,
        details,
        website,
        startedAt,
      });
      if (result.ok) {
        router.push(`/booking/${result.token}`);
        return;
      }
      const target: WizardStep | undefined = result.step;
      if (target) setStep(target);
      setErrors(result.fieldErrors ?? {});
      setFormMessage(result.message);
    });
  }

  const index = STEPS.findIndex((entry) => entry.key === step);
  const mismatch = setsMismatch(when.startTime, when.endTime, Number(when.sets));
  const err = (name: string) => errors[name];

  return (
    <div className="mt-2">
      <ol aria-label="Progress" className="flex flex-wrap gap-2 font-heading text-sm tracking-wider uppercase">
        {STEPS.map((entry, position) => (
          <li
            key={entry.key}
            aria-current={entry.key === step ? "step" : undefined}
            className={`border px-3 py-1 ${entry.key === step ? "border-cream bg-cream text-ink" : position < index ? "border-cream/70" : "border-olive/60 text-cream/90"}`}
          >
            {position + 1}. {entry.label}
          </li>
        ))}
      </ol>

      <form onSubmit={next} noValidate className="panel-paper relative mt-6 space-y-5 px-5 py-6">
        <Honeypot value={website} onChange={setWebsite} />
        <h2 ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-bold tracking-wider uppercase outline-none">
          {STEPS[index]?.label}
        </h2>

        {step === "when" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field id="eventDate" label="Date" error={err("eventDate")}>
                <input
                  type="date"
                  min={props.today}
                  max={props.horizon}
                  value={when.eventDate}
                  disabled={when.flexible}
                  onChange={(event) => setWhen({ ...when, eventDate: event.target.value })}
                  className={PUBLIC_INPUT}
                  {...fieldAria("eventDate", err("eventDate"))}
                />
              </Field>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={when.flexible} onChange={(event) => setWhen({ ...when, flexible: event.target.checked })} />
                Flexible / not sure of the date yet
              </label>
            </div>
            <Field id="startTime" label="Start" error={err("startTime")}>
              <select value={when.startTime} onChange={(event) => updateTimes({ startTime: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("startTime", err("startTime"))}>
                {TIMES.map((time) => (
                  <option key={time.value} value={time.value}>{time.label}</option>
                ))}
              </select>
            </Field>
            <Field id="endTime" label="End" hint="Can be after midnight." error={err("endTime")}>
              <select value={when.endTime} onChange={(event) => updateTimes({ endTime: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("endTime", err("endTime"), true)}>
                {TIMES.map((time) => (
                  <option key={time.value} value={time.value}>{time.label}</option>
                ))}
              </select>
            </Field>
            <Field id="sets" label="Number of sets" hint="1 set is about an hour, with breaks." error={err("sets")}>
              <select
                value={when.sets}
                onChange={(event) => {
                  setSetsTouched(true);
                  setWhen({ ...when, sets: event.target.value });
                }}
                className={PUBLIC_INPUT}
                {...fieldAria("sets", err("sets"), true)}
              >
                {Array.from({ length: props.maxSets - props.minSets + 1 }, (_, offset) => props.minSets + offset).map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
            </Field>
            <Field id="eventType" label="Event type" error={err("eventType")}>
              <select value={when.eventType} onChange={(event) => setWhen({ ...when, eventType: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("eventType", err("eventType"))}>
                <option value="" disabled>Choose…</option>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>{EVENT_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </Field>
            {mismatch && (
              <p role="status" className="text-sm sm:col-span-2">
                Heads up: {when.sets} set{when.sets === "1" ? "" : "s"} may not fit {formatTime(when.startTime)}–{formatTime(when.endTime)}. You can still send it; we&apos;ll sort it out.
              </p>
            )}
          </div>
        )}

        {step === "contact" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm sm:col-span-2">We save this information so the band can follow up with you.</p>
            {(
              [
                ["contactName", "Your name", "name", "text", 80],
                ["organization", "Venue or organization (optional)", "organization", "text", 120],
                ["email", "Email", "email", "email", 254],
                ["phone", "Phone", "tel", "tel", 20],
                ["street", "Venue street address (optional)", "street-address", "text", 160],
                ["city", "City", "address-level2", "text", 80],
                ["state", "State", "address-level1", "text", 2],
                ["zip", "ZIP code", "postal-code", "text", 5],
              ] as const
            ).map(([name, label, autoComplete, type, max]) => (
              <Field key={name} id={name} label={label} error={err(name)}>
                <input
                  type={type}
                  autoComplete={autoComplete}
                  inputMode={name === "zip" ? "numeric" : undefined}
                  maxLength={max}
                  value={contact[name]}
                  onChange={(event) => setContact({ ...contact, [name]: event.target.value })}
                  className={PUBLIC_INPUT}
                  {...fieldAria(name, err(name))}
                />
              </Field>
            ))}
          </div>
        )}

        {step === "details" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="attendance" label="Expected attendance (optional)" error={err("attendance")}>
              <input inputMode="numeric" maxLength={6} value={details.attendance} onChange={(event) => setDetails({ ...details, attendance: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("attendance", err("attendance"))} />
            </Field>
            <Field id="setting" label="Indoor or outdoor" error={err("setting")}>
              <select value={details.setting} onChange={(event) => setDetails({ ...details, setting: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("setting", err("setting"))}>
                {Object.entries(SETTING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field id="soundProvided" label="Is sound / PA provided?" error={err("soundProvided")}>
                <select value={details.soundProvided} onChange={(event) => setDetails({ ...details, soundProvided: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("soundProvided", err("soundProvided"))}>
                  {Object.entries(SOUND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field id="message" label="Anything else? (optional)" hint="Song requests, load-in, special occasions." error={err("message")}>
                <textarea rows={4} maxLength={1000} value={details.message} onChange={(event) => setDetails({ ...details, message: event.target.value })} className={PUBLIC_INPUT} {...fieldAria("message", err("message"), true)} />
              </Field>
            </div>
          </div>
        )}

        {step === "review" && (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="font-heading tracking-wide uppercase">Date</dt>
            <dd>{when.flexible || !when.eventDate ? "Flexible" : formatLongDate(when.eventDate)}</dd>
            <dt className="font-heading tracking-wide uppercase">Time</dt>
            <dd>{formatTime(when.startTime)}–{formatTime(when.endTime)}, {when.sets} set{when.sets === "1" ? "" : "s"}</dd>
            <dt className="font-heading tracking-wide uppercase">Event</dt>
            <dd>{when.eventType ? EVENT_TYPE_LABELS[when.eventType as (typeof EVENT_TYPES)[number]] : ""}</dd>
            <dt className="font-heading tracking-wide uppercase">Contact</dt>
            <dd>{contact.contactName}, {contact.email}, {contact.phone}</dd>
            <dt className="font-heading tracking-wide uppercase">Where</dt>
            <dd>{[contact.organization, contact.street, contact.city, `${contact.state} ${contact.zip}`].filter(Boolean).join(", ")}</dd>
          </dl>
        )}

        {formMessage && (
          <p role="alert" className="font-semibold text-red-ui">
            {formMessage}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4 pt-2">
          {index > 0 && (
            <button type="button" onClick={() => goTo(STEPS[index - 1]?.key ?? "when")} disabled={pending} className="border-2 border-ink px-4 py-2 font-heading font-semibold tracking-wider uppercase disabled:opacity-60">
              Back
            </button>
          )}
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
            {pending ? "Working…" : step === "review" ? "Send request" : "Next"}
          </button>
        </div>
      </form>
    </div>
  );
}
