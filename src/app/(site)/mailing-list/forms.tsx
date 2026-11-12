"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { confirmAction, subscribeAction, unsubscribeAction } from "./actions";

export function SubscribeForm({ siteKey, nonce }: { siteKey: string | null; nonce: string }) {
  const id = useId();
  const startedAt = useRef(0);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  if (!siteKey) return <p>Sign-ups are paused right now.</p>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    try {
      const result = await subscribeAction({
        email: String(data.get("email") ?? ""),
        website: String(data.get("website") ?? ""),
        startedAt: startedAt.current,
        turnstileToken: String(data.get("cf-turnstile-response") ?? ""),
      });
      setStatus(result);
      if (result.ok) form.reset();
    } catch {
      setStatus({ ok: false, message: "Something went wrong. Try again in a moment." });
    } finally {
      setPending(false);
      setResetKey((key) => key + 1);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Join the mailing list">
      <div className="max-w-md">
        <label htmlFor={id} className="block font-heading font-semibold tracking-wide uppercase">
          Email
        </label>
        <input id={id} name="email" type="email" required maxLength={254} autoComplete="email" className="w-full border-2 border-cream/60 bg-charcoal px-3 py-2 text-cream" />
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <TurnstileWidget siteKey={siteKey} nonce={nonce} action="mailing-list" resetKey={resetKey} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        {pending ? "Sending…" : "Sign me up"}
      </button>
      <p role="status" aria-live="polite" className={`font-semibold ${status && !status.ok ? "text-red-text" : ""}`}>
        {status?.message ?? ""}
      </p>
    </form>
  );
}

/**
 * Confirm / unsubscribe need a button press: email scanners open every link in a message,
 * so acting on the link itself would sign people up (or out) without them.
 */
export function TokenButton({ token, kind }: { token: string; kind: "confirm" | "unsubscribe" }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const labels = kind === "confirm" ? { button: "Yes, sign me up", done: "You're on the list. Thanks!" } : { button: "Remove me from the list", done: "You're off the list. Your email has been deleted." };
  if (state === "done") return <p role="status" className="font-semibold">{labels.done}</p>;
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={state === "pending"}
        className="btn-primary disabled:opacity-60"
        onClick={async () => {
          setState("pending");
          try {
            setState((await (kind === "confirm" ? confirmAction(token) : unsubscribeAction(token))) ? "done" : "failed");
          } catch {
            setState("failed");
          }
        }}
      >
        {labels.button}
      </button>
      {state === "failed" && (
        <p role="alert" className="font-semibold text-red-text">
          That link has expired or was already used.
        </p>
      )}
    </div>
  );
}
