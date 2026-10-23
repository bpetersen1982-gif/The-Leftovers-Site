import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { formatCents } from "@/lib/booking/eligibility";
import { INBOX_FILTERS, type InboxFilter, isInboxFilter, listInbox } from "@/lib/booking/inbox";
import { formatLongDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Bookings" };

const RECEIVED = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

export default async function BookingsInboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const viewer = await requirePermission("booking:view");
  const { filter: raw } = await searchParams;
  const filter: InboxFilter = raw && isInboxFilter(raw) ? raw : "active";
  const rows = await listInbox(db(), viewer, filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Bookings</h1>
        {can(viewer.role, "booking:manage") && (
          <Link href="/admin/bookings/funnel" className="underline">
            Funnel: declined, expired, unfinished
          </Link>
        )}
      </div>
      <nav aria-label="Booking filters">
        <ul className="flex flex-wrap gap-2 font-heading tracking-wider uppercase">
          {(Object.keys(INBOX_FILTERS) as InboxFilter[]).map((key) => (
            <li key={key}>
              <Link
                href={`/admin/bookings?filter=${key}`}
                aria-current={key === filter ? "page" : undefined}
                className={`inline-block border px-3 py-1 ${key === filter ? "border-cream bg-cream text-ink" : "border-cream/60 hover:bg-cream hover:text-ink"}`}
              >
                {INBOX_FILTERS[key].label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {rows.length === 0 ? (
        <p className="text-cream/90">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-olive/50 border-y border-olive/50">
          {rows.map((row) => (
            <li key={row.id} className="py-3">
              <Link href={`/admin/bookings/${row.id}`} className="group flex flex-wrap items-baseline justify-between gap-3">
                <span>
                  <span className="font-semibold group-hover:underline">
                    {row.eventDate ? formatLongDate(row.eventDate) : "Flexible date"}
                  </span>
                  {row.isConflict && <span className="ml-2 bg-red-ui px-2 py-0.5 text-xs font-bold tracking-wider text-cream uppercase">Conflict</span>}
                  <span className="block text-sm text-cream/90">
                    {row.eventTypeLabel}
                    {row.sets ? ` · ${row.sets} sets` : ""} · {row.contactName}
                    {row.organization ? `, ${row.organization}` : ""}
                    {row.place ? ` · ${row.place}` : ""}
                  </span>
                </span>
                <span className="text-right text-sm">
                  <span className="block font-heading tracking-wider uppercase">
                    {row.quoteExpired ? "Quote expired" : row.statusLabel}
                  </span>
                  {row.totalCents !== null && <span className="block">{formatCents(row.totalCents)}</span>}
                  <span className="block text-cream/90">{row.reference} · {RECEIVED.format(row.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
