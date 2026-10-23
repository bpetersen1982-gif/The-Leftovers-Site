import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { hashToken, isWellFormedToken } from "../tokens";

export type InviteLookup =
  | { status: "pending"; name: string; role: Role; expiresAt: Date }
  | { status: "invalid" | "expired" | "used" | "revoked" };

/** Read-only check used to render the invite page. Doesn't consume the invite. */
export async function lookupInvite(prisma: PrismaClient, token: string, now: Date = new Date()): Promise<InviteLookup> {
  if (!isWellFormedToken(token)) return { status: "invalid" };
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { name: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true },
  });
  if (!invite) return { status: "invalid" };
  if (invite.revokedAt) return { status: "revoked" };
  if (invite.acceptedAt) return { status: "used" };
  if (invite.expiresAt <= now) return { status: "expired" };
  return { status: "pending", name: invite.name, role: invite.role, expiresAt: invite.expiresAt };
}

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly createdAt: Date;
  readonly hasPasskey: boolean;
  readonly lastSeenAt: Date | null;
}

export async function listActiveUsers(prisma: PrismaClient): Promise<UserRow[]> {
  const users = await prisma.user.findMany({
    where: { deactivatedAt: null },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { passkeys: true } },
      sessions: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
    },
  });
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    hasPasskey: user._count.passkeys > 0,
    lastSeenAt: user.sessions[0]?.updatedAt ?? null,
  }));
}

export interface PendingInviteRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly expiresAt: Date;
  readonly invitedByName: string;
}

export async function listPendingInvites(prisma: PrismaClient, now: Date = new Date()): Promise<PendingInviteRow[]> {
  const invites = await prisma.invite.findMany({
    where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, role: true, expiresAt: true, invitedBy: { select: { name: true } } },
  });
  return invites.map((invite) => ({
    id: invite.id,
    name: invite.name,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    invitedByName: invite.invitedBy.name,
  }));
}
