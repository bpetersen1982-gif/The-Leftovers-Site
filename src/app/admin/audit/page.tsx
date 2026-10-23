import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { listAuditLog } from "@/lib/audit-queries";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Activity log" };

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "America/Chicago" });

const cursorSchema = z.object({ before: z.iso.datetime(), id: z.uuid() });

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string; id?: string }> }) {
  await requirePermission("audit:view");
  const parsed = cursorSchema.safeParse(await searchParams);
  const cursor = parsed.success ? { createdAt: new Date(parsed.data.before), id: parsed.data.id } : undefined;
  const { rows, next } = await listAuditLog(db(), cursor);

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Activity log</h1>
      <p className="text-cream/90">Every invite, role change, removal, and content edit, newest first. Times are Central.</p>
      {rows.length === 0 ? (
        <p>No activity yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Activity log entries</caption>
            <thead className="font-heading tracking-wider uppercase">
              <tr className="border-b border-olive/60">
                <th scope="col" className="py-2 pr-4">When</th>
                <th scope="col" className="py-2 pr-4">Who</th>
                <th scope="col" className="py-2 pr-4">What</th>
                <th scope="col" className="py-2">Item</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-olive/30 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap">{DATE_FORMAT.format(row.createdAt)}</td>
                  <td className="py-2 pr-4">
                    {row.actorName}
                    {row.actorRole && <span className="text-cream/90"> ({ROLE_LABELS[row.actorRole]})</span>}
                  </td>
                  <td className="py-2 pr-4">{row.actionLabel}</td>
                  <td className="py-2 font-mono text-xs break-all">
                    {row.targetType}
                    {row.targetId && `: ${row.targetId}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-4">
        {cursor && (
          <Link href="/admin/audit" className="underline">
            Newest
          </Link>
        )}
        {next && (
          <Link href={`/admin/audit?before=${encodeURIComponent(next.createdAt.toISOString())}&id=${next.id}`} className="underline">
            Older entries →
          </Link>
        )}
      </div>
    </div>
  );
}
