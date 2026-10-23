"use client";

import { useState } from "react";
import { formatTime } from "@/lib/booking/format";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../../form-ui";
import { useActionForm } from "../../use-action-form";
import {
  type BookingActionState,
  addNoteAction,
  cancelAction,
  confirmAction,
  declineAction,
  holdAction,
  quoteAction,
  releaseHoldAction,
  replyAction,
} from "./actions";

const INITIAL: BookingActionState = { ok: false, message: null };

const TIMES = Array.from({ length: 96 }, (_, index) => {
  const value = `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`;
  return { value, label: formatTime(value) };
});

interface Ids {
  readonly requestId: string;
  readonly version: number;
}

function Hidden({ ids }: { ids: Ids }) {
  return (
    <>
      <input type="hidden" name="requestId" value={ids.requestId} />
      <input type="hidden" name="version" value={ids.version} />
    </>
  );
}

function Panel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border border-olive/60 px-4 py-4">
      <h2 id={id} className="font-heading text-xl font-bold tracking-wider uppercase">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function TimeSelect({ name, label, value, optional }: { name: string; label: string; value: string | null; optional?: boolean }) {
  return (
    <div>
      <label htmlFor={`confirm-${name}`} className={LABEL_CLASS}>{label}</label>
      <select id={`confirm-${name}`} name={name} defaultValue={value ?? ""} className={DARK_INPUT_CLASS}>
        {optional && <option value="">None</option>}
        {TIMES.map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}
      </select>
    </div>
  );
}

/** Override box shown after the server says the date belongs to another request (OVR-1/OVR-2). */
function OverrideField({ show }: { show: boolean | undefined }) {
  if (!show) return null;
  return (
    <div className="border-l-4 border-red-ui bg-red-ui/15 px-3 py-3">
      <label htmlFor="overrideReason" className={LABEL_CLASS}>Override: why bump the other request?</label>
      <input id="overrideReason" name="overrideReason" required maxLength={300} className={DARK_INPUT_CLASS} placeholder="e.g. Festival headliner, much bigger gig" />
      <p className="mt-1 text-sm">The other request is released, the other Admins are notified, and you&apos;ll need to call that prospect yourself.</p>
    </div>
  );
}

// ---------------------------------------------------------------- notes & replies (whole band)

export function NotePanel({ requestId }: { requestId: string }) {
  const [state, onSubmit, pending] = useActionForm(addNoteAction, INITIAL);
  const [seen, setSeen] = useState(state);
  const [resetKey, setResetKey] = useState(0);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setResetKey((key) => key + 1);
  }
  return (
    <Panel id="note-panel" title="Notes">
      <form key={resetKey} onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="requestId" value={requestId} />
        <label htmlFor="note-body" className="sr-only">Note</label>
        <textarea id="note-body" name="body" rows={3} maxLength={2000} className={DARK_INPUT_CLASS} placeholder="Internal: only the band sees this." />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" name="kind" value="NOTE" disabled={pending} className={SECONDARY_BUTTON}>Add note</button>
          <button type="submit" name="kind" value="CONTACTED" disabled={pending} className="btn-primary disabled:opacity-60">I contacted them</button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
    </Panel>
  );
}

