import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/brand";

export default async function NotFound() {
  // Per-request render so the CSP nonce is applied to framework scripts.
  await connection();
  return (
    <AuthCard title="Page not found">
      <p>That page doesn&apos;t exist.</p>
      <p>
        <Link href="/" className="underline">
          Back to The Leftovers
        </Link>
      </p>
    </AuthCard>
  );
}
