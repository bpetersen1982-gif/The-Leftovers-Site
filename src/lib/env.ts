import { z } from "zod";
import { resolveDatabaseUrl } from "./database-url";

/**
 * Validated server environment. Server code only (never import from client components).
 *
 * Validation runs once, on first access, so `next build` doesn't need production secrets.
 */

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z
    .url()
    .transform((value) => value.replace(/\/+$/, "")),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  MAIL_FROM: z.string().min(3),
  MAIL_REPLY_TO: z.email(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

const mailSchema = z.discriminatedUnion("MAIL_TRANSPORT", [
  z.object({
    MAIL_TRANSPORT: z.literal("resend"),
    RESEND_API_KEY: z.string().startsWith("re_", "RESEND_API_KEY must be a Resend API key"),
  }),
  z.object({
    MAIL_TRANSPORT: z.literal("smtp"),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  }),
]);

export type ServerEnv = z.infer<typeof baseSchema> &
  z.infer<typeof mailSchema> & { DATABASE_URL: string; IS_PRODUCTION: boolean };

let cached: ServerEnv | undefined;

/** Parses and validates process.env. Throws with every problem listed (no values). */
export function parseServerEnv(source: Readonly<Record<string, string | undefined>>): ServerEnv {
  const base = baseSchema.safeParse(source);
  const mail = mailSchema.safeParse(source);
  const issues = [...(base.error?.issues ?? []), ...(mail.error?.issues ?? [])];
  if (!base.success || !mail.success) {
    const summary = issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n  ${summary.join("\n  ")}`);
  }

  const isProduction = base.data.NODE_ENV === "production" && source.LEFTOVERS_ENV === "production";
  if (isProduction && mail.data.MAIL_TRANSPORT !== "resend") {
    throw new Error("Invalid environment configuration: production must use MAIL_TRANSPORT=resend");
  }
  if (isProduction && !base.data.APP_URL.startsWith("https://")) {
    throw new Error("Invalid environment configuration: production APP_URL must be https");
  }

  return {
    ...base.data,
    ...mail.data,
    DATABASE_URL: resolveDatabaseUrl(source),
    IS_PRODUCTION: isProduction,
  };
}

export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
