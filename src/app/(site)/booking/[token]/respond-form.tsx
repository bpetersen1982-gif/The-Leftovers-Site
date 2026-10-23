"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";
import { RESPONSE_NOTE_MAX } from "@/lib/booking/validation";
import { type RespondState, respondToQuoteAction } from "../../book/actions";

const INITIAL: RespondState = { ok: false, message: null };

/** Accept / Accept with note / Decline / Decline with note (requirements BOOK-6). */
export function RespondForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(respondToQuoteAction, INITIAL);
  const [note, setNote] = useState("");

  useEffect(() => {
    // The server re-renders the page with the new status.
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : null);
    startTransition(() => dispatch(formData));
  };

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="note" className="block font-heading font-semibold tracking-wide uppercase">
        Note to the band (optional)
      </label>
      <textarea
        id="note"
        name="note"
        rows={3}
        maxLength={RESPONSE_NOTE_MAX}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-describedby="note-count"
        className="w-full border-2 border-ink bg-white/85 px-3 py-2 text-ink"
      />
      <p id="note-count" className="text-sm" aria-live="polite">
        {RESPONSE_NOTE_MAX - note.length} characters left
      </p>
      <div className="flex flex-wrap gap-4">
        <button type="submit" name="decision" value="accept" disabled={pending || state.ok} className="btn-primary disabled:opacity-60">
          {pending ? "Sending…" : note.trim() ? "Accept with note" : "Accept quote"}
        </button>
        <button type="submit" name="decision" value="decline" disabled={pending || state.ok} className="border-2 border-ink px-4 py-2 font-heading font-semibold tracking-wider uppercase disabled:opacity-60">
          {note.trim() ? "Decline with note" : "Decline"}
        </button>
      </div>
      {state.message && (
        <p role="alert" className="font-semibold text-red-ui">
          {state.message}
        </p>
      )}
    </form>
  );
}
