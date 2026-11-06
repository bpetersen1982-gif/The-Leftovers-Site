import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Cloudflare Stream webhook (MED-7). The `Webhook-Signature` header looks like
 * `time=1230811200,sig1=<hex>` where sig1 = HMAC-SHA256(secret, `${time}.${rawBody}`).
 * Old timestamps are rejected so a captured request can't be replayed later.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function signStreamWebhook(secret: string, time: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${time}.${rawBody}`).digest("hex");
}

export type WebhookCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "missing" | "malformed" | "stale" | "mismatch"; readonly skewSeconds?: number; readonly keys?: readonly string[] };

/** Checks a Stream webhook signature and says why it failed (safe to log: no secrets). */
export function checkStreamWebhook(input: { secret: string; header: string | null; rawBody: string; now?: Date }): WebhookCheck {
  if (!input.header) return { ok: false, reason: "missing" };
  const parts = new Map(
    input.header.split(",").map((part) => {
      const [key = "", ...rest] = part.trim().split("=");
      return [key.trim(), rest.join("=").trim()] as const;
    }),
  );
  const time = Number(parts.get("time"));
  const signature = (parts.get("sig1") ?? "").toLowerCase();
  if (!Number.isInteger(time) || !/^[a-f0-9]{64}$/.test(signature)) return { ok: false, reason: "malformed", keys: [...parts.keys()] };
  const skewSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000) - time;
  if (Math.abs(skewSeconds) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "stale", skewSeconds };
  const expected = Buffer.from(signStreamWebhook(input.secret, time, input.rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "mismatch", skewSeconds };
  return { ok: true };
}

export function verifyStreamWebhook(input: { secret: string; header: string | null; rawBody: string; now?: Date }): boolean {
  return checkStreamWebhook(input).ok;
}
