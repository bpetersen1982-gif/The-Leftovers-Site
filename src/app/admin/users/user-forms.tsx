"use client";

import { useActionState, useEffect, useRef } from "react";
import type { Role } from "@/generated/prisma/enums";
import { INITIAL_ACTION_STATE } from "../action-state";
import { changeRoleAction, deactivateUserAction, inviteUserAction, revokeInviteAction } from "../actions";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "MEMBER", label: "Band Member" },
  { value: "ADMIN", label: "Admin" },
];

const INPUT = "w-full border-2 border-ink bg-white/80 px-3 py-2 text-ink";
const LABEL = "block font-heading font-semibold tracking-wide uppercase";

function Message({ ok, message }: { ok: boolean; message: string | null }) {
  if (!message) return null;
  return (
    <p role={ok ? "status" : "alert"} className={`text-sm font-semibold ${ok ? "" : "text-red-text"}`}>
      {message}
    </p>
  );
}

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteUserAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form ref={formRef} action={formAction} noValidate className="mt-4 grid gap-4 sm:grid-cols-3">
      <div>
        <label htmlFor="invite-name" className={LABEL}>
          Name
        </label>
        <input id="invite-name" name="name" required maxLength={80} autoComplete="off" className={INPUT}
          aria-invalid={Boolean(error("name"))} aria-describedby={error("name") ? "invite-name-error" : undefined} />
        {error("name") && <p id="invite-name-error" className="mt-1 text-sm font-semibold text-red-ui">{error("name")}</p>}
      </div>
      <div>
        <label htmlFor="invite-email" className={LABEL}>
          Email
        </label>
        <input id="invite-email" name="email" type="email" required maxLength={254} autoComplete="off" className={INPUT}
          aria-invalid={Boolean(error("email"))} aria-describedby={error("email") ? "invite-email-error" : undefined} />
        {error("email") && <p id="invite-email-error" className="mt-1 text-sm font-semibold text-red-ui">{error("email")}</p>}
      </div>
      <div>
        <label htmlFor="invite-role" className={LABEL}>
          Role
        </label>
        <select id="invite-role" name="role" defaultValue="MEMBER" className={INPUT}>
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Sending…" : "Send invite"}
        </button>
        {state.message && (
          <p role={state.ok ? "status" : "alert"} className={`font-semibold ${state.ok ? "" : "text-red-ui"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

export function RevokeInviteButton({ inviteId, name }: { inviteId: string; name: string }) {
  const [state, formAction, pending] = useActionState(revokeInviteAction, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="inviteId" value={inviteId} />
      <button type="submit" disabled={pending} aria-label={`Cancel invite for ${name}`}
        className="border border-cream/70 px-3 py-1 font-heading tracking-wider uppercase hover:bg-cream hover:text-ink disabled:opacity-60">
        {pending ? "Cancelling…" : "Cancel invite"}
      </button>
      <Message ok={state.ok} message={state.message} />
    </form>
  );
}

export function UserControls({ userId, name, role, isSelf }: { userId: string; name: string; role: Role; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(changeRoleAction, INITIAL_ACTION_STATE);
  const [removeState, removeAction, removePending] = useActionState(deactivateUserAction, INITIAL_ACTION_STATE);
  const nextRole: Role = role === "ADMIN" ? "MEMBER" : "ADMIN";
  const nextLabel = nextRole === "ADMIN" ? "Make Admin" : "Make Band Member";

  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <p className="font-heading tracking-wider uppercase">{role === "ADMIN" ? "Admin" : "Band Member"}</p>
      <form action={roleAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value={nextRole} />
        <button type="submit" disabled={rolePending} aria-label={`${nextLabel}: ${name}`}
          className="border border-cream/70 px-3 py-1 font-heading tracking-wider uppercase hover:bg-cream hover:text-ink disabled:opacity-60">
          {rolePending ? "Saving…" : nextLabel}
        </button>
      </form>
      <Message ok={roleState.ok} message={roleState.message} />
      {!isSelf && (
        <form action={removeAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="userId" value={userId} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="yes" required />
            Confirm
          </label>
          <button type="submit" disabled={removePending} aria-label={`Remove ${name}`}
            className="bg-red-ui px-3 py-1 font-heading tracking-wider text-cream uppercase hover:bg-[#8f2121] disabled:opacity-60">
            {removePending ? "Removing…" : "Remove"}
          </button>
        </form>
      )}
      <Message ok={removeState.ok} message={removeState.message} />
    </div>
  );
}
