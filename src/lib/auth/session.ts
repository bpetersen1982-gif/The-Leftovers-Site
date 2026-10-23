import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { db } from "../db";
import { type Permission, can } from "../permissions";
import { auth } from "./auth";

export interface CurrentUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

/**
 * The signed-in, active user, or null. Role is read from the database on every call
 * (not from the session cookie), so role changes and removals take effect immediately.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db().user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt !== null) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/** For pages and actions: redirects to login if signed out, 403 if not permitted. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, permission)) forbidden();
  return user;
}
