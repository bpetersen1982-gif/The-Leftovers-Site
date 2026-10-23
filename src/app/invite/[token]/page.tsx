import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthCard, Notice } from "@/components/brand";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { lookupInvite } from "@/lib/users/queries";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = {
  title: "Accept your invite",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const UNAVAILABLE: Record<"invalid" | "expired" | "used" | "revoked", string> = {
  invalid: "That invite link isn't valid. Ask an Admin to send a new one.",
  expired: "That invite has expired. Ask an Admin to send a new one.",
  used: "That invite was already used. Log in instead.",
  revoked: "That invite was cancelled. Ask an Admin to send a new one.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const invite = await lookupInvite(db(), token);

  if (invite.status !== "pending") {
    return (
      <AuthCard title="Invite unavailable">
        <Notice tone="error">{UNAVAILABLE[invite.status]}</Notice>
        <p>
          <Link href="/login" className="underline">
            Go to band login
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Welcome, ${invite.name}`}>
      <p>
        You&apos;ve been invited to The Leftovers band site as <strong>{ROLE_LABELS[invite.role]}</strong>. Accepting
        creates your account and logs you in. No password needed.
      </p>
      <AcceptInviteForm token={token} />
    </AuthCard>
  );
}
