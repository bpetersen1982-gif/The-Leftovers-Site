import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { requirePermission } from "@/lib/auth/session";
import { ROLE_LABELS, can } from "@/lib/permissions";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: { default: "Band admin", template: "%s | Band admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  const user = await requirePermission("admin:access");

  const links = [
    { href: "/admin", label: "Home" },
    ...(can(user.role, "content:edit") ? [{ href: "/admin/pages", label: "Pages" }] : []),
    ...(can(user.role, "members:edit") ? [{ href: "/admin/members", label: "Members" }] : []),
    ...(can(user.role, "users:view") ? [{ href: "/admin/users", label: "Users" }] : []),
    ...(can(user.role, "settings:edit") ? [{ href: "/admin/settings", label: "Settings" }] : []),
    ...(can(user.role, "audit:view") ? [{ href: "/admin/audit", label: "Activity" }] : []),
    { href: "/admin/account", label: "My account" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-olive/60 bg-ink/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Wordmark className="w-28" />
          <nav aria-label="Admin" className="flex flex-wrap gap-x-5 gap-y-2 font-heading tracking-wider uppercase">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-red-text">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span>
              {user.name} &middot; {ROLE_LABELS[user.role]}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
