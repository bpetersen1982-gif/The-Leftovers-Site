import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { listUpcomingBlocks } from "@/lib/availability/service";
import { formatDateRange, todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { AddAvailabilityForm, DeleteAvailabilityButton } from "./availability-forms";

export const metadata: Metadata = { title: "Availability" };

export default async function AvailabilityPage() {
  const viewer = await requirePermission("availability:view");
  const isAdmin = can(viewer.role, "availability:manageAll");
  const today = todayInBandTimeZone();
  const [entries, users] = await Promise.all([
    listUpcomingBlocks(db(), viewer, today),
    isAdmin
      ? db().user.findMany({ where: { deactivatedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Availability</h1>
        <Link href="/book" className="underline">
          View public calendar
        </Link>
      </div>
      <p className="text-cream/90">
        When someone is out, the public calendar shows that date as <strong>Limited availability</strong>, so the band can
        decide whether to use a fill-in. Band-wide days off show as <strong>Unavailable</strong>. The public never sees who is
        out or why.
      </p>

      <section aria-labelledby="add-heading" className="panel-paper px-5 py-5">
        <h2 id="add-heading" className="font-heading text-xl font-bold uppercase">
          {isAdmin ? "Add dates" : "Add your out-of-office dates"}
        </h2>
        <AddAvailabilityForm today={today} isAdmin={isAdmin} viewerId={viewer.id} users={users} />
      </section>

      <section aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Upcoming ({entries.length})
        </h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-cream/90">Nobody is out. Every date is open.</p>
        ) : (
          <ul className="mt-3 divide-y divide-olive/50 border-y border-olive/50">
            {entries.map((entry) => {
              const who = entry.scope === "BAND" ? "Whole band" : (entry.userName ?? "Former member");
              return (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">
                      {who}
                      <span className="ml-2 font-normal text-cream/90">
                        {entry.scope === "BAND" ? "(Unavailable)" : "(Limited)"}
                      </span>
                    </p>
                    <p>{formatDateRange(entry.startDate, entry.endDate)}</p>
                    {entry.note && <p className="text-sm text-cream/90">Note: {entry.note}</p>}
                  </div>
                  {entry.canDelete && <DeleteAvailabilityButton id={entry.id} label={`${who}, ${formatDateRange(entry.startDate, entry.endDate)}`} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
