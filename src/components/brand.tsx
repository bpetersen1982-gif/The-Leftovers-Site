import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** Header wordmark linking home. */
export function Wordmark({ className = "w-36" }: { className?: string }) {
  return (
    <Link href="/" aria-label="The Leftovers home" className="inline-block">
      <Image src="/brand/logo-wordmark.png" alt="The Leftovers" width={315} height={166} className={`h-auto ${className}`} />
    </Link>
  );
}

/** Centered card used by login, invite, and error screens. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Wordmark className="w-48" />
      <section aria-labelledby="card-title" className="panel-paper mt-8 w-full max-w-md px-6 py-8 shadow-2xl">
        <h1 id="card-title" className="font-heading text-2xl font-bold tracking-wider uppercase">
          {title}
        </h1>
        <div className="mt-4 space-y-4 leading-relaxed">{children}</div>
      </section>
    </main>
  );
}

/** Inline status message. role=alert for errors so screen readers announce it. */
export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-ui bg-red-ui/10",
    success: "border-olive bg-olive/15",
    info: "border-charcoal/40 bg-charcoal/5",
  } as const;
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`border-l-4 px-3 py-2 ${styles[tone]}`}>
      {children}
    </p>
  );
}
