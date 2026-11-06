"use client";

import { useId } from "react";
import { INITIAL_ACTION_STATE } from "../action-state";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { createShowAction, deleteShowAction, showFromBookingAction, updateShowAction } from "./actions";

export interface EditableShow {
  readonly id: string;
  readonly version: number;
  readonly date: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly venueName: string;
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly ticketUrl: string | null;
  readonly priceText: string;
  readonly description: string;
  readonly status: "SCHEDULED" | "SOLD_OUT" | "CANCELLED";
  readonly isPublic: boolean;
}

function Fields({ show, errors }: { show?: EditableShow; errors?: Partial<Record<string, string>> }) {
  const prefix = useId();
  const field = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    className: DARK_INPUT_CLASS,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  const label = (name: string, text: string) => (
    <label htmlFor={`${prefix}-${name}`} className={LABEL_CLASS}>
      {text}
    </label>
  );
  const error = (name: string) => <FieldError id={`${prefix}-${name}-error`} message={errors?.[name]} />;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        {label("date", "Date")}
        <input {...field("date")} type="date" required defaultValue={show?.date} />
        {error("date")}
      </div>
      <div>
        {label("startTime", "Starts (optional)")}
        <input {...field("startTime")} type="time" step={900} defaultValue={show?.startTime ?? ""} />
        {error("startTime")}
      </div>
      <div>
        {label("endTime", "Ends (optional)")}
        <input {...field("endTime")} type="time" step={900} defaultValue={show?.endTime ?? ""} />
        {error("endTime")}
      </div>
      <div className="sm:col-span-3">
        {label("venueName", "Venue")}
        <input {...field("venueName")} required maxLength={120} defaultValue={show?.venueName} placeholder="e.g. Zoo Bar" />
        {error("venueName")}
      </div>
      <div>
        {label("street", "Street (optional)")}
        <input {...field("street")} maxLength={120} defaultValue={show?.street} />
        {error("street")}
      </div>
      <div>
        {label("city", "City")}
        <input {...field("city")} required maxLength={80} defaultValue={show?.city ?? "Lincoln"} />
        {error("city")}
      </div>
      <div>
        {label("state", "State")}
        <input {...field("state")} required maxLength={2} defaultValue={show?.state ?? "NE"} className={`${DARK_INPUT_CLASS} uppercase`} />
        {error("state")}
      </div>
      <div className="sm:col-span-2">
        {label("ticketUrl", "Ticket link (optional)")}
        <input {...field("ticketUrl")} type="url" maxLength={500} defaultValue={show?.ticketUrl ?? ""} placeholder="https://" />
        {error("ticketUrl")}
      </div>
      <div>
        {label("priceText", "Price (optional)")}
        <input {...field("priceText")} maxLength={60} defaultValue={show?.priceText} placeholder="Free, $10 at the door" />
        {error("priceText")}
      </div>
      <div className="sm:col-span-3">
        {label("description", "Description (optional)")}
        <textarea {...field("description")} rows={3} maxLength={1000} defaultValue={show?.description} />
        {error("description")}
      </div>
      <div>
        {label("status", "Status")}
        <select {...field("status")} defaultValue={show?.status ?? "SCHEDULED"}>
          <option value="SCHEDULED">Scheduled</option>
          <option value="SOLD_OUT">Sold out</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      <label className="flex items-center gap-2 self-end pb-2 sm:col-span-2">
        <input type="checkbox" name="isPublic" defaultChecked={show?.isPublic ?? true} className="size-5" />
        Show on the public Shows page (leave off for weddings and private parties)
      </label>
    </div>
  );
}

export function CreateShowForm() {
  const [state, onSubmit, pending] = useActionForm(createShowAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Fields errors={state.fieldErrors} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        Add show
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function EditShowForm({ show }: { show: EditableShow }) {
  const [state, onSubmit, pending] = useActionForm(updateShowAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="id" value={show.id} />
      <input type="hidden" name="version" value={show.version} />
      <Fields show={show} errors={state.fieldErrors} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        Save show
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function DeleteShowForm({ show }: { show: Pick<EditableShow, "id" | "version" | "venueName"> }) {
  const [state, onSubmit, pending] = useActionForm(deleteShowAction, INITIAL_ACTION_STATE);
  return (
    <form
      onSubmit={(event) => {
        if (!window.confirm(`Delete the ${show.venueName} show? Linked albums and videos stay.`)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <input type="hidden" name="id" value={show.id} />
      <input type="hidden" name="version" value={show.version} />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        Delete show
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

/** On a confirmed booking: one click to list it as a show (BOOK-20). */
export function ShowFromBookingButton({ bookingId }: { bookingId: string }) {
  const [state, onSubmit, pending] = useActionForm(showFromBookingAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        Create show from this booking
      </button>
      <p className="text-sm text-cream/90">Weddings and private parties start as private (band only). You can change that on the show.</p>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
