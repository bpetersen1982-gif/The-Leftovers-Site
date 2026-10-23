import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { UserServiceError } from "@/lib/users/errors";
import { lookupInvite } from "@/lib/users/queries";
import {
  INVITE_TTL_HOURS,
  acceptInvite,
  bootstrapAdmin,
  changeRole,
  createInvite,
  deactivateUser,
  revokeInvite,
} from "@/lib/users/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();

async function makeUser(role: Role, name = `User ${role}`) {
  const user = await prisma.user.create({
    data: { id: randomUUID(), email: `${randomUUID()}@example.test`, name, role, emailVerified: true },
  });
  return { id: user.id, role: user.role, email: user.email };
}

async function expectCode(promise: Promise<unknown>, code: UserServiceError["code"]) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof UserServiceError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createInvite", () => {
  it("stores only a hash of the token and writes an audit row", async () => {
    const admin = await makeUser("ADMIN");
    const { inviteId, token } = await createInvite(prisma, { actor: admin, email: "new@example.test", name: "New", role: "MEMBER" });

    const stored = await prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const audit = await prisma.auditLog.findMany({ where: { targetId: inviteId } });
    expect(audit.map((row) => row.action)).toEqual(["invite.create"]);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("sets a 72 hour expiry", async () => {
    const admin = await makeUser("ADMIN");
    const now = new Date("2026-10-23T12:00:00Z");
    const { expiresAt } = await createInvite(prisma, { actor: admin, email: "a@example.test", name: "A", role: "MEMBER" }, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_HOURS * 3_600_000);
  });

  it("refuses an email that already has an active account", async () => {
    const admin = await makeUser("ADMIN");
    await expectCode(createInvite(prisma, { actor: admin, email: admin.email, name: "Dup", role: "MEMBER" }), "EMAIL_ALREADY_ACTIVE");
  });

  it("revokes the previous pending invite for the same email", async () => {
    const admin = await makeUser("ADMIN");
    const first = await createInvite(prisma, { actor: admin, email: "x@example.test", name: "X", role: "MEMBER" });
    await createInvite(prisma, { actor: admin, email: "x@example.test", name: "X", role: "MEMBER" });
    expect((await lookupInvite(prisma, first.token)).status).toBe("revoked");
  });
});

describe("acceptInvite", () => {
  it("creates an active, verified user with the invited role", async () => {
    const admin = await makeUser("ADMIN");
    const { token } = await createInvite(prisma, { actor: admin, email: "jake@example.test", name: "Jake", role: "MEMBER" });

    const accepted = await acceptInvite(prisma, { token });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(user).toMatchObject({ email: "jake@example.test", name: "Jake", role: "MEMBER", emailVerified: true, deactivatedAt: null });
  });

  it("works only once", async () => {
    const admin = await makeUser("ADMIN");
    const { token } = await createInvite(prisma, { actor: admin, email: "once@example.test", name: "Once", role: "MEMBER" });
    await acceptInvite(prisma, { token });
    await expectCode(acceptInvite(prisma, { token }), "INVITE_USED");
  });

  it("lets exactly one of two simultaneous accepts win", async () => {
    const admin = await makeUser("ADMIN");
    const { token } = await createInvite(prisma, { actor: admin, email: "race@example.test", name: "Race", role: "MEMBER" });

    const results = await Promise.allSettled([acceptInvite(prisma, { token }), acceptInvite(prisma, { token })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: "race@example.test" } })).toBe(1);
  });

  it("rejects expired, revoked, malformed, and unknown tokens", async () => {
    const admin = await makeUser("ADMIN");
    const created = new Date("2026-01-01T00:00:00Z");
    const expired = await createInvite(prisma, { actor: admin, email: "old@example.test", name: "Old", role: "MEMBER" }, created);
    await expectCode(acceptInvite(prisma, { token: expired.token }, new Date("2026-01-04T00:00:01Z")), "INVITE_EXPIRED");

    const revoked = await createInvite(prisma, { actor: admin, email: "rev@example.test", name: "Rev", role: "MEMBER" });
    await revokeInvite(prisma, { actor: admin, inviteId: revoked.inviteId });
    await expectCode(acceptInvite(prisma, { token: revoked.token }), "INVITE_REVOKED");

    await expectCode(acceptInvite(prisma, { token: "not-a-token" }), "INVITE_INVALID");
    await expectCode(acceptInvite(prisma, { token: "A".repeat(43) }), "INVITE_INVALID");
  });

  it("reactivates a previously removed user with the new role", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await prisma.user.create({ data: { id: randomUUID(), email: "spare@example.test", name: "Spare", role: "ADMIN" } });
    await deactivateUser(prisma, { actor: admin, userId: member.id });

    const { token } = await createInvite(prisma, { actor: admin, email: member.email, name: "Back", role: "ADMIN" });
    const accepted = await acceptInvite(prisma, { token });
    expect(accepted.userId).toBe(member.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(user).toMatchObject({ deactivatedAt: null, role: "ADMIN", name: "Back" });
  });

  it("rolls back the claim if the email became an active account after the invite was sent", async () => {
    const admin = await makeUser("ADMIN");
    const { token } = await createInvite(prisma, { actor: admin, email: "late@example.test", name: "Late", role: "MEMBER" });
    await bootstrapAdmin(prisma, { email: "late@example.test", name: "Late" });

    await expectCode(acceptInvite(prisma, { token }), "EMAIL_ALREADY_ACTIVE");
    expect((await lookupInvite(prisma, token)).status).toBe("pending");
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "late@example.test" } })).role).toBe("ADMIN");
  });
});

