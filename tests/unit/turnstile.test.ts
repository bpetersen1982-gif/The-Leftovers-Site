import { describe, expect, it } from "vitest";
import { TURNSTILE_TEST_KEYS, turnstileConfig, verifyTurnstile } from "@/lib/turnstile";

function fakeFetch(body: unknown, status = 200) {
  const calls: URLSearchParams[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init.body as URLSearchParams);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("turnstileConfig", () => {
  it("is off when unset, strict when half-set, and refuses test keys in production", () => {
    expect(turnstileConfig({})).toBeNull();
    expect(() => turnstileConfig({ TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEYS.passSiteKey })).toThrow(/both/);
    const test = { TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEYS.passSiteKey, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.passSecret };
    expect(turnstileConfig(test)).toEqual({ siteKey: TURNSTILE_TEST_KEYS.passSiteKey, secretKey: TURNSTILE_TEST_KEYS.passSecret });
    expect(() => turnstileConfig({ ...test, NODE_ENV: "production", LEFTOVERS_ENV: "production" })).toThrow(/test keys/);
    const real = { TURNSTILE_SITE_KEY: "0x4AAAAAAF2dFwP0nLRaTpFE", TURNSTILE_SECRET_KEY: "0x4AAAAAAF2dFwexample-secret-value", NODE_ENV: "production", LEFTOVERS_ENV: "production" };
    expect(turnstileConfig(real)?.siteKey).toBe("0x4AAAAAAF2dFwP0nLRaTpFE");
  });
});

describe("verifyTurnstile", () => {
  it("passes a good token and sends the visitor IP with an idempotency key", async () => {
    const { impl, calls } = fakeFetch({ success: true, action: "fan-post" });
    expect(await verifyTurnstile({ secretKey: "s", token: "tok", remoteIp: "203.0.113.9", expectedAction: "fan-post", fetchImpl: impl })).toEqual({ ok: true });
    expect(calls[0]?.get("remoteip")).toBe("203.0.113.9");
    expect(calls[0]?.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects missing, failed, reused, and wrong-action tokens", async () => {
    expect(await verifyTurnstile({ secretKey: "s", token: "", fetchImpl: fakeFetch({ success: true }).impl })).toMatchObject({ ok: false, reason: "missing" });
    expect(await verifyTurnstile({ secretKey: "s", token: 42, fetchImpl: fakeFetch({ success: true }).impl })).toMatchObject({ ok: false, reason: "missing" });
    expect(await verifyTurnstile({ secretKey: "s", token: "t", fetchImpl: fakeFetch({ success: false, "error-codes": ["timeout-or-duplicate"] }).impl })).toMatchObject({
      ok: false,
      reason: "rejected",
    });
    expect(await verifyTurnstile({ secretKey: "s", token: "t", expectedAction: "fan-post", fetchImpl: fakeFetch({ success: true, action: "other" }).impl })).toMatchObject({
      ok: false,
      codes: ["action-mismatch"],
    });
  });

  it("fails closed when Cloudflare can't be reached", async () => {
    const down = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile({ secretKey: "s", token: "t", fetchImpl: down })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await verifyTurnstile({ secretKey: "s", token: "t", fetchImpl: fakeFetch("<html>", 502).impl })).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
