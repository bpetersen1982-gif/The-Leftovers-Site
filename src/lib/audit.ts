import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

/** Every audited action. Adding one here is required before it can be logged. */
export type AuditAction =
  | "user.bootstrap"
  | "invite.create"
  | "invite.revoke"
  | "invite.accept"
  | "user.roleChange"
  | "user.deactivate"
  | "user.reactivate";

export interface AuditActor {
  readonly id: string;
  readonly role: Role;
}

export interface AuditEntry {
  readonly actor: AuditActor | null;
  readonly action: AuditAction;
  readonly targetType: "user" | "invite";
  readonly targetId: string;
  readonly before?: Prisma.InputJsonValue;
  readonly after?: Prisma.InputJsonValue;
  readonly requestId?: string | null;
}

/**
 * Writes an audit row. Takes a transaction client so the audit entry commits or
 * rolls back together with the change it describes. Never put tokens or secrets
 * in before/after.
 */
export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      requestId: entry.requestId ?? null,
    },
  });
}
