import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { formatLongDate, todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatShowTime, listBandShows, type ShowSummary } from "@/lib/shows/queries";
import { SHOW_STATUS_LABELS } from "@/lib/shows/service";
import { CreateShowForm } from "./show-forms";

export const metadata: Metadata = { title: "Shows" };

const NOTICES: Record<string, string> = { deleted: "Show deleted. Linked albums and videos are still on the site." };

function ShowList({ shows, canEdit }: { shows: readonly ShowSummary[]; canEdit: boolean }) {
  return (
    <ul className="divide-y divide-olive/50 border-y border-olive/50">
      {shows.map((show) => {
        const body = (
          <span className="flex flex-wrap items-baseline justify-between gap-3">
            <span>
              <span className="font-semibold">{formatLongDate(show.date)}</span> · {show.venueName}, {show.city}
              {formatShowTime(show) ? ` · ${formatShowTime(show)}` : ""}
            </span>
            <span className="font-heading text-sm tracking-wider uppercase">
              {show.isPublic ? "Public" : "Private"}
              {show.status !== "SCHEDULED" ? ` · ${SHOW_STATUS_LABELS[show.status]}` : ""}
            </span>
          </span>
        );
        return (
          <li key={show.id} className="py-3">
            {canEdit ? (
              <Link href={`/admin/shows/${show.id}`} className="block hover:underline">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default async function AdminShowsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const viewer = await requirePermission("shows:view");
  const canEdit = can(viewer.role, "shows:manage");
  const { notice } = await searchParams;
  const { upcoming, past } = await listBandShows(db(), todayInBandTimeZone());
  const noticeText = notice ? NOTICES[notice] : undefined;
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Shows</h1>
        <Link href="/shows" className="underline">
          View public page
        </Link>
      </div>
      {noticeText && (
        <p role="status" className="font-semibold">
          {noticeText}
        </p>
      )}
      <section aria-labelledby="upcoming-shows" className="space-y-3">
        <h2 id="upcoming-shows" className="font-heading text-xl font-bold tracking-wider uppercase">
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? <p className="text-cream/90">Nothing on the calendar.</p> : <ShowList shows={upcoming} canEdit={canEdit} />}
      </section>
      {canEdit && (
        <section aria-labelledby="new-show" className="space-y-4 border border-olive/60 p-4">
          <h2 id="new-show" className="font-heading text-xl font-bold tracking-wider uppercase">
            Add a show
          </h2>
          <p className="text-sm text-cream/90">Confirmed bookings can also become shows with one click from the booking.</p>
          <CreateShowForm />
        </section>
      )}
      {past.length > 0 && (
        <section aria-labelledby="past-shows" className="space-y-3">
          <h2 id="past-shows" className="font-heading text-xl font-bold tracking-wider uppercase">
            Past
          </h2>
          <ShowList shows={past} canEdit={canEdit} />
        </section>
      )}
    </div>
  );
}
