import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import type { OutgoingEmail } from "@/lib/mail/mailer";
import {
  checkConfirmToken,
  checkUnsubscribeToken,
  confirmSubscription,
  exportSubscribersCsv,
  listSubscribers,
  purgeStalePending,
  removeSubscriber,
  requestSubscription,
  unsubscribe,
} from "@/lib/mailing/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const sent: OutgoingEmail[] = [];
let clock = new Date("2026-11-12T18:00:00Z");
const deps = { prisma, appUrl: "https://theleftoversband.com", send: async (message: OutgoingEmail) => void sent.push(message), now: () => clock };
let ip = 0;
const nextIp = () => ({ ip: `198.51.100.${(ip += 1)}` });

function tokenFrom(message: OutgoingEmail | undefined, path: "confirm" | "unsubscribe"): string {
  const match = new RegExp(`/mailing-list/${path}\\?token=([A-Za-z0-9_-]{43})`).exec(message?.text ?? "");
  if (!match?.[1]) throw new Error(`no ${path} link`);
  return match[1];
}

async function admin(role: Role = "ADMIN") {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: role, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role };
}

beforeEach(async () => {
  await resetDatabase(prisma);
  sent.length = 0;
  clock = new Date("2026-11-12T18:00:00Z");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("double opt-in", () => {
  it("adds someone only after they confirm, then lets them leave", async () => {
    expect(await requestSubscription(deps, "  Fan@Example.TEST ", nextIp())).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "fan@example.test", subject: "Confirm you want The Leftovers' show emails" });
    expect((await prisma.subscriber.findUniqueOrThrow({ where: { email: "fan@example.test" } })).status).toBe("PENDING");

    const confirm = tokenFrom(sent[0], "confirm");
    expect(await checkConfirmToken(prisma, confirm, clock)).toBe("valid");
    expect(await confirmSubscription(prisma, confirm, clock)).toBe(true);
    expect(await confirmSubscription(prisma, confirm, clock)).toBe(false);
    expect(await prisma.subscriber.findUniqueOrThrow({ where: { email: "fan@example.test" } })).toMatchObject({ status: "CONFIRMED", confirmedAt: clock });

    const leave = tokenFrom(sent[0], "unsubscribe");
    expect(await checkUnsubscribeToken(prisma, leave)).toBe("valid");
    expect(await unsubscribe(prisma, leave)).toBe(true);
    expect(await prisma.subscriber.count()).toBe(0);
    expect(await unsubscribe(prisma, leave)).toBe(false);
  });

  it("doesn't reveal who's subscribed, and doesn't let anyone flood an inbox", async () => {
    await requestSubscription(deps, "fan@example.test", nextIp());
    await confirmSubscription(prisma, tokenFrom(sent[0], "confirm"), clock);
    // Already confirmed: no email, same outcome shape for the visitor (handled in the action).
    expect(await requestSubscription(deps, "fan@example.test", nextIp())).toBe("alreadyConfirmed");
    expect(sent).toHaveLength(1);

    expect(await requestSubscription(deps, "other@example.test", nextIp())).toBe("sent");
    expect(await requestSubscription(deps, "other@example.test", nextIp())).toBe("recentlySent");
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect(await requestSubscription(deps, "other@example.test", nextIp())).toBe("sent");
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect(await requestSubscription(deps, "other@example.test", nextIp())).toBe("sent");
    clock = new Date(clock.getTime() + 11 * 60_000);
    // 3 emails per address per day, whoever asks.
    expect(await requestSubscription(deps, "other@example.test", nextIp())).toBe("recentlySent");
    expect(sent.filter((message) => message.to === "other@example.test")).toHaveLength(3);

    const sameIp = { ip: "203.0.113.50" };
    for (let i = 0; i < 5; i += 1) await requestSubscription(deps, `fan${i}@example.test`, sameIp);
    expect(await requestSubscription(deps, "fan9@example.test", sameIp)).toBe("rateLimited");
  });

  it("only the newest confirmation link works, links expire, and stale sign-ups are deleted", async () => {
    await requestSubscription(deps, "fan@example.test", nextIp());
    const first = tokenFrom(sent[0], "confirm");
    clock = new Date(clock.getTime() + 11 * 60_000);
    await requestSubscription(deps, "fan@example.test", nextIp());
    expect(await checkConfirmToken(prisma, first, clock)).toBe("invalid");
    const second = tokenFrom(sent[1], "confirm");
    expect(await confirmSubscription(prisma, second, new Date(clock.getTime() + 8 * 86_400_000))).toBe(false);
    expect(await checkConfirmToken(prisma, "not-a-token", clock)).toBe("invalid");

    // createdAt is set by the database (real time), so measure the retention from it.
    const { createdAt } = await prisma.subscriber.findUniqueOrThrow({ where: { email: "fan@example.test" } });
    expect(await purgeStalePending(prisma, new Date(createdAt.getTime() + 29 * 86_400_000))).toBe(0);
    expect(await purgeStalePending(prisma, new Date(createdAt.getTime() + 31 * 86_400_000))).toBe(1);
    expect(await prisma.subscriber.count()).toBe(0);
  });
});

describe("Admin tools", () => {
  it("lists and exports confirmed subscribers only, and keeps spreadsheet formulas inert", async () => {
    const erik = await admin();
    const jim = await admin("MEMBER");
    for (const email of ["a@example.test", "+cmd@example.test", "pending@example.test"]) await requestSubscription(deps, email, nextIp());
    for (const message of sent.filter((m) => m.to !== "pending@example.test")) await confirmSubscription(prisma, tokenFrom(message, "confirm"), clock);

    await expect(listSubscribers(prisma, jim, { search: "", page: 1 })).rejects.toThrow(/Only Admins/);
    const list = await listSubscribers(prisma, erik, { search: "", page: 1 });
    expect(list).toMatchObject({ confirmed: 2, pending: 1 });
    expect((await listSubscribers(prisma, erik, { search: "+CMD", page: 1 })).rows.map((row) => row.email)).toEqual(["+cmd@example.test"]);

    const { csv, count } = await exportSubscribersCsv(prisma, erik);
    expect(count).toBe(2);
    expect(csv.split("\r\n")).toEqual(["email,confirmed_at", `a@example.test,${clock.toISOString()}`, `'+cmd@example.test,${clock.toISOString()}`, ""]);
    expect(await prisma.auditLog.count({ where: { action: "mailing.export" } })).toBe(1);

    const target = list.rows.find((row) => row.email === "a@example.test");
    await removeSubscriber(prisma, erik, target?.id ?? "");
    expect(await prisma.subscriber.count({ where: { status: "CONFIRMED" } })).toBe(1);
    expect(JSON.stringify(await prisma.auditLog.findFirstOrThrow({ where: { action: "mailing.remove" } }))).not.toContain("a@example.test");
  });
});
