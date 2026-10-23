import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

/** Every audited action. Adding one here is required before it can be logged. */
export const AUDIT_ACTION_LABELS = {
  "user.bootstrap": "Created initial Admin",
  "invite.create": "Sent invite",
  "invite.revoke": "Cancelled invite",
  "invite.accept": "Accepted invite",
  "user.roleChange": "Changed role",
  "user.deactivate": "Removed user",
  "user.reactivate": "Reactivated user",
  "page.update": "Edited page",
  "member.create": "Added band member",
  "member.update": "Edited band member",
  "member.delete": "Deleted band member",
  "member.reorder": "Reordered band members",
  "settings.update": "Changed site settings",
  "availability.create": "Added out-of-office dates",
  "availability.delete": "Removed out-of-office dates",
  "pricing.update": "Changed pricing",
  "pricing.clearRates": "Cleared all rates",
  "specialDate.add": "Added special date",
  "specialDate.remove": "Removed special date",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;

export type AuditTargetType = "user" | "invite" | "page" | "bandMember" | "siteSettings" | "availabilityBlock" | "pricing" | "specialDate";

export interface AuditActor {
  readonly id: string;
  readonly role: Role;
}

export interface AuditEntry {
  readonly actor: AuditActor | null;
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
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
