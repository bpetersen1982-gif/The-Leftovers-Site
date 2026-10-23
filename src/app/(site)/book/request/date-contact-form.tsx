"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/booking/eligibility";
import { type DateContactState, dateContactAction } from "../actions";
import { Field, Honeypot, PUBLIC_INPUT, fieldAria } from "./form-bits";

const INITIAL: DateContactState = { ok: false, message: null };

/** BOOK-26: "Contact the band about this date". Also used for general booking questions. */
export function DateContactForm({ date }: { date: string | null }) {
  const [state, dispatch, pending] = useActionState(dateContactAction, INITIAL);
  const error = (name: string) => state.fieldErrors?.[name];

  // Manual dispatch so typed input survives a validation error (no automatic form reset).
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };

  if (state.ok) {
    return (
      <div role="status" className="panel-paper mt-6 px-5 py-5">
        <p className="font-heading text-xl font-bold uppercase">Request sent</p>
        <p className="mt-2">{state.message}</p>
        <p className="mt-2">
          Your reference is <strong>{state.reference}</strong>. We emailed you a copy.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="panel-paper relative mt-6 grid gap-4 px-5 py-5 sm:grid-cols-2">
      <input type="hidden" name="eventDate" value={date ?? ""} />
      <Honeypot />
      <Field id="dc-name" label="Your name" error={error("contactName")}>
        <input name="contactName" autoComplete="name" maxLength={80} className={PUBLIC_INPUT} {...fieldAria("dc-name", error("contactName"))} />
      </Field>
      <Field id="dc-org" label="Venue or organization (optional)" error={error("organization")}>
        <input name="organization" autoComplete="organization" maxLength={120} className={PUBLIC_INPUT} {...fieldAria("dc-org", error("organization"))} />
      </Field>
      <Field id="dc-email" label="Email" error={error("email")}>
        <input name="email" type="email" autoComplete="email" maxLength={254} className={PUBLIC_INPUT} {...fieldAria("dc-email", error("email"))} />
      </Field>
      <Field id="dc-phone" label="Phone" error={error("phone")}>
        <input name="phone" type="tel" autoComplete="tel" maxLength={20} className={PUBLIC_INPUT} {...fieldAria("dc-phone", error("phone"))} />
      </Field>
      <Field id="dc-type" label="Event type" error={error("eventType")}>
        <select name="eventType" defaultValue="" className={PUBLIC_INPUT} {...fieldAria("dc-type", error("eventType"))}>
          <option value="" disabled>
            Choose…
          </option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {EVENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field id="dc-message" label="Tell us about the event" error={error("message")}>
          <textarea name="message" rows={5} maxLength={1000} className={PUBLIC_INPUT} {...fieldAria("dc-message", error("message"))} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Sending…" : "Send to the band"}
        </button>
        {state.message && (
          <p role="alert" className="font-semibold text-red-ui">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
