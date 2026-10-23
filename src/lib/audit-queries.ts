import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { AUDIT_ACTION_LABELS, type AuditAction } from "./audit";

export const AUDIT_PAGE_SIZE = 50;

export interface AuditRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly actorName: string;
  readonly actorRole: Role | null;
  readonly action: string;
  readonly actionLabel: string;
  readonly targetType: string;
  readonly targetId: string | null;
}

/**
 * Newest-first audit entries, keyset-paginated: pass the last row's (createdAt, id)
 * to get the next page. Stable even while new entries arrive.
 */
export async function listAuditLog(
  prisma: PrismaClient,
  cursor?: { createdAt: Date; id: string },
): Promise<{ rows: AuditRow[]; next: { createdAt: Date; id: string } | null }> {
  const rows = await prisma.auditLog.findMany({
    where: cursor
      ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
      : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_PAGE_SIZE + 1,
    select: {
      id: true,
      createdAt: true,
      actorRole: true,
      action: true,
      targetType: true,
      targetId: true,
      actor: { select: { name: true } },
    },
  });
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      actorName: row.actor?.name ?? "System",
      actorRole: row.actorRole,
      action: row.action,
      actionLabel: AUDIT_ACTION_LABELS[row.action as AuditAction] ?? row.action,
      targetType: row.targetType,
      targetId: row.targetId,
    })),
    next: rows.length > AUDIT_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
