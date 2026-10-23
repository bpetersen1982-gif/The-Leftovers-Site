import pino from "pino";

/**
 * Structured JSON logger. Secrets and personal data are redacted by path, so a
 * careless `logger.info({ user })` can't leak tokens or emails into Railway logs.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "leftovers-web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.token",
      "*.tokenHash",
      "*.password",
      "*.secret",
      "*.apiKey",
      "*.email",
      "*.url",
      "token",
      "url",
      "email",
      "headers.cookie",
      "headers.authorization",
    ],
    censor: "[redacted]",
  },
});

/** Hides the local part of an email for logs: "erik@example.com" -> "e***@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
