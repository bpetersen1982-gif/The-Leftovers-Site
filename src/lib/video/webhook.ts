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

export function verifyStreamWebhook(input: {
  secret: string;
  header: string | null;
  rawBody: string;
  now?: Date;
}): boolean {
  if (!input.header) return false;
  const parts = new Map(
    input.header.split(",").map((part) => {
      const [key = "", ...rest] = part.trim().split("=");
      return [key, rest.join("=")] as const;
    }),
  );
  const time = Number(parts.get("time"));
  const signature = parts.get("sig1") ?? "";
  if (!Number.isInteger(time) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - time) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signStreamWebhook(input.secret, time, input.rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
