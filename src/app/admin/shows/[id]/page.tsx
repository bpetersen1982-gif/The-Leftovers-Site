import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getBandShow } from "@/lib/shows/queries";
import { DeleteShowForm, EditShowForm } from "../show-forms";

export const metadata: Metadata = { title: "Show" };

const NOTICES: Record<string, string> = {
  created: "Show added.",
  fromBooking: "Show created from the booking. Check the details, then save.",
};

export default async function AdminShowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  await requirePermission("shows:manage");
  const [{ id: rawId }, { notice }] = await Promise.all([params, searchParams]);
  const id = z.uuid().safeParse(rawId);
  if (!id.success) notFound();
  const show = await getBandShow(db(), id.data);
  if (!show) notFound();
  const noticeText = notice ? NOTICES[notice] : undefined;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">{show.venueName}</h1>
        <span className="flex gap-4">
          {show.isPublic && (
            <Link href={`/shows/${show.slug}`} className="underline">
              View public page
            </Link>
          )}
          {show.bookingRequestId && (
            <Link href={`/admin/bookings/${show.bookingRequestId}`} className="underline">
              Booking
            </Link>
          )}
          <Link href="/admin/shows" className="underline">
            All shows
          </Link>
        </span>
      </div>
      {noticeText && (
        <p role="status" className="font-semibold">
          {noticeText}
        </p>
      )}
      <EditShowForm show={show} />
      <section aria-labelledby="delete-show" className="space-y-2 border-t border-olive/60 pt-6">
        <h2 id="delete-show" className="font-heading text-xl font-bold tracking-wider uppercase">
          Delete show
        </h2>
        <DeleteShowForm show={show} />
      </section>
    </div>
  );
}
