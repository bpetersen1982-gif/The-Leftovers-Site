import { z } from "zod";
import { logger } from "./logger";

/**
 * Cloudflare Turnstile (requirements FAN-4): a free, privacy-friendly bot check for public
 * forms. The browser widget produces a one-time token; the server confirms it with
 * Cloudflare before accepting the form. Fails closed: if Cloudflare can't be reached, the
 * form is refused with a "try again" message rather than let through unchecked.
 *
 * Development and tests use Cloudflare's documented dummy keys (always pass / always fail).
 */

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const SITEVERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;
const VERIFY_TIMEOUT_MS = 8_000;
/** Form field the widget fills in. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/** Cloudflare's test keys: https://developers.cloudflare.com/turnstile/troubleshooting/testing/ */
export const TURNSTILE_TEST_KEYS = {
  passSiteKey: "1x00000000000000000000AA",
  failSiteKey: "2x00000000000000000000AB",
  passSecret: "1x0000000000000000000000000000000AA",
  failSecret: "2x0000000000000000000000000000000AA",
} as const;

const keySchema = z.string().trim().regex(/^[0-9]x[0-9A-Za-z_-]{20,}$/);

export interface TurnstileConfig {
  readonly siteKey: string;
  readonly secretKey: string;
}

/** Null when not configured. Production refuses Cloudflare's test keys. */
export function turnstileConfig(source: Readonly<Record<string, string | undefined>> = process.env): TurnstileConfig | null {
  const siteKey = source.TURNSTILE_SITE_KEY?.trim();
  const secretKey = source.TURNSTILE_SECRET_KEY?.trim();
  if (!siteKey && !secretKey) return null;
  if (!keySchema.safeParse(siteKey).success || !keySchema.safeParse(secretKey).success) {
    throw new Error("Invalid Turnstile configuration: set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY");
  }
  const isProduction = source.NODE_ENV === "production" && source.LEFTOVERS_ENV === "production";
  if (isProduction && (/^[123]x0{20}/.test(siteKey ?? "") || /^[123]x0{30}/.test(secretKey ?? ""))) {
    throw new Error("Invalid Turnstile configuration: production can't use Cloudflare's test keys");
  }
  return { siteKey: siteKey as string, secretKey: secretKey as string };
}

/** Public site key for the browser widget, or null when Turnstile is off. */
export function turnstileSiteKey(): string | null {
  return turnstileConfig()?.siteKey ?? null;
}

export type TurnstileResult =
  | { readonly ok: true }
  /** "rejected": the check said no (bot, expired, reused). "unavailable": couldn't ask Cloudflare. */
  | { readonly ok: false; readonly reason: "missing" | "rejected" | "unavailable"; readonly codes: readonly string[] };

const responseSchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional().default([]),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

export async function verifyTurnstile(input: {
  secretKey: string;
  token: unknown;
  remoteIp?: string | null;
  /** Must match the `action` the widget was rendered with, when given. */
  expectedAction?: string;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileResult> {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token === "" || token.length > 2048) return { ok: false, reason: "missing", codes: [] };

  const form = new URLSearchParams({ secret: input.secretKey, response: token, idempotency_key: crypto.randomUUID() });
  if (input.remoteIp && input.remoteIp !== "unknown") form.set("remoteip", input.remoteIp);
  let parsed: z.infer<typeof responseSchema>;
  try {
    const response = await (input.fetchImpl ?? fetch)(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
    parsed = responseSchema.parse(await response.json());
  } catch (error) {
    logger.error({ err: error }, "turnstile verification unavailable");
    return { ok: false, reason: "unavailable", codes: [] };
  }
  if (!parsed.success) {
    const codes = parsed["error-codes"];
    // A bad secret is our misconfiguration, not the visitor's fault: log loudly.
    if (codes.some((code) => code.includes("secret"))) logger.error({ codes }, "turnstile secret key rejected by cloudflare");
    return { ok: false, reason: codes.includes("internal-error") ? "unavailable" : "rejected", codes };
  }
  if (input.expectedAction && parsed.action && parsed.action !== input.expectedAction) {
    return { ok: false, reason: "rejected", codes: ["action-mismatch"] };
  }
  return { ok: true };
}

/** What to tell the visitor. */
export function turnstileMessage(result: Exclude<TurnstileResult, { ok: true }>): string {
  if (result.reason === "unavailable") return "We couldn't run the spam check just now. Wait a moment and send it again.";
  if (result.reason === "missing") return "Wait for the spam check under the form to finish, then send it.";
  return "The spam check didn't pass or expired. Try it again.";
}
