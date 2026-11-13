import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "../env";
import { logger } from "../logger";
import { sendEmail } from "../mail/mailer";
import { emailLayout, escapeHtml } from "../mail/templates";
import { can } from "../permissions";

/**
 * Watches the nightly database backup (requirements OPS-4). The backup job records a
 * heartbeat in job_state when it finishes; if that's more than 30 hours old, Admins get one
 * email a day until backups resume. No heartbeat at all means backups aren't set up here
 * (local development), so nothing is sent.
 */

export const BACKUP_HEARTBEAT = "postgres-backup";
const ALERT_STATE = "postgres-backup-alert";
const STALE_MS = 30 * 3_600_000;
const ALERT_EVERY_MS = 24 * 3_600_000;

export function backupAlertEmail(to: string, lastRunAt: Date, appUrl: string) {
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago" }).format(lastRunAt);
  const body = `The nightly database backup hasn't finished since ${when}. The site is still running, but if the database were lost now, changes since then couldn't be recovered. Check the "backup" service in Railway for errors (see docs/backups.md in the repository).`;
  return {
    to,
    subject: "Database backups have stopped: The Leftovers",
    text: `${body}\n\n${appUrl}/admin\n`,
    html: emailLayout({ heading: "Backups have stopped", body: escapeHtml(body), actionLabel: "Open the band site", actionUrl: `${appUrl}/admin`, footer: "You'll get this once a day until a backup finishes." }),
  };
}

export async function checkBackupHeartbeat(prisma: PrismaClient, now: Date = new Date()): Promise<"ok" | "notConfigured" | "alerted" | "alreadyAlerted"> {
  const heartbeat = await prisma.jobState.findUnique({ where: { name: BACKUP_HEARTBEAT } });
  if (!heartbeat) return "notConfigured";
  if (now.getTime() - heartbeat.lastRunAt.getTime() <= STALE_MS) return "ok";

  // Claim today's alert atomically so several app instances send it once.
  const claimed = await prisma.$executeRaw`
    INSERT INTO "job_state" ("name", "lastRunAt") VALUES (${ALERT_STATE}, ${now})
    ON CONFLICT ("name") DO UPDATE SET "lastRunAt" = EXCLUDED."lastRunAt"
    WHERE "job_state"."lastRunAt" < ${new Date(now.getTime() - ALERT_EVERY_MS)}`;
  if (claimed === 0) return "alreadyAlerted";

  logger.error({ lastBackupAt: heartbeat.lastRunAt.toISOString() }, "database backups are stale");
  const admins = (await prisma.user.findMany({ where: { deactivatedAt: null }, select: { email: true, role: true } })).filter((user) => can(user.role, "users:view"));
  const appUrl = env().APP_URL;
  for (const admin of admins) {
    await sendEmail(backupAlertEmail(admin.email, heartbeat.lastRunAt, appUrl), { kind: "backup-alert" }).catch(() => undefined);
  }
  return "alerted";
}
