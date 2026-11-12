import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listSubscribers, PENDING_RETENTION_DAYS } from "@/lib/mailing/service";
import { DARK_INPUT_CLASS, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { RemoveSubscriberButton } from "./remove-button";

export const metadata: Metadata = { title: "Mailing list" };

const JOINED = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

export default async function AdminMailingListPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const actor = await requirePermission("mailing:manage");
  const { q = "", page: rawPage } = await searchParams;
  const list = await listSubscribers(db(), actor, { search: q, page: Number(rawPage) || 1 });
  const pageLink = (page: number) => `/admin/mailing-list?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) }).toString()}`;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Mailing list</h1>
        <Link href="/mailing-list" className="underline">
          View sign-up page
        </Link>
      </div>
      <p className="text-cream/90">
        {list.confirmed} confirmed {list.confirmed === 1 ? "subscriber" : "subscribers"}. {list.pending} more signed up but haven&apos;t confirmed yet (those are deleted after{" "}
        {PENDING_RETENTION_DAYS} days). Only confirmed addresses are exported. The site doesn&apos;t send newsletters itself: export the list to Mailchimp or similar,
        and use that service&apos;s unsubscribe link.
      </p>
      <p>
        <a href="/admin/mailing-list/export" className="btn-primary">
          Download CSV
        </a>
      </p>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="min-w-64">
          <label htmlFor="q" className={LABEL_CLASS}>
            Find an email
          </label>
          <input id="q" name="q" type="search" defaultValue={q} maxLength={100} className={DARK_INPUT_CLASS} />
        </div>
        <button type="submit" className={SECONDARY_BUTTON}>
          Search
        </button>
      </form>
      {list.rows.length === 0 ? (
        <p className="text-cream/90">{q ? "No match." : "Nobody yet."}</p>
      ) : (
        <ul className="divide-y divide-olive/50 border-y border-olive/50">
          {list.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
              <span>
                {row.email} <span className="text-sm text-cream/80">· joined {row.confirmedAt ? JOINED.format(row.confirmedAt) : ""}</span>
              </span>
              <RemoveSubscriberButton id={row.id} email={row.email} />
            </li>
          ))}
        </ul>
      )}
      {list.pageCount > 1 && (
        <nav aria-label="Subscriber pages" className="flex items-center justify-between">
          {list.page > 1 ? <Link href={pageLink(list.page - 1)} className="underline">Previous</Link> : <span />}
          <span className="text-sm">
            Page {list.page} of {list.pageCount}
          </span>
          {list.page < list.pageCount ? <Link href={pageLink(list.page + 1)} className="underline">Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
