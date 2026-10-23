import { describe, expect, it } from "vitest";
import { closeCapture, openCapture, tryCapture } from "@/lib/auth/magic-link-capture";
import { DatabaseUrlError, resolveDatabaseUrl } from "@/lib/database-url";
import { parseServerEnv } from "@/lib/env";
import { escapeHtml, inviteEmail } from "@/lib/mail/templates";
import { can } from "@/lib/permissions";
import { generateToken, hashToken, hashesMatch, isWellFormedToken } from "@/lib/tokens";
import { inviteInputSchema } from "@/lib/users/validation";

const LOCAL = "postgresql://leftovers:pw@127.0.0.1:5433/leftovers";

describe("resolveDatabaseUrl (project isolation)", () => {
  it("ignores the generic DATABASE_URL entirely", () => {
    expect(() => resolveDatabaseUrl({ DATABASE_URL: LOCAL })).toThrow(DatabaseUrlError);
  });

  it("refuses another project's database outside production", () => {
    expect(() =>
      resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: "postgresql://backroads:pw@localhost:5432/backroads" }),
    ).toThrow(/Refusing to use database "backroads"/);
  });

  it("never puts the URL (or its password) in the error", () => {
    try {
      resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: "postgresql://u:supersecret@host/other" });
    } catch (error) {
      expect(String(error)).not.toContain("supersecret");
    }
  });

  it("accepts leftovers databases, and Railway's database name only in production", () => {
    expect(resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: LOCAL })).toBe(LOCAL);
    const railway = "postgresql://postgres:pw@postgres.railway.internal:5432/railway";
    expect(() => resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: railway, NODE_ENV: "production" })).toThrow();
    expect(resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: railway, NODE_ENV: "production", LEFTOVERS_ENV: "production" })).toBe(railway);
  });

  it("rejects non-postgres and malformed URLs", () => {
    expect(() => resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: "mysql://x/leftovers" })).toThrow(/postgresql/);
    expect(() => resolveDatabaseUrl({ LEFTOVERS_DATABASE_URL: "not a url" })).toThrow(/valid URL/);
  });
});

describe("parseServerEnv", () => {
  const base = {
    LEFTOVERS_DATABASE_URL: LOCAL,
    APP_URL: "http://localhost:3000/",
    BETTER_AUTH_SECRET: "x".repeat(32),
    MAIL_FROM: "The Leftovers <no-reply@mail.example.test>",
    MAIL_REPLY_TO: "booking@example.test",
    MAIL_TRANSPORT: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1026",
  };

  it("parses a valid dev config and strips the trailing slash", () => {
    const env = parseServerEnv(base);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.IS_PRODUCTION).toBe(false);
  });

  it("requires a long secret and reports problems without values", () => {
    expect(() => parseServerEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("requires Resend and https in production", () => {
    const prod = { ...base, NODE_ENV: "production", LEFTOVERS_ENV: "production" };
    expect(() => parseServerEnv(prod)).toThrow(/resend/);
    expect(() =>
      parseServerEnv({ ...prod, MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test", APP_URL: "http://x.test" }),
    ).toThrow(/https/);
    expect(parseServerEnv({ ...prod, MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_test", APP_URL: "https://x.test" }).IS_PRODUCTION).toBe(true);
  });
});

describe("tokens", () => {
  it("generates unique, well-formed 256-bit tokens", () => {
    const a = generateToken();
    expect(isWellFormedToken(a)).toBe(true);
    expect(a).not.toBe(generateToken());
  });

  it("hashes deterministically and compares safely", () => {
    const token = generateToken();
    expect(hashesMatch(hashToken(token), hashToken(token))).toBe(true);
    expect(hashesMatch(hashToken(token), hashToken(generateToken()))).toBe(false);
    expect(hashesMatch(hashToken(token), "abc")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "short", "x".repeat(44), `${"x".repeat(42)}!`]) expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe("email templates", () => {
  it("escapes HTML in every dynamic value", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    const email = inviteEmail({
      to: "a@example.test",
      inviteeName: "<img src=x onerror=alert(1)>",
      inviterName: "Erik",
      roleLabel: "Admin",
      url: "https://theleftoversband.com/invite/abc",
      expiresHours: 72,
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x");
  });
});

describe("permissions", () => {
  it("limits user management to Admins", () => {
    expect(can("ADMIN", "users:invite")).toBe(true);
    expect(can("MEMBER", "users:invite")).toBe(false);
    expect(can("MEMBER", "users:changeRole")).toBe(false);
    expect(can("MEMBER", "admin:access")).toBe(true);
    expect(can("MEMBER", "account:managePasskeys")).toBe(true);
  });
});

describe("invite input validation", () => {
  it("normalizes email and rejects unexpected fields and bad names", () => {
    expect(inviteInputSchema.parse({ email: "  Erik@Example.TEST ", name: "Erik Delaney", role: "ADMIN" }).email).toBe("erik@example.test");
    expect(inviteInputSchema.safeParse({ email: "a@example.test", name: "A", role: "ADMIN", extra: 1 }).success).toBe(false);
    expect(inviteInputSchema.safeParse({ email: "a@example.test", name: "<b>", role: "ADMIN" }).success).toBe(false);
    expect(inviteInputSchema.safeParse({ email: "a@example.test", name: "A", role: "OWNER" }).success).toBe(false);
    expect(inviteInputSchema.safeParse({ email: "nope", name: "A", role: "MEMBER" }).success).toBe(false);
  });
});

describe("magic link capture", () => {
  it("captures only for server-registered ids, once", () => {
    expect(tryCapture("unregistered", "https://x/1")).toBe(false);
    expect(tryCapture(undefined, "https://x/1")).toBe(false);
    const id = openCapture();
    expect(tryCapture(id, "https://x/1")).toBe(true);
    expect(tryCapture(id, "https://x/2")).toBe(false);
    expect(closeCapture(id)).toBe("https://x/1");
    expect(closeCapture(id)).toBeNull();
  });
});