describe("changeRole", () => {
  it("changes the role, ends the user's sessions, and audits before/after", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await prisma.session.create({
      data: { id: randomUUID(), token: randomUUID(), userId: member.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await changeRole(prisma, { actor: admin, userId: member.id, role: "ADMIN" });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("ADMIN");
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.roleChange" } });
    expect(audit).toMatchObject({ actorId: admin.id, before: { role: "MEMBER" }, after: { role: "ADMIN" } });
  });

  it("never demotes the last active Admin", async () => {
    const admin = await makeUser("ADMIN");
    await expectCode(changeRole(prisma, { actor: admin, userId: admin.id, role: "MEMBER" }), "LAST_ADMIN");
  });

  it("keeps at least one Admin when two Admins demote each other at the same time", async () => {
    const a = await makeUser("ADMIN", "A");
    const b = await makeUser("ADMIN", "B");
    const results = await Promise.allSettled([
      changeRole(prisma, { actor: a, userId: b.id, role: "MEMBER" }),
      changeRole(prisma, { actor: b, userId: a.id, role: "MEMBER" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: "ADMIN", deactivatedAt: null } })).toBe(1);
  });
});

describe("deactivateUser", () => {
  it("deactivates the user and ends their sessions", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await prisma.session.create({
      data: { id: randomUUID(), token: randomUUID(), userId: member.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await deactivateUser(prisma, { actor: admin, userId: member.id });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(user.deactivatedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(0);
  });

  it("refuses to remove yourself or the last Admin", async () => {
    const admin = await makeUser("ADMIN");
    await expectCode(deactivateUser(prisma, { actor: admin, userId: admin.id }), "CANNOT_DEACTIVATE_SELF");

    const member = await makeUser("MEMBER");
    await changeRole(prisma, { actor: admin, userId: member.id, role: "ADMIN" });
    await deactivateUser(prisma, { actor: { id: member.id, role: "ADMIN" }, userId: admin.id });
    const other = await makeUser("MEMBER");
    await expectCode(deactivateUser(prisma, { actor: other, userId: member.id }), "LAST_ADMIN");
  });
});

describe("bootstrapAdmin", () => {
  it("creates an Admin once and is idempotent afterwards", async () => {
    const first = await bootstrapAdmin(prisma, { email: "boot@example.test", name: "Boot" });
    const second = await bootstrapAdmin(prisma, { email: "boot@example.test", name: "Boot" });
    expect(first.status).toBe("created");
    expect(second).toEqual({ status: "already-admin", userId: first.userId });
    expect(await prisma.auditLog.count({ where: { action: "user.bootstrap" } })).toBe(1);
  });

  it("never promotes an existing non-Admin", async () => {
    const member = await makeUser("MEMBER");
    await expect(bootstrapAdmin(prisma, { email: member.email, name: "Nope" })).rejects.toThrow(/never changes existing users/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("MEMBER");
  });
});
