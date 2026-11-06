"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile widget. Loads Cloudflare's script once (with the page's CSP nonce)
 * and renders the check into this spot; on success it adds a hidden
 * `cf-turnstile-response` field to the surrounding form. `resetKey` re-runs the check,
 * e.g. after a failed submit (tokens are single-use).
 */

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(nonce: string): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.nonce = nonce;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({ siteKey, nonce, action, resetKey = 0 }: { siteKey: string; nonce: string; action: string; resetKey?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadScript(nonce)
      .then((api) => {
        if (cancelled || !container.current || widgetId.current) return;
        widgetId.current = api.render(container.current, { sitekey: siteKey, action, theme: "dark", "response-field-name": "cf-turnstile-response" });
      })
      .catch(() => {
        if (container.current) container.current.textContent = "The spam check couldn't load. Turn off content blockers for this site, or reload.";
      });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, nonce, action]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
