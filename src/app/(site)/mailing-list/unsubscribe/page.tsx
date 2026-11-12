import type { Metadata } from "next";
import { PageBody } from "@/components/site-chrome";
import { db } from "@/lib/db";
import { checkUnsubscribeToken } from "@/lib/mailing/service";
import { TokenButton } from "../forms";

export const metadata: Metadata = { title: "Leave the mailing list", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = String((await searchParams).token ?? "");
  const state = await checkUnsubscribeToken(db(), token);
  return (
    <PageBody title="Leave the mailing list">
      {state === "valid" ? (
        <div className="space-y-4">
          <p>Sorry to see you go. This deletes your email address from our list.</p>
          <TokenButton token={token} kind="unsubscribe" />
        </div>
      ) : (
        <p>You&apos;re not on the list (or this link was already used). Nothing else to do.</p>
      )}
    </PageBody>
  );
}