export function ReplyPanel({ requestId, reference }: { requestId: string; reference: string }) {
  const [state, onSubmit, pending] = useActionForm(replyAction, INITIAL);
  const [seen, setSeen] = useState(state);
  const [resetKey, setResetKey] = useState(0);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setResetKey((key) => key + 1);
  }
  return (
    <Panel id="reply-panel" title="Reply by email">
      <p className="mb-3 text-sm text-cream/90">Sends from booking@ with your name signed. Their reply comes back to booking@.</p>
      <form key={resetKey} onSubmit={onSubmit} noValidate className="space-y-3">
        <input type="hidden" name="requestId" value={requestId} />
        <div>
          <label htmlFor="reply-subject" className={LABEL_CLASS}>Subject</label>
          <input id="reply-subject" name="subject" maxLength={150} defaultValue={`Your request ${reference}: The Leftovers`} className={DARK_INPUT_CLASS} />
          <FieldError id="reply-subject-error" message={state.fieldErrors?.subject} />
        </div>
        <div>
          <label htmlFor="reply-body" className={LABEL_CLASS}>Message</label>
          <textarea id="reply-body" name="body" rows={5} maxLength={5000} className={DARK_INPUT_CLASS} />
          <FieldError id="reply-body-error" message={state.fieldErrors?.body} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">{pending ? "Sending…" : "Send email"}</button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------- Admin only

export function ConfirmPanel({
  ids,
  defaults,
  isEdit,
  today,
}: {
  ids: Ids;
  defaults: { eventDate: string; startTime: string | null; endTime: string | null; loadInTime: string | null; sets: number | null; agreedPrice: number | null };
  isEdit: boolean;
  today: string;
}) {
  const [state, onSubmit, pending] = useActionForm(confirmAction, INITIAL);
  const err = (name: string) => state.fieldErrors?.[name];
  return (
    <Panel id="confirm-panel" title={isEdit ? "Edit booking details" : "Confirm booking"}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Hidden ids={ids} />
        <div>
          <label htmlFor="confirm-eventDate" className={LABEL_CLASS}>Date</label>
          <input id="confirm-eventDate" name="eventDate" type="date" min={today} defaultValue={defaults.eventDate} className={DARK_INPUT_CLASS} />
          <FieldError id="confirm-eventDate-error" message={err("eventDate")} />
        </div>
        <div>
          <label htmlFor="confirm-sets" className={LABEL_CLASS}>Sets</label>
          <input id="confirm-sets" name="sets" inputMode="numeric" defaultValue={defaults.sets ?? 4} className={DARK_INPUT_CLASS} />
          <FieldError id="confirm-sets-error" message={err("sets")} />
        </div>
        <TimeSelect name="startTime" label="Start" value={defaults.startTime ?? "20:00"} />
        <TimeSelect name="endTime" label="End" value={defaults.endTime ?? "00:00"} />
        <TimeSelect name="loadInTime" label="Load-in (optional)" value={defaults.loadInTime} optional />
        <div>
          <label htmlFor="confirm-agreedPrice" className={LABEL_CLASS}>Agreed price ($)</label>
          <input id="confirm-agreedPrice" name="agreedPrice" inputMode="numeric" defaultValue={defaults.agreedPrice !== null ? defaults.agreedPrice / 100 : ""} className={DARK_INPUT_CLASS} />
          <FieldError id="confirm-agreedPrice-error" message={err("agreedPrice")} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="confirm-note" className={LABEL_CLASS}>Internal note (optional)</label>
          <input id="confirm-note" name="note" maxLength={1000} className={DARK_INPUT_CLASS} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="emailProspect" defaultChecked={!isEdit} />
            Email them the confirmation from booking@
          </label>
          <label htmlFor="confirm-message" className={LABEL_CLASS}>Message (optional; blank = standard confirmation with the details above)</label>
          <textarea id="confirm-message" name="message" rows={3} maxLength={5000} className={DARK_INPUT_CLASS} />
        </div>
        <div className="sm:col-span-2"><OverrideField show={state.needsOverride} /></div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
            {pending ? "Saving…" : state.needsOverride ? "Override and book" : isEdit ? "Save booking" : "Confirm: mark Booked"}
          </button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
    </Panel>
  );
}

export function QuotePanel({ ids, defaults, today }: { ids: Ids; defaults: { eventDate: string; sets: number | null }; today: string }) {
  const [state, onSubmit, pending] = useActionForm(quoteAction, INITIAL);
  const err = (name: string) => state.fieldErrors?.[name];
  return (
    <Panel id="quote-panel" title="Send a quote">
      <p className="mb-3 text-sm text-cream/90">Ignores the instant-quote rules. They get a new private link to accept or decline.</p>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Hidden ids={ids} />
        <div>
          <label htmlFor="quote-eventDate" className={LABEL_CLASS}>Date</label>
          <input id="quote-eventDate" name="eventDate" type="date" min={today} defaultValue={defaults.eventDate} className={DARK_INPUT_CLASS} />
          <FieldError id="quote-eventDate-error" message={err("eventDate")} />
        </div>
        <div>
          <label htmlFor="quote-sets" className={LABEL_CLASS}>Sets</label>
          <input id="quote-sets" name="sets" inputMode="numeric" defaultValue={defaults.sets ?? 4} className={DARK_INPUT_CLASS} />
          <FieldError id="quote-sets-error" message={err("sets")} />
        </div>
        <div>
          <label htmlFor="quote-ratePerSet" className={LABEL_CLASS}>Price per set ($)</label>
          <input id="quote-ratePerSet" name="ratePerSet" inputMode="numeric" className={DARK_INPUT_CLASS} />
          <FieldError id="quote-ratePerSet-error" message={err("ratePerSet")} />
        </div>
        <div>
          <label htmlFor="quote-validHours" className={LABEL_CLASS}>Valid for (hours)</label>
          <input id="quote-validHours" name="validHours" inputMode="numeric" defaultValue={72} className={DARK_INPUT_CLASS} />
          <FieldError id="quote-validHours-error" message={err("validHours")} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="quote-message" className={LABEL_CLASS}>Message (optional, above the price)</label>
          <textarea id="quote-message" name="message" rows={3} maxLength={5000} className={DARK_INPUT_CLASS} placeholder="e.g. Includes travel to Grand Island." />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">{pending ? "Sending…" : "Send quote"}</button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
    </Panel>
  );
}

export function HoldPanel({ ids, heldUntil }: { ids: Ids; heldUntil: Date | null }) {
  const [state, onSubmit, pending] = useActionForm(holdAction, INITIAL);
  const [releaseState, onRelease, releasing] = useActionForm(releaseHoldAction, INITIAL);
  return (
    <Panel id="hold-panel" title="Hold the date">
      {heldUntil ? (
        <form onSubmit={onRelease} className="flex flex-wrap items-center gap-3">
          <Hidden ids={ids} />
          <p>Held until {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(heldUntil)} CT.</p>
          <button type="submit" disabled={releasing} className={SECONDARY_BUTTON}>Release hold</button>
          <FormMessage ok={state.ok} message={state.message} />
          <FormMessage ok={releaseState.ok} message={releaseState.message} />
        </form>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Hidden ids={ids} />
          <p className="text-sm text-cream/90">Shows the date as Pending while you negotiate. Expires on its own.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="hold-days" className={LABEL_CLASS}>Days</label>
              <input id="hold-days" name="days" inputMode="numeric" defaultValue={7} className={`${DARK_INPUT_CLASS} w-24`} />
            </div>
            <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>{state.needsOverride ? "Override and hold" : "Hold date"}</button>
          </div>
          <OverrideField show={state.needsOverride} />
          <FormMessage ok={state.ok} message={state.message} />
        </form>
      )}
    </Panel>
  );
}

export function DeclinePanel({ ids, template }: { ids: Ids; template: string }) {
  const [state, onSubmit, pending] = useActionForm(declineAction, INITIAL);
  return (
    <Panel id="decline-panel" title="Decline">
      <form onSubmit={onSubmit} className="space-y-3">
        <Hidden ids={ids} />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="emailProspect" defaultChecked />
          Email them this message from booking@
        </label>
        <label htmlFor="decline-message" className={LABEL_CLASS}>Message (edit before sending)</label>
        <textarea id="decline-message" name="message" rows={4} maxLength={5000} defaultValue={template} className={DARK_INPUT_CLASS} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" required />
            Confirm decline
          </label>
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>{pending ? "Declining…" : "Decline request"}</button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
    </Panel>
  );
}

export function CancelPanel({ ids }: { ids: Ids }) {
  const [state, onSubmit, pending] = useActionForm(cancelAction, INITIAL);
  return (
    <Panel id="cancel-panel" title="Cancel this booking">
      <form onSubmit={onSubmit} className="space-y-3">
        <Hidden ids={ids} />
        <label htmlFor="cancel-reason" className={LABEL_CLASS}>Reason (the band sees this)</label>
        <input id="cancel-reason" name="reason" maxLength={500} className={DARK_INPUT_CLASS} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" required />
            Confirm cancellation
          </label>
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>{pending ? "Cancelling…" : "Cancel booking"}</button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
    </Panel>
  );
}
