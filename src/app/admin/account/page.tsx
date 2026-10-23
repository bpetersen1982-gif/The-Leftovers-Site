import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PasskeyManager } from "./passkey-manager";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requirePermission("account:managePasskeys");
  const { welcome } = await searchParams;

  return (
    <div className="space-y-8">
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">My account</h1>
      {welcome === "1" && (
        <p role="status" className="panel-paper px-5 py-4">
          You&apos;re in, {user.name}. Add a passkey below so next time you can log in with Face ID or a fingerprint instead
          of waiting for an email.
        </p>
      )}
      <dl className="grid gap-1">
        <dt className="font-heading tracking-wider uppercase">Email</dt>
        <dd>{user.email}</dd>
      </dl>
      <PasskeyManager />
    </div>
  );
}
