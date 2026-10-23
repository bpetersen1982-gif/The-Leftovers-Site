"use client";

import { useActionState, useEffect } from "react";
import { Notice } from "@/components/brand";
import { type AcceptInviteState, acceptInviteAction } from "./actions";

const INITIAL: AcceptInviteState = { error: null };

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);
  useEffect(() => {
    if (state.loginUrl) window.location.assign(state.loginUrl);
  }, [state.loginUrl]);
  const busy = pending || Boolean(state.loginUrl);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? "Setting up your account…" : "Accept invite"}
      </button>
    </form>
  );
}
