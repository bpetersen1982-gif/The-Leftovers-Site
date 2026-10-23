import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env, type ServerEnv } from "../env";
import { logger, maskEmail } from "../logger";

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}

export class MailDeliveryError extends Error {
  override readonly name = "MailDeliveryError";
}

const SEND_TIMEOUT_MS = 10_000;

/** Resend (production). */
function createResendMailer(config: Extract<ServerEnv, { MAIL_TRANSPORT: "resend" }>): Mailer {
  const client = new Resend(config.RESEND_API_KEY);
  return {
    async send(message) {
      const { error } = await client.emails.send({
        from: config.MAIL_FROM,
        replyTo: config.MAIL_REPLY_TO,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (error) {
        throw new MailDeliveryError(`Resend rejected message: ${error.name}: ${error.message}`);
      }
    },
  };
}

/** SMTP (local Mailpit inbox in development and tests). */
function createSmtpMailer(config: Extract<ServerEnv, { MAIL_TRANSPORT: "smtp" }>): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    connectionTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: config.MAIL_FROM,
        replyTo: config.MAIL_REPLY_TO,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

let cached: Mailer | undefined;

function mailer(): Mailer {
  if (cached) return cached;
  const config = env();
  cached = config.MAIL_TRANSPORT === "resend" ? createResendMailer(config) : createSmtpMailer(config);
  return cached;
}

/**
 * Sends an email. Failures are logged with context and re-thrown so callers can
 * tell the user the email didn't go out (never silently dropped).
 */
export async function sendEmail(message: OutgoingEmail, context: { kind: string }): Promise<void> {
  const started = Date.now();
  try {
    await mailer().send(message);
    logger.info(
      { kind: context.kind, to: maskEmail(message.to), ms: Date.now() - started },
      "email sent",
    );
  } catch (error) {
    logger.error(
      { kind: context.kind, to: maskEmail(message.to), err: error },
      "email delivery failed",
    );
    throw error instanceof MailDeliveryError
      ? error
      : new MailDeliveryError("Email delivery failed", { cause: error });
  }
}
