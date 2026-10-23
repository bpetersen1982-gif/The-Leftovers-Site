"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Notice } from "@/components/brand";
import { authClient } from "@/lib/auth/auth-client";
import { usePasskeySupport } from "@/lib/auth/use-passkey-support";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const passkeySupported = usePasskeySupport();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      setStatus({ kind: "error", message: "Enter a valid email address." });
      return;
    }
    setStatus({ kind: "sending" });
    const { error } = await authClient.signIn.magicLink({ email: normalized, callbackURL: "/admin", errorCallbackURL: "/login" });
    if (error) {
      setStatus({
        kind: "error",
        message: error.status === 429 ? "Too many requests. Wait a few minutes and try again." : "Something went wrong sending your link. Try again.",
      });
      return;
    }
    // Same message whether or not the email has an account (no account discovery).
    setStatus({ kind: "sent" });
  }

  async function onPasskey() {
    setStatus({ kind: "sending" });
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setStatus({ kind: "error", message: "Passkey login didn't work. Use an email link instead." });
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  if (status.kind === "sent") {
    return (
      <Notice tone="success">
        If that email belongs to a band account, a login link is on its way. It works once and expires in 15 minutes.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <label htmlFor="email" className="block font-heading font-semibold tracking-wide uppercase">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username webauthn"
          inputMode="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={status.kind === "error"}
          aria-describedby={status.kind === "error" ? "login-error" : undefined}
          className="w-full border-2 border-ink bg-white/80 px-3 py-2 text-ink"
        />
        {status.kind === "error" && (
          <p id="login-error" role="alert" className="font-semibold text-red-ui">
            {status.message}
          </p>
        )}
        <button type="submit" disabled={status.kind === "sending"} className="btn-primary w-full disabled:opacity-60">
          {status.kind === "sending" ? "Sending…" : "Email me a login link"}
        </button>
      </form>
      {passkeySupported && (
        <button
          type="button"
          onClick={onPasskey}
          disabled={status.kind === "sending"}
          className="w-full border-2 border-ink px-4 py-3 font-heading font-semibold tracking-wider uppercase disabled:opacity-60"
        >
          Log in with a passkey
        </button>
      )}
    </div>
  );
}
