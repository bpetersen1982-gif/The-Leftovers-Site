import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { PAGES, PAGE_SLUGS } from "@/lib/content/pages";
import { getPage } from "@/lib/content/service";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Pages" };

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

export default async function PagesListPage() {
  await requirePermission("content:edit");
  const pages = await Promise.all(PAGE_SLUGS.map((slug) => getPage(db(), slug)));

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Pages</h1>
      <ul className="divide-y divide-olive/50 border-y border-olive/50">
        {pages.map((page) => (
          <li key={page.slug} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-heading text-xl tracking-wider uppercase">{PAGES[page.slug].title}</p>
              <p className="text-sm text-cream/90">
                {PAGES[page.slug].description}{" "}
                {page.updatedAt ? `Last edited ${DATE_FORMAT.format(page.updatedAt)} CT.` : "Showing default text."}
              </p>
            </div>
            <div className="flex gap-3">
              <Link href={PAGES[page.slug].path} className="underline">
                View
              </Link>
              <Link href={`/admin/pages/${page.slug}`} className="btn-primary" aria-label={`Edit ${PAGES[page.slug].title}`}>
                Edit
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-cream/90">
        Band member bios are edited under{" "}
        <Link href="/admin/members" className="underline">
          Members
        </Link>
        .
      </p>
    </div>
  );
}
