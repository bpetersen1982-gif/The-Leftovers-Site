import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getModerationBoard } from "@/lib/fan/queries";
import { can } from "@/lib/permissions";
import { objectStorage } from "@/lib/storage";
import { DecidedCard, FanQueue } from "./fan-cards";

export const metadata: Metadata = { title: "Fan Wall" };

export default async function AdminFanWallPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const viewer = await requirePermission("fan:moderate");
  const isAdmin = can(viewer.role, "fan:override");
  const { show } = await searchParams;
  const board = await getModerationBoard(db(), objectStorage(), viewer);
  // Admins can narrow "recent decisions" to the ones band members made (APR-4).
  const onlyMembers = isAdmin && show === "members";
  const recent = onlyMembers ? board.recent.filter((post) => post.decidedByRole === "MEMBER") : board.recent;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Fan Wall</h1>
        <Link href="/fan-wall" className="underline">
          View public page
        </Link>
      </div>
      <p className="text-cream/90">
        Nothing fans send is public until someone here approves it. Band members&apos; calls take effect right away and another member can
        change them; once an Admin decides, only an Admin can change it.
      </p>

      <section id="pending" aria-labelledby="pending-heading" className="space-y-4">
        <h2 id="pending-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Waiting for review ({board.pendingCount})
        </h2>
        {board.pendingCount > board.pending.length && <p className="text-sm text-cream/90">Showing the oldest {board.pending.length}.</p>}
        <FanQueue posts={board.pending} />
      </section>

      <section aria-labelledby="recent-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
            {onlyMembers ? "Recent band member decisions" : "Recent decisions"} ({recent.length})
          </h2>
          {isAdmin && (
            <Link href={onlyMembers ? "/admin/fan-wall" : "/admin/fan-wall?show=members"} className="underline">
              {onlyMembers ? "Show everyone's decisions" : `Only band members' decisions (${board.memberDecisionCount})`}
            </Link>
          )}
        </div>
        <p className="text-sm text-cream/90">The last 30 days.</p>
        {recent.length === 0 ? (
          <p className="text-cream/90">Nothing decided recently.</p>
        ) : (
          <ul className="space-y-4">
            {recent.map((post) => (
              <li key={`${post.id}:${post.version}`}>
                <DecidedCard post={post} canDelete={can(viewer.role, "fan:delete")} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
