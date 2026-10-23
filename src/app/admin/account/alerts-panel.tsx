"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { INITIAL_ACTION_STATE } from "../action-state";
import { FormMessage, SECONDARY_BUTTON } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { removePushSubscriptionAction, saveAlertPreferencesAction, savePushSubscriptionAction, sendTestPushAction } from "./alert-actions";

type Support = "server" | "supported" | "unsupported" | "ios-needs-home-screen";

const noop = () => () => {};

/** What this browser can do. iPhones only allow push from a Home Screen app (iOS 16.4+). */
function detectSupport(): Support {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isIos && !standalone) return "ios-needs-home-screen";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "supported" : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

interface Device {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastSuccessAt: string | null;
}

const STAMP = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function AlertsPanel({
  vapidKey,
  devices,
  preferences,
}: {
  vapidKey: string | null;
  devices: readonly Device[];
  preferences: { email: boolean; push: boolean };
}) {
  const support = useSyncExternalStore<Support>(noop, detectSupport, () => "server");
  const [enabling, startEnabling] = useTransition();
  const [enableMessage, setEnableMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testState, onTest, testing] = useActionForm(sendTestPushAction, INITIAL_ACTION_STATE);
  const [prefState, onPrefs, savingPrefs] = useActionForm(saveAlertPreferencesAction, INITIAL_ACTION_STATE);

  function enable() {
    if (!vapidKey) return;
    startEnabling(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setEnableMessage({ ok: false, text: "Notifications are blocked for this site. Allow them in your browser or phone settings, then try again." });
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
        const json = subscription.toJSON();
        const result = await savePushSubscriptionAction({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() });
        setEnableMessage({ ok: result.ok, text: result.message ?? "" });
      } catch {
        setEnableMessage({ ok: false, text: "This device couldn't turn on alerts. Try again, or use email alerts." });
      }
    });
  }

  return (
    <section aria-labelledby="alerts-heading" className="space-y-4">
      <h2 id="alerts-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
        Booking alerts
      </h2>

      <form onSubmit={onPrefs} className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="email" defaultChecked={preferences.email} />
          Email me about booking requests
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="push" defaultChecked={preferences.push} />
          Send phone/desktop alerts to my devices below
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={savingPrefs} className={SECONDARY_BUTTON}>Save alert settings</button>
          <FormMessage ok={prefState.ok} message={prefState.message} />
        </div>
      </form>

      <div className="space-y-3 border-t border-olive/40 pt-4">
        <h3 className="font-heading text-lg tracking-wider uppercase">Phone &amp; desktop alerts</h3>
        {!vapidKey ? (
          <p>Phone alerts aren&apos;t set up on the server yet. Email alerts still work.</p>
        ) : support === "ios-needs-home-screen" ? (
          <ol className="list-decimal space-y-1 pl-6">
            <li>In Safari, tap the Share button, then <strong>Add to Home Screen</strong>.</li>
            <li>Open <strong>Leftovers</strong> from your Home Screen and log in.</li>
            <li>Come back to My account and tap <strong>Turn on alerts for this device</strong>.</li>
          </ol>
        ) : support === "unsupported" ? (
          <p>This browser doesn&apos;t support push alerts. Use email alerts, or try Chrome, Edge, Firefox, or Safari.</p>
        ) : support === "supported" ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={enable} disabled={enabling} className="btn-primary disabled:opacity-60">
              {enabling ? "Turning on…" : "Turn on alerts for this device"}
            </button>
            {enableMessage && (
              <p role={enableMessage.ok ? "status" : "alert"} className={`font-semibold ${enableMessage.ok ? "" : "text-red-text"}`}>
                {enableMessage.text}
              </p>
            )}
          </div>
        ) : null}

        {devices.length > 0 && (
          <>
            <ul className="divide-y divide-olive/50 border-y border-olive/50">
              {devices.map((device) => (
                <DeviceRow key={device.id} device={device} />
              ))}
            </ul>
            <form onSubmit={onTest} className="flex items-center gap-3">
              <button type="submit" disabled={testing} className={SECONDARY_BUTTON}>Send test alert</button>
              <FormMessage ok={testState.ok} message={testState.message} />
            </form>
          </>
        )}
        <p className="text-sm text-cream/90">Alerts say what happened and when, never names, phone numbers, or prices.</p>
      </div>
    </section>
  );
}

function DeviceRow({ device }: { device: Device }) {
  const [state, onSubmit, pending] = useActionForm(removePushSubscriptionAction, INITIAL_ACTION_STATE);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span>
        {device.label}
        <span className="text-sm text-cream/90">
          {" "}· added {STAMP.format(new Date(device.createdAt))}
          {device.lastSuccessAt ? ` · last alert ${STAMP.format(new Date(device.lastSuccessAt))}` : ""}
        </span>
      </span>
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input type="hidden" name="id" value={device.id} />
        <button type="submit" disabled={pending} aria-label={`Remove ${device.label}`} className={SECONDARY_BUTTON}>Remove</button>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </li>
  );
}
