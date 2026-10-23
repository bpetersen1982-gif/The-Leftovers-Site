import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { formatCents } from "@/lib/booking/eligibility";
import { formatTime } from "@/lib/booking/format";
import { getInboxDetail } from "@/lib/booking/inbox";
import { DECLINE_TEMPLATE } from "@/lib/booking/prospect-emails";
import { formatLongDate, todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { CancelPanel, ConfirmPanel, DeclinePanel, HoldPanel, NotePanel, QuotePanel, ReplyPanel } from "./panels";

export const metadata: Metadata = { title: "Booking request" };

const EVENT_LABELS: Record<string, string> = { NOTE: "Note", CONTACTED: "Contacted them", EMAIL: "Emailed them" };

const STAMP = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });
const LABELS = {
  setting: { INDOOR: "Indoor", OUTDOOR: "Outdoor", UNSURE: "Not sure" },
  sound: { YES: "Provided", NO: "Band brings sound", PARTIAL: "Partly provided", UNSURE: "Not sure" },
} as const;

const NOTICES: Record<string, string> = {
  declined: "Declined. The date is free again.",
  "declined-email-failed": "Declined, but the email couldn't be sent. Try the Reply box, or call them.",
  cancelled: "Booking cancelled and the date freed. Let them know with the Reply box.",
};

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const noticeText = notice ? NOTICES[notice] : undefined;
  const viewer = await requirePermission("booking:view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const request = await getInboxDetail(db(), viewer, id);
  if (!request) notFound();

  const today = todayInBandTimeZone();
  const isAdmin = can(viewer.role, "booking:manage");
  const canReply = can(viewer.role, "booking:reply") && request.status !== "IN_PROGRESS";
  const ids = { requestId: request.id, version: request.version };
  const confirmable = ["ACCEPTED", "AWAITING_CONTACT", "CONTACTED", "QUOTED", "CONFIRMED"].includes(request.status);
  const quotable = ["AWAITING_CONTACT", "CONTACTED", "QUOTED", "DECLINED_BY_PROSPECT"].includes(request.status);
  const holdable = ["AWAITING_CONTACT", "CONTACTED", "QUOTED"].includes(request.status) && request.eventDate !== null;
  const declinable = ["AWAITING_CONTACT", "CONTACTED", "QUOTED", "ACCEPTED"].includes(request.status);

  const rows: [string, string][] = [
    ["Date", request.eventDate ? formatLongDate(request.eventDate) : "Flexible"],
    ["Time", request.startTime && request.endTime ? `${formatTime(request.startTime)}–${formatTime(request.endTime)}` : "—"],
    ["Event", `${request.eventTypeLabel}${request.sets ? `, ${request.sets} sets` : ""}`],
    ["Venue", [request.organization, request.street, request.place, request.zip].filter(Boolean).join(", ") || "—"],
    ["Distance", request.distanceMiles !== null ? `~${Math.round(request.distanceMiles)} miles from the travel origin` : "Unknown ZIP"],
    ["Attendance", request.attendance?.toString() ?? "—"],
    ["Setting", request.setting ? LABELS.setting[request.setting as keyof typeof LABELS.setting] : "—"],
    ["Sound", request.soundProvided ? LABELS.sound[request.soundProvided as keyof typeof LABELS.sound] : "—"],
  ];

  return (
    <div className="space-y-8">
      <p>
        <Link href="/admin/bookings" className="underline">← All bookings</Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">
          {request.eventDate ? formatLongDate(request.eventDate) : "Flexible date"}
        </h1>
        <p className="font-heading text-xl tracking-wider uppercase">
          {request.quoteExpired ? "Quote expired" : request.statusLabel}
          {request.claim && <span className="ml-2 text-base">({request.claim.kind === "BOOKED" ? "date booked" : "date pending"})</span>}
        </p>
      </div>
      {noticeText && (
        <p role="status" className="border-l-4 border-olive bg-olive/15 px-3 py-2 font-semibold">
          {noticeText}
        </p>
      )}
      {request.isConflict && (
        <p role="note" className="border-l-4 border-red-ui bg-red-ui/15 px-3 py-2 font-semibold">
          Conflict: another request, hold, or booking exists for this date.
        </p>
      )}

      <section aria-labelledby="contact-heading" className="panel-paper px-5 py-5">
        <h2 id="contact-heading" className="font-heading text-xl font-bold uppercase">{request.contactName}</h2>
        <p className="mt-2 flex flex-wrap gap-4">
          <a href={`tel:${request.phone.replace(/\D/g, "")}`} className="btn-primary">Call {request.phone}</a>
          <a href={`mailto:${request.email}?subject=${encodeURIComponent(`The Leftovers: your request ${request.reference}`)}`} className="font-semibold break-all underline">
            {request.email}
          </a>
        </p>
        <p className="mt-2 text-sm">Reference {request.reference} · received {STAMP.format(request.createdAt)}</p>
      </section>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-heading tracking-wide uppercase">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {request.message && (
        <section aria-labelledby="message-heading">
          <h2 id="message-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Their message</h2>
          <p className="mt-2 whitespace-pre-line">{request.message}</p>
        </section>
      )}
      {request.responseNote && (
        <section aria-labelledby="note-heading">
          <h2 id="note-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Their note on the quote</h2>
          <p className="mt-2">&ldquo;{request.responseNote}&rdquo;</p>
        </section>
      )}

      {request.quote && (
        <section aria-labelledby="quote-heading">
          <h2 id="quote-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Quote</h2>
          <p className="mt-2">
            {request.quote.sets} × {formatCents(request.quote.ratePerSetCents)} = <strong>{formatCents(request.quote.totalCents)}</strong>
            {" · "}valid until {STAMP.format(request.quote.expiresAt)} CT
          </p>
        </section>
      )}
      {request.ineligibleReasons.length > 0 && (
        <section aria-labelledby="why-heading">
          <h2 id="why-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Why no instant quote</h2>
          <ul className="mt-2 list-disc pl-6">
            {request.ineligibleReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="mt-1 text-sm text-cream/90">Internal only; the prospect wasn&apos;t told.</p>
        </section>
      )}

      {request.sameDate.length > 0 && (
        <section aria-labelledby="same-date-heading">
          <h2 id="same-date-heading" className="font-heading text-xl font-bold tracking-wider uppercase">Other requests for this date</h2>
          <ul className="mt-2 divide-y divide-olive/50 border-y border-olive/50">
            {request.sameDate.map((other) => (
              <li key={other.id} className="py-2">
                <Link href={`/admin/bookings/${other.id}`} className="underline">{other.contactName}</Link> · {other.eventTypeLabel} · {other.statusLabel} · {other.reference}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="font-heading text-xl font-bold tracking-wider uppercase">History</h2>
        <ol className="mt-2 space-y-2">
          {request.timeline.map((event) => (
            <li key={event.id} className="text-sm">
              <span className="text-cream/90">{STAMP.format(event.createdAt)} · {event.authorName}: </span>
              {event.toStatus ? `${event.fromStatus ? `${event.fromStatus} → ` : ""}${event.toStatus}` : (EVENT_LABELS[event.kind] ?? event.kind)}
              {event.body && <span className="block pl-4 whitespace-pre-line">&ldquo;{event.body}&rdquo;</span>}
            </li>
          ))}
        </ol>
      </section>
      <div className="space-y-6">
        {isAdmin && confirmable && (
          <ConfirmPanel
            ids={ids}
            isEdit={request.status === "CONFIRMED"}
            today={today}
            defaults={{
              eventDate: request.eventDate ?? today,
              startTime: request.startTime,
              endTime: request.endTime,
              loadInTime: request.loadInTime,
              sets: request.sets,
              agreedPrice: request.agreedPriceCents ?? request.quote?.totalCents ?? null,
            }}
          />
        )}
        {isAdmin && quotable && <QuotePanel ids={ids} today={today} defaults={{ eventDate: request.eventDate ?? today, sets: request.sets }} />}
        {isAdmin && holdable && <HoldPanel ids={ids} heldUntil={request.claim?.kind === "PENDING" ? request.claim.expiresAt : null} />}
        {canReply && <ReplyPanel requestId={request.id} reference={request.reference} />}
        <NotePanel requestId={request.id} />
        {isAdmin && declinable && (
          <DeclinePanel ids={ids} template={DECLINE_TEMPLATE(request.eventDate ? formatLongDate(request.eventDate) : "your event")} />
        )}
        {isAdmin && request.status === "CONFIRMED" && <CancelPanel ids={ids} />}
        {!isAdmin && <p className="text-sm text-cream/90">Only Admins can quote, confirm, or decline. Add a note or log your call so they know.</p>}
      </div>
    </div>
  );
}
