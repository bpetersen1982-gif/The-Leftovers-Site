import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/site-chrome";
import { db } from "@/lib/db";
import { checkConfirmToken } from "@/lib/mailing/service";
import { TokenButton } from "../forms";

export const metadata: Metadata = { title: "Confirm your sign-up", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = String((await searchParams).token ?? "");
  const state = await checkConfirmToken(db(), token);
  return (
    <PageBody title="Confirm your sign-up">
      {state === "valid" ? (
        <div className="space-y-4">
          <p>Want emails from The Leftovers about upcoming shows?</p>
          <TokenButton token={token} kind="confirm" />
        </div>
      ) : (
        <p>
          That link has expired or was already used.{" "}
          <Link href="/mailing-list" className="underline">
            Sign up again
          </Link>{" "}
          if you&apos;re not on the list yet.
        </p>
      )}
    </PageBody>
  );
}
