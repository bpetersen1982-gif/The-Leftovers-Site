"use client";

import { useActionForm } from "../use-action-form";
import { useState } from "react";
import { INITIAL_ACTION_STATE } from "../action-state";
import { FieldError, FormMessage, INPUT_CLASS, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { addAvailabilityAction, deleteAvailabilityAction } from "./actions";

export function AddAvailabilityForm({
  today,
  isAdmin,
  viewerId,
  users,
}: {
  today: string;
  isAdmin: boolean;
  viewerId: string;
  users: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionForm(addAvailabilityAction, INITIAL_ACTION_STATE);
  const [scope, setScope] = useState<"MEMBER" | "BAND">("MEMBER");
  const [startDate, setStartDate] = useState("");
  // Reset after a successful save. Adjusting state during render when the action result
  // changes is React's recommended alternative to an effect; the key remounts the inputs.
  const [seenState, setSeenState] = useState(state);
  const [resetKey, setResetKey] = useState(0);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) {
      setStartDate("");
      setScope("MEMBER");
      setResetKey((key) => key + 1);
    }
  }
  const error = (name: string) => state.fieldErrors?.[name];
  const describe = (name: string) => (error(name) ? `avail-${name}-error` : undefined);

  return (
    <form key={resetKey} onSubmit={formAction} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
      {isAdmin && (
        <fieldset className="sm:col-span-2">
          <legend className={LABEL_CLASS}>Who</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="MEMBER" checked={scope === "MEMBER"} onChange={() => setScope("MEMBER")} />
              One person is out
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="BAND" checked={scope === "BAND"} onChange={() => setScope("BAND")} />
              Whole band is unavailable
            </label>
          </div>
        </fieldset>
      )}
      {isAdmin && scope === "MEMBER" && (
        <div className="sm:col-span-2">
          <label htmlFor="avail-userId" className={LABEL_CLASS}>
            Person
          </label>
          <select id="avail-userId" name="userId" defaultValue={viewerId} className={INPUT_CLASS} aria-describedby={describe("userId")}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <FieldError id="avail-userId-error" message={error("userId")} />
        </div>
      )}
      <div>
        <label htmlFor="avail-startDate" className={LABEL_CLASS}>
          First day
        </label>
        <input id="avail-startDate" name="startDate" type="date" required min={today} value={startDate}
          onChange={(event) => setStartDate(event.target.value)} className={INPUT_CLASS}
          aria-invalid={Boolean(error("startDate"))} aria-describedby={describe("startDate")} />
        <FieldError id="avail-startDate-error" message={error("startDate")} />
      </div>
      <div>
        <label htmlFor="avail-endDate" className={LABEL_CLASS}>
          Last day <span className="font-body text-sm normal-case">(blank = one day)</span>
        </label>
        <input id="avail-endDate" name="endDate" type="date" min={startDate || today} className={INPUT_CLASS}
          aria-invalid={Boolean(error("endDate"))} aria-describedby={describe("endDate")} />
        <FieldError id="avail-endDate-error" message={error("endDate")} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="avail-note" className={LABEL_CLASS}>
          Private note <span className="font-body text-sm normal-case">(optional, Admins only)</span>
        </label>
        <input id="avail-note" name="note" maxLength={200} className={INPUT_CLASS}
          aria-invalid={Boolean(error("note"))} aria-describedby={describe("note")} />
        <FieldError id="avail-note-error" message={error("note")} />
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Saving…" : "Add dates"}
        </button>
        <FormMessage ok={state.ok} message={state.message} onPaper />
      </div>
    </form>
  );
}

export function DeleteAvailabilityButton({ id, label }: { id: string; label: string }) {
  const [state, formAction, pending] = useActionForm(deleteAvailabilityAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={formAction} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} aria-label={`Remove ${label}`} className={SECONDARY_BUTTON}>
        {pending ? "Removing…" : "Remove"}
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
