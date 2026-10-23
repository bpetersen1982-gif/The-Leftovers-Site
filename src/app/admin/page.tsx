import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";

export default async function AdminHomePage() {
  const user = await requirePermission("admin:access");
  const passkeyCount = await db().passkey.count({ where: { userId: user.id } });
  const isAdmin = can(user.role, "users:view");

  return (
    <div className="space-y-8">
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Hey, {user.name}</h1>

      {passkeyCount === 0 && (
        <section aria-labelledby="passkey-tip" className="panel-paper px-5 py-4">
          <h2 id="passkey-tip" className="font-heading text-xl font-bold uppercase">
            Faster login
          </h2>
          <p className="mt-2">
            Add a passkey (Face ID, fingerprint, or your phone&apos;s screen lock) so you can log in without waiting for an
            email.
          </p>
          <Link href="/admin/account" className="btn-primary mt-3">
            Add a passkey
          </Link>
        </section>
      )}

      <section aria-labelledby="whats-here">
        <h2 id="whats-here" className="font-heading text-xl font-bold tracking-wider uppercase">
          What&apos;s here so far
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          {isAdmin && (
            <li>
              <Link href="/admin/users" className="underline">
                Users
              </Link>
              : invite band members, change roles, remove people.
            </li>
          )}
          <li>
            <Link href="/admin/account" className="underline">
              My account
            </Link>
            : manage your passkeys.
          </li>
        </ul>
        <p className="mt-4 text-cream/90">Booking requests, photos, and the fan wall arrive in the next waves.</p>
      </section>
    </div>
  );
}
