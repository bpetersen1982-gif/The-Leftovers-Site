import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import { generateToken, hashToken, isWellFormedToken } from "../tokens";
import { UserServiceError } from "./errors";

/**
 * User and invite operations (requirements AUTH-1, AUTH-4, AUTH-5, AUTH-6).
 *
 * Every function takes the Prisma client as a parameter so it can be tested against
 * a real database, and every state change writes its audit row in the same transaction.
 * Callers must check permissions before calling; these functions enforce data invariants.
 */

export const INVITE_TTL_HOURS = 72;

interface RequestMeta {
  readonly requestId?: string | null;
}

export interface CreatedInvite {
  readonly inviteId: string;
  /** Raw token for the invite link. Returned once, never stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Creates an invite and revokes any earlier pending invite for the same email,
 * so only the newest link works.
 */
export async function createInvite(
  prisma: PrismaClient,
  input: { actor: AuditActor; email: string; name: string; role: Role } & RequestMeta,
  now: Date = new Date(),
): Promise<CreatedInvite> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000);

  const invite = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: input.email },
      select: { deactivatedAt: true },
    });
    if (existing && existing.deactivatedAt === null) {
      throw new UserServiceError("EMAIL_ALREADY_ACTIVE");
    }

    const superseded = await tx.invite.updateMany({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });

    const created = await tx.invite.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt,
        invitedById: input.actor.id,
      },
      select: { id: true },
    });

    await writeAudit(tx, {
      actor: input.actor,
      action: "invite.create",
      targetType: "invite",
      targetId: created.id,
      after: { name: input.name, role: input.role, expiresAt: expiresAt.toISOString(), supersededCount: superseded.count },
      requestId: input.requestId,
    });
    return created;
  });

  return { inviteId: invite.id, token, expiresAt };
}

export async function revokeInvite(
  prisma: PrismaClient,
  input: { actor: AuditActor; inviteId: string } & RequestMeta,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const result = await tx.invite.updateMany({
      where: { id: input.inviteId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (result.count !== 1) throw new UserServiceError("INVITE_NOT_PENDING");
    await writeAudit(tx, {
      actor: input.actor,
      action: "invite.revoke",
      targetType: "invite",
      targetId: input.inviteId,
      requestId: input.requestId,
    });
  });
}

export interface AcceptedInvite {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

/**
 * Consumes an invite token and creates (or reactivates) the user.
 *
 * The token is claimed with a conditional UPDATE, so if two requests race with the
 * same link exactly one wins; the other gets INVITE_USED.
 */
export async function acceptInvite(
  prisma: PrismaClient,
  input: { token: string } & RequestMeta,
  now: Date = new Date(),
): Promise<AcceptedInvite> {
  if (!isWellFormedToken(input.token)) throw new UserServiceError("INVITE_INVALID");
  const tokenHash = hashToken(input.token);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invite.updateMany({
      where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });

    const invite = await tx.invite.findUnique({ where: { tokenHash } });
    if (!invite) throw new UserServiceError("INVITE_INVALID");
    if (claimed.count !== 1) {
      if (invite.revokedAt) throw new UserServiceError("INVITE_REVOKED");
      if (invite.acceptedAt) throw new UserServiceError("INVITE_USED");
      throw new UserServiceError("INVITE_EXPIRED");
    }

    const existing = await tx.user.findUnique({ where: { email: invite.email } });
    let userId: string;
    if (existing) {
      // Normally only a previously removed user. If the email became an active account
      // after the invite was sent (e.g. bootstrap), refuse rather than change that
      // account's role; the whole transaction, including the claim, rolls back.
      if (existing.deactivatedAt === null) throw new UserServiceError("EMAIL_ALREADY_ACTIVE");
      await tx.user.update({
        where: { id: existing.id },
        data: { deactivatedAt: null, role: invite.role, name: invite.name, emailVerified: true },
      });
      userId = existing.id;
    } else {
      const created = await tx.user.create({
        data: {
          id: randomUUID(),
          email: invite.email,
          name: invite.name,
          role: invite.role,
          emailVerified: true,
        },
        select: { id: true },
      });
      userId = created.id;
    }

    await tx.invite.update({ where: { id: invite.id }, data: { acceptedById: userId } });
    await writeAudit(tx, {
      actor: null,
      action: "invite.accept",
      targetType: "invite",
      targetId: invite.id,
      after: { userId, role: invite.role, reactivated: Boolean(existing) },
      requestId: input.requestId,
    });

    return { userId, email: invite.email, name: invite.name };
  });
}

/**
 * Locks every active Admin row for the rest of the transaction. Two Admins demoting
 * each other at the same moment serialize here, so the "at least one Admin" rule holds.
 */
async function lockActiveAdmins(tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "user" WHERE role = 'ADMIN' AND "deactivatedAt" IS NULL FOR UPDATE`;
  return rows.map((row) => row.id);
}

export async function changeRole(
  prisma: PrismaClient,
  input: { actor: AuditActor; userId: string; role: Role } & RequestMeta,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const admins = await lockActiveAdmins(tx);
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.deactivatedAt) throw new UserServiceError("USER_NOT_FOUND");
    if (user.role === input.role) throw new UserServiceError("ALREADY_IN_STATE");
    if (user.role === "ADMIN" && admins.length <= 1) throw new UserServiceError("LAST_ADMIN");

    await tx.user.update({ where: { id: user.id }, data: { role: input.role } });
    // AUTH-4: role changes end every session so the new permissions apply immediately.
    await tx.session.deleteMany({ where: { userId: user.id } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "user.roleChange",
      targetType: "user",
      targetId: user.id,
      before: { role: user.role },
      after: { role: input.role },
      requestId: input.requestId,
    });
  });
}

export async function deactivateUser(
  prisma: PrismaClient,
  input: { actor: AuditActor; userId: string } & RequestMeta,
  now: Date = new Date(),
): Promise<void> {
  if (input.userId === input.actor.id) throw new UserServiceError("CANNOT_DEACTIVATE_SELF");
  await prisma.$transaction(async (tx) => {
    const admins = await lockActiveAdmins(tx);
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new UserServiceError("USER_NOT_FOUND");
    if (user.deactivatedAt) throw new UserServiceError("ALREADY_IN_STATE");
    if (user.role === "ADMIN" && admins.length <= 1) throw new UserServiceError("LAST_ADMIN");

    await tx.user.update({ where: { id: user.id }, data: { deactivatedAt: now } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.invite.updateMany({
      where: { email: user.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "user.deactivate",
      targetType: "user",
      targetId: user.id,
      before: { role: user.role },
      requestId: input.requestId,
    });
  });
}

export interface BootstrapResult {
  readonly status: "created" | "already-admin";
  readonly userId: string;
}

/**
 * Creates an initial Admin from the CLI (requirements §2.1). Idempotent for an
 * existing Admin; refuses to change anyone else's role or reactivate anyone.
 */
export async function bootstrapAdmin(
  prisma: PrismaClient,
  input: { email: string; name: string },
): Promise<BootstrapResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (existing.role === "ADMIN" && existing.deactivatedAt === null) {
        return { status: "already-admin", userId: existing.id };
      }
      throw new Error(
        "A user with that email exists but is not an active Admin. Bootstrap never changes existing users; use the admin area.",
      );
    }
    const user = await tx.user.create({
      data: { id: randomUUID(), email: input.email, name: input.name, role: "ADMIN", emailVerified: true },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor: null,
      action: "user.bootstrap",
      targetType: "user",
      targetId: user.id,
      after: { role: "ADMIN" },
    });
    return { status: "created", userId: user.id };
  });
}
