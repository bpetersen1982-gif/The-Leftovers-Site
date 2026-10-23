import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { formatCents } from "@/lib/booking/eligibility";
import { type FunnelRow, getFunnel } from "@/lib/booking/funnel";
import { formatLongDate, formatMonth } from "@/lib/dates";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Booking funnel" };

const STAMP = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

function RowList({ rows, empty, when }: { rows: readonly FunnelRow[]; empty: string; when: string }) {
  if (rows.length === 0) return <p className="mt-2 text-cream/90">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-olive/50 border-y border-olive/50">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
          <span>
            <Link href={`/admin/bookings/${row.id}`} className="font-semibold underline">
              {row.contactName}
            </Link>
            {row.organization ? `, ${row.organization}` : ""}
            <span className="block text-sm text-cream/90">
              {row.eventDate ? formatLongDate(row.eventDate) : "Flexible date"} · {row.eventTypeLabel}
              {row.totalCents !== null ? ` · quoted ${formatCents(row.totalCents)}` : ""}
            </span>
            {row.note && <span className="block text-sm">&ldquo;{row.note}&rdquo;</span>}
          </span>
          <span className="text-right text-sm">
            <a href={`tel:${row.phone.replace(/\D/g, "")}`} className="block underline">{row.phone}</a>
            <a href={`mailto:${row.email}`} className="block break-all underline">{row.email}</a>
            <span className="block text-cream/90">{when} {STAMP.format(row.at)} CT</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function FunnelPage() {
  await requirePermission("booking:manage");
  const funnel = await getFunnel(db());

  return (
    <div className="space-y-10">
      <div>
        <p>
          <Link href="/admin/bookings" className="underline">← All bookings</Link>
        </p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-wider uppercase">Booking funnel</h1>
        <p className="mt-2 text-cream/90">People who saw a price and passed, let a quote expire, or left the form after giving contact info. Worth a follow-up call, or a pricing rethink.</p>
      </div>

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Last 6 months</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Booking requests by month</caption>
            <thead className="font-heading tracking-wider uppercase">
              <tr className="border-b border-olive/60">
                {["Month", "Requests", "Quoted", "Accepted", "Declined", "Booked", "Left the form"].map((label) => (
                  <th key={label} scope="col" className="py-2 pr-4">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.months.map((row) => (
                <tr key={row.month} className="border-b border-olive/30">
                  <th scope="row" className="py-2 pr-4 font-normal">{formatMonth(row.month)}</th>
                  <td className="py-2 pr-4">{row.requests}</td>
                  <td className="py-2 pr-4">{row.quoted}</td>
                  <td className="py-2 pr-4">{row.accepted}</td>
                  <td className="py-2 pr-4">{row.declined}</td>
                  <td className="py-2 pr-4">{row.confirmed}</td>
                  <td className="py-2 pr-4">{row.abandoned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="declined-heading">
        <h2 id="declined-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Declined a quote ({funnel.declined.length})</h2>
        <RowList rows={funnel.declined} empty="Nobody has declined a quote." when="declined" />
      </section>
      <section aria-labelledby="expired-heading">
        <h2 id="expired-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Quote expired ({funnel.expired.length})</h2>
        <RowList rows={funnel.expired} empty="No expired quotes." when="expired" />
      </section>
      <section aria-labelledby="abandoned-heading">
        <h2 id="abandoned-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Left the form ({funnel.abandoned.length})</h2>
        <p className="mt-1 text-sm text-cream/90">They entered contact info but didn&apos;t send the request. Deleted automatically after 90 days.</p>
        <RowList rows={funnel.abandoned} empty="Nobody has left the form partway." when="started" />
      </section>
    </div>
  );
}
