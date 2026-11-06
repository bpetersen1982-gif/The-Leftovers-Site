"use client";

import { useId } from "react";
import { type ActionState, INITIAL_ACTION_STATE } from "./action-state";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS } from "./form-ui";
import { useActionForm } from "./use-action-form";

/**
 * Admin-only copyright takedown (LEG-3). Used after an Admin reviews a notice emailed to
 * copyright@ and judges it legitimate. Records who sent it and what they claim.
 */
export function TakedownForm({
  id,
  version,
  today,
  action,
  noun,
}: {
  id: string;
  version: number;
  today: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  noun: "photo" | "video";
}) {
  const [state, onSubmit, pending] = useActionForm(action, INITIAL_ACTION_STATE);
  const prefix = useId();
  const errors = state.fieldErrors;
  const field = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    className: DARK_INPUT_CLASS,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return (
    <details>
      <summary className="cursor-pointer text-sm underline">Copyright takedown</summary>
      <form
        onSubmit={(event) => {
          if (!window.confirm(`Take this ${noun} down and record the copyright notice?`)) {
            event.preventDefault();
            return;
          }
          onSubmit(event);
        }}
        className="mt-3 space-y-3"
      >
        <p className="text-sm">Fill this in from the notice emailed to copyright@. The {noun} comes off the site right away.</p>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="version" value={version} />
        <div>
          <label htmlFor={`${prefix}-senderName`} className={LABEL_CLASS}>
            Sent by
          </label>
          <input {...field("senderName")} maxLength={120} placeholder="Person or company" />
          <FieldError id={`${prefix}-senderName-error`} message={errors?.senderName} />
        </div>
        <div>
          <label htmlFor={`${prefix}-senderEmail`} className={LABEL_CLASS}>
            Their email
          </label>
          <input {...field("senderEmail")} type="email" maxLength={254} />
          <FieldError id={`${prefix}-senderEmail-error`} message={errors?.senderEmail} />
        </div>
        <div>
          <label htmlFor={`${prefix}-workClaimed`} className={LABEL_CLASS}>
            Work they claim
          </label>
          <input {...field("workClaimed")} maxLength={300} placeholder="e.g. their photograph, a song recording" />
          <FieldError id={`${prefix}-workClaimed-error`} message={errors?.workClaimed} />
        </div>
        <div>
          <label htmlFor={`${prefix}-receivedOn`} className={LABEL_CLASS}>
            Date received
          </label>
          <input {...field("receivedOn")} type="date" max={today} defaultValue={today} />
          <FieldError id={`${prefix}-receivedOn-error`} message={errors?.receivedOn} />
        </div>
        <div>
          <label htmlFor={`${prefix}-notes`} className={LABEL_CLASS}>
            Notes (optional)
          </label>
          <textarea {...field("notes")} rows={2} maxLength={1000} />
          <FieldError id={`${prefix}-notes-error`} message={errors?.notes} />
        </div>
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          Take down
        </button>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </details>
  );
}
