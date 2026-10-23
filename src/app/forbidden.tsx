import Link from "next/link";
import { AuthCard } from "@/components/brand";

export default function Forbidden() {
  return (
    <AuthCard title="Not allowed">
      <p>Your account doesn&apos;t have access to that page. If you think it should, ask an Admin.</p>
      <p>
        <Link href="/admin" className="underline">
          Back to band admin
        </Link>
      </p>
    </AuthCard>
  );
}
