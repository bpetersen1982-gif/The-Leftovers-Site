import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "../db";
import { env } from "../env";
import { logger, maskEmail } from "../logger";
import { sendEmail } from "../mail/mailer";
import { magicLinkEmail } from "../mail/templates";
import { tryCapture } from "./magic-link-capture";

/**
 * Authentication (requirements AUTH-1..AUTH-5).
 *
 * - Invite-only: no sign-up, no passwords. Users exist only via invite or bootstrap.
 * - Login: emailed magic link, or a passkey added after first login.
 * - Removed (deactivated) users get no link and can't start a session.
 */

export const MAGIC_LINK_TTL_MINUTES = 15;

async function findActiveUserByEmail(email: string) {
  const user = await db().user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { name: true, deactivatedAt: true },
  });
  return user && user.deactivatedAt === null ? user : null;
}

function createAuth() {
  const config = env();
  const appUrl = new URL(config.APP_URL);

  return betterAuth({
    appName: "The Leftovers",
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    database: prismaAdapter(db(), { provider: "postgresql" }),
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        role: { type: "string", input: false, required: false, defaultValue: "MEMBER" },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/magic-link": { window: 600, max: 5 },
        "/magic-link/verify": { window: 600, max: 20 },
        "/passkey/*": { window: 60, max: 20 },
      },
    },
    advanced: {
      useSecureCookies: config.IS_PRODUCTION,
      ipAddress: {
        // Railway's edge sets X-Real-IP to the connecting client address.
        ipAddressHeaders: ["x-real-ip"],
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Defense in depth: even with a valid link or passkey, a removed user gets no session.
          before: async (session) => {
            const user = await db().user.findUnique({
              where: { id: session.userId },
              select: { deactivatedAt: true },
            });
            if (!user || user.deactivatedAt !== null) {
              logger.warn({ userId: session.userId }, "session refused for inactive user");
              return false;
            }
          },
        },
      },
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: MAGIC_LINK_TTL_MINUTES * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url, metadata }) => {
          const user = await findActiveUserByEmail(email);
          if (!user) {
            // Same response as success, so the form can't be used to discover who has an account.
            logger.info({ to: maskEmail(email) }, "magic link requested for unknown or inactive email; not sent");
            return;
          }
          if (tryCapture(metadata?.captureId, url)) return;
          await sendEmail(
            magicLinkEmail({ to: email, name: user.name, url, expiresMinutes: MAGIC_LINK_TTL_MINUTES }),
            { kind: "magic-link" },
          );
        },
      }),
      passkey({
        rpID: appUrl.hostname,
        rpName: "The Leftovers",
        origin: config.APP_URL,
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Lazily created so `next build` doesn't need runtime secrets. */
export function auth(): Auth {
  instance ??= createAuth();
  return instance;
}
