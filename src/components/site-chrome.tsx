import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { getSiteSettings } from "@/lib/content/service";
import { SOCIAL_PLATFORMS } from "@/lib/content/settings";
import { db } from "@/lib/db";
import { Wordmark } from "./brand";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/members", label: "Members" },
  { href: "/contact", label: "Contact" },
] as const;

/** Public page frame: header nav, main content, footer with contact and social links. */
export async function SiteChrome({ children }: { children: ReactNode }) {
  const [settings, viewer] = await Promise.all([getSiteSettings(db()), getCurrentUser()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-cream focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <header className="border-b border-olive/60 bg-ink/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <Wordmark className="w-32" />
          <nav aria-label="Main">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 font-heading tracking-wider uppercase">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-red-text">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={`mailto:${settings.bookingEmail}`} className="text-red-text hover:underline">
                  Book us
                </a>
              </li>
              <li>
                {/* Signed-in band members go straight to admin; everyone else to login. */}
                <Link
                  href={viewer ? "/admin" : "/login"}
                  className="border border-cream/70 px-2 py-0.5 hover:bg-cream hover:text-ink"
                >
                  {viewer ? "Band admin" : "Band login"}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <div id="main" className="flex-1">
        {children}
      </div>

      <footer className="border-t border-olive/60 px-4 py-8 text-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-6">
          <div className="space-y-1">
            <p>
              Booking:{" "}
              <a href={`mailto:${settings.bookingEmail}`} className="underline">
                {settings.bookingEmail}
              </a>
            </p>
            <p>&copy; {new Date().getUTCFullYear()} The Leftovers &middot; Lincoln, Nebraska</p>
          </div>
          {settings.socialLinks.length > 0 && (
            <ul aria-label="Social media" className="flex flex-wrap gap-4">
              {settings.socialLinks.map((link) => (
                <li key={link.platform}>
                  <a href={link.url} rel="noopener noreferrer" target="_blank" className="underline">
                    {SOCIAL_PLATFORMS[link.platform].label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <ul className="flex gap-4">
            <li>
              <Link href="/privacy" className="underline">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/copyright" className="underline">
                Copyright
              </Link>
            </li>
            <li>
              <Link href="/login" className="underline">
                Band login
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

/** Standard content page body with a title. */
export function PageBody({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">{title}</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}
