import type { Role } from "@/generated/prisma/enums";

/**
 * Permission matrix (requirements §2.3). The single source of truth for "who can do what";
 * every server action checks through `can()`. UI hiding is cosmetic only.
 *
 * Only permissions implemented so far are listed; later waves add theirs here.
 */
export const PERMISSIONS = {
  "admin:access": ["ADMIN", "MEMBER"],
  "users:view": ["ADMIN"],
  "users:invite": ["ADMIN"],
  "users:changeRole": ["ADMIN"],
  "users:deactivate": ["ADMIN"],
  "audit:view": ["ADMIN"],
  "account:managePasskeys": ["ADMIN", "MEMBER"],
  "content:edit": ["ADMIN"],
  "members:edit": ["ADMIN"],
  "settings:edit": ["ADMIN"],
  "availability:view": ["ADMIN", "MEMBER"],
  "availability:manageOwn": ["ADMIN", "MEMBER"],
  "availability:manageAll": ["ADMIN"],
  "availability:manageBand": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MEMBER: "Band Member",
};
