"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { completeFanPhotoAction, submitFanPostAction } from "./actions";

/**
 * Public Fan Wall form (FAN-1, FAN-2, FAN-4, LEG-5). The browser checks are only for quick
 * feedback; the server re-checks everything. A photo uploads straight to storage with a
 * signed URL after the message is accepted.
 */

const MAX_MESSAGE = 1_000;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
const ACCEPTED = new Set(Object.values(TYPE_BY_EXTENSION));

const INPUT = "w-full border-2 border-cream/60 bg-charcoal px-3 py-2 text-cream";
const LABEL = "block font-heading font-semibold tracking-wide uppercase";

function contentTypeOf(file: File): string | null {
  if (ACCEPTED.has(file.type)) return file.type;
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase();
  return (extension && TYPE_BY_EXTENSION[extension]) || null;
}

function put(url: string, headers: Record<string, string>, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(String(request.status))));
    request.onerror = () => reject(new Error("network"));
    request.send(file);
  });
}

type Status = { kind: "idle" } | { kind: "sending"; progress: number | null } | { kind: "sent"; message: string; warning: boolean } | { kind: "error"; message: string };

export function FanWallForm({ siteKey, nonce, shows }: { siteKey: string | null; nonce: string; shows: readonly { id: string; label: string }[] }) {
  const prefix = useId();
  // When the visitor started filling it in (bots submit instantly); set after mount.
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [messageLength, setMessageLength] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const sending = status.kind === "sending";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "");
    setErrors({});
    let photo = null;
    if (file) {
      const contentType = contentTypeOf(file);
      if (!contentType) return setErrors({ photo: "Photos can be JPEG, PNG, WebP, or HEIC." });
      if (file.size > MAX_PHOTO_BYTES) return setErrors({ photo: "Photos can be up to 10 MB." });
      if (data.get("consent") !== "on") return setErrors({ consent: "Confirm you took the photo and we can show it." });
      photo = { filename: file.name, contentType, size: file.size, altText: text("altText"), consent: true };
    }
    setStatus({ kind: "sending", progress: null });
    try {
      const result = await submitFanPostAction({
        displayName: text("displayName"),
        message: text("message"),
        email: text("email"),
        showId: text("showId"),
        photo,
        website: text("website"),
        startedAt: startedAt.current,
        turnstileToken: text("cf-turnstile-response"),
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setStatus({ kind: "error", message: result.message });
        return;
      }
      let outcome: Status = { kind: "sent", message: "Thanks! A band member will read it soon. Posts show up here once they're approved.", warning: false };
      if (result.photoUpload && file) {
        const upload = result.photoUpload;
        try {
          await put(upload.url, upload.headers, file, (progress) => setStatus({ kind: "sending", progress }));
          const done = await completeFanPhotoAction(upload.postId, upload.token);
          outcome = { kind: "sent", message: done.message, warning: !done.ok };
        } catch {
          outcome = { kind: "sent", message: "Your message was sent, but the photo didn't upload. Check your connection if you want to try the photo again.", warning: true };
        }
      }
      form.reset();
      setFile(null);
      setMessageLength(0);
      startedAt.current = Date.now();
      setStatus(outcome);
    } catch {
      setStatus({ kind: "error", message: "Something went wrong sending that. Try again in a moment." });
    } finally {
      // Spam-check tokens work once; get a fresh one for the next post.
      setResetKey((key) => key + 1);
    }
  }

  const field = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `${prefix}-${name}-error` : undefined,
  });
  const error = (name: string) =>
    errors[name] ? (
      <p id={`${prefix}-${name}-error`} className="mt-1 text-sm font-semibold text-red-text">
        {errors[name]}
      </p>
    ) : null;

  if (!siteKey) return <p>The Fan Wall isn&apos;t taking posts right now.</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Post on the Fan Wall">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${prefix}-displayName`} className={LABEL}>
            Your name
          </label>
          <input {...field("displayName")} required maxLength={40} autoComplete="given-name" className={INPUT} />
          {error("displayName")}
        </div>
        <div>
          <label htmlFor={`${prefix}-email`} className={LABEL}>
            Email (optional, never shown)
          </label>
          <input {...field("email")} type="email" maxLength={254} autoComplete="email" className={INPUT} />
          {error("email")}
        </div>
      </div>
      {shows.length > 0 && (
        <div>
          <label htmlFor={`${prefix}-showId`} className={LABEL}>
            Which show were you at? (optional)
          </label>
          <select {...field("showId")} defaultValue="" className={INPUT}>
            <option value="">Not sure / not a show</option>
            {shows.map((show) => (
              <option key={show.id} value={show.id}>
                {show.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${prefix}-message`} className={LABEL}>
          Message
        </label>
        <textarea
          {...field("message")}
          required
          rows={5}
          maxLength={MAX_MESSAGE}
          className={INPUT}
          onChange={(event) => setMessageLength(event.target.value.length)}
          aria-describedby={`${prefix}-message-count${errors.message ? ` ${prefix}-message-error` : ""}`}
        />
        <p id={`${prefix}-message-count`} className="mt-1 text-sm text-cream/80">
          {messageLength}/{MAX_MESSAGE} characters. No links, please.
        </p>
        {error("message")}
      </div>
      <div>
        <label htmlFor={`${prefix}-photo`} className={LABEL}>
          Photo (optional, up to 10 MB)
        </label>
        <input
          id={`${prefix}-photo`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="block text-sm"
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          aria-describedby={errors.photo ? `${prefix}-photo-error` : undefined}
        />
        {error("photo")}
      </div>
      {file && (
        <div className="space-y-3 border-l-2 border-cream/40 pl-4">
          <div>
            <label htmlFor={`${prefix}-altText`} className={LABEL}>
              Describe the photo (optional)
            </label>
            <input {...field("altText")} maxLength={250} placeholder="e.g. The band on stage, crowd singing" className={INPUT} />
            <p className="mt-1 text-sm text-cream/80">Helps people who use screen readers. If you skip it, we&apos;ll add one.</p>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="consent" className="mt-1 size-5" aria-describedby={errors.consent ? `${prefix}-consent-error` : undefined} />
            <span>I took this photo, and The Leftovers can show it on this site.</span>
          </label>
          {error("consent")}
        </div>
      )}
      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <TurnstileWidget siteKey={siteKey} nonce={nonce} action="fan-post" resetKey={resetKey} />
      <p className="text-sm text-cream/90">
        By posting, you agree we can show your name, message, and photo on this site. A band member approves posts first, and we can remove
        any post. See our{" "}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
      <button type="submit" disabled={sending} className="btn-primary disabled:opacity-60">
        {sending ? (status.progress !== null ? `Uploading photo ${status.progress}%` : "Sending…") : "Post"}
      </button>
      <div role="status" aria-live="polite">
        {status.kind === "sent" && <p className={`font-semibold ${status.warning ? "text-red-text" : ""}`}>{status.message}</p>}
        {status.kind === "error" && <p className="font-semibold text-red-text">{status.message}</p>}
      </div>
    </form>
  );
}
