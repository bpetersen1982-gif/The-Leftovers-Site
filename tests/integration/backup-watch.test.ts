import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "../support/test-db";

const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/mail/mailer", () => ({ sendEmail: async (message: { to: string; subject: string }) => void sent.push({ to: message.to, subject: message.subject }) }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "https://theleftoversband.com" }) }));
const { BACKUP_HEARTBEAT, checkBackupHeartbeat } = await import("@/lib/jobs/backup-watch");

const prisma = createTestClient();
const HOUR = 3_600_000;
const NOW = new Date("2026-11-13T15:00:00Z");

beforeEach(async () => {
  await resetDatabase(prisma);
  sent.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backup heartbeat", () => {
  it("stays quiet when backups aren't set up or are fresh, and alerts Admins once a day when stale", async () => {
    const admin = await prisma.user.create({ data: { id: randomUUID(), name: "Erik", email: "erik@example.test", role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: randomUUID(), name: "Jim", email: "jim@example.test", role: "MEMBER", emailVerified: true } });
    expect(await checkBackupHeartbeat(prisma, NOW)).toBe("notConfigured");

    await prisma.jobState.create({ data: { name: BACKUP_HEARTBEAT, lastRunAt: new Date(NOW.getTime() - 20 * HOUR) } });
    expect(await checkBackupHeartbeat(prisma, NOW)).toBe("ok");

    const later = new Date(NOW.getTime() + 11 * HOUR); // 31 hours since the last backup
    const results = await Promise.all([checkBackupHeartbeat(prisma, later), checkBackupHeartbeat(prisma, later)]);
    expect(results.sort()).toEqual(["alerted", "alreadyAlerted"]);
    expect(sent).toEqual([{ to: admin.email, subject: "Database backups have stopped: The Leftovers" }]);
    expect(await checkBackupHeartbeat(prisma, new Date(later.getTime() + 10 * HOUR))).toBe("alreadyAlerted");
    expect(await checkBackupHeartbeat(prisma, new Date(later.getTime() + 25 * HOUR))).toBe("alerted");

    await prisma.jobState.update({ where: { name: BACKUP_HEARTBEAT }, data: { lastRunAt: new Date(later.getTime() + 25 * HOUR) } });
    expect(await checkBackupHeartbeat(prisma, new Date(later.getTime() + 26 * HOUR))).toBe("ok");
  });
});
