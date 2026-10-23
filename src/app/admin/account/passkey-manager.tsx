"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/auth-client";
import { usePasskeySupport } from "@/lib/auth/use-passkey-support";

interface PasskeyItem {
  readonly id: string;
  readonly name?: string | null;
  readonly createdAt?: Date | string | null;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<PasskeyItem[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = usePasskeySupport();

  // Bumped after add/remove to re-fetch the list.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    authClient.passkey.listUserPasskeys().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setMessage({ ok: false, text: "Couldn't load your passkeys. Refresh to try again." });
        return;
      }
      setPasskeys(data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function addPasskey() {
    setBusy(true);
    setMessage(null);
    const result = await authClient.passkey.addPasskey({ name: deviceLabel() });
    setBusy(false);
    if (result?.error) {
      setMessage({ ok: false, text: "Passkey wasn't added. If you cancelled the prompt, try again." });
      return;
    }
    setMessage({ ok: true, text: "Passkey added. Next time choose “Log in with a passkey”." });
    setVersion((current) => current + 1);
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setMessage(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    setBusy(false);
    if (error) {
      setMessage({ ok: false, text: "Couldn't remove that passkey. Try again." });
      return;
    }
    setMessage({ ok: true, text: "Passkey removed." });
    setVersion((current) => current + 1);
  }

  return (
    <section aria-labelledby="passkeys-heading" className="space-y-4">
      <h2 id="passkeys-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
        Passkeys
      </h2>
      <p className="text-cream/90">
        A passkey lets this device log you in with Face ID, a fingerprint, or its screen lock. Add one on each phone or
        computer you use. You can always log in with an email link too.
      </p>

      {passkeys === null ? (
        <p>Loading…</p>
      ) : passkeys.length === 0 ? (
        <p>No passkeys yet.</p>
      ) : (
        <ul className="divide-y divide-olive/50 border-y border-olive/50">
          {passkeys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                {key.name || "Passkey"}
                {key.createdAt && <span className="text-cream/90"> &middot; added {DATE_FORMAT.format(new Date(key.createdAt))}</span>}
              </span>
              <button type="button" disabled={busy} onClick={() => removePasskey(key.id)}
                aria-label={`Remove passkey ${key.name || ""}`.trim()}
                className="border border-cream/70 px-3 py-1 font-heading tracking-wider uppercase hover:bg-cream hover:text-ink disabled:opacity-60">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {supported ? (
        <button type="button" disabled={busy} onClick={addPasskey} className="btn-primary disabled:opacity-60">
          {busy ? "Working…" : "Add a passkey on this device"}
        </button>
      ) : (
        <p>This browser doesn&apos;t support passkeys. Keep using email links, or try a current browser.</p>
      )}

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`font-semibold ${message.ok ? "" : "text-red-text"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

/** Short label so people can tell their devices apart in the list. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
