import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard, Notice } from "@/components/brand";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Band login", robots: { index: false, follow: false } };

/** Better Auth redirects back here with ?error=... when a magic link is expired or used. */
const LINK_ERRORS: Record<string, string> = {
  EXPIRED_TOKEN: "That login link expired. Request a new one below.",
  INVALID_TOKEN: "That login link isn't valid or was already used. Request a new one below.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await connection();
  if (await getCurrentUser()) redirect("/admin");

  const { error } = await searchParams;
  const linkError = error ? (LINK_ERRORS[error] ?? "That login link didn't work. Request a new one below.") : null;

  return (
    <AuthCard title="Band login">
      <p>For band Admins and Members only. Enter the email your invite was sent to and we&apos;ll email you a login link.</p>
      {linkError && <Notice tone="error">{linkError}</Notice>}
      <LoginForm />
    </AuthCard>
  );
}
