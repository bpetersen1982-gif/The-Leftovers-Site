import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { PageBody } from "@/components/site-chrome";
import { turnstileSiteKey } from "@/lib/turnstile";
import { SubscribeForm } from "./forms";

export const metadata: Metadata = {
  title: "Mailing list",
  description: "Get an email when The Leftovers have a show coming up.",
  alternates: { canonical: "/mailing-list" },
};

export default async function MailingListPage() {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <PageBody title="Mailing list">
      <p>Get an email when we have a show coming up. We don&apos;t send many, and we never share your address.</p>
      <div className="mt-6">
        <SubscribeForm siteKey={turnstileSiteKey()} nonce={nonce} />
      </div>
      <p className="mt-6 text-sm text-cream/90">
        We&apos;ll email you a link to confirm first. Every email has a link to leave the list. See our{" "}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </PageBody>
  );
}
