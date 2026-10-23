import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/site-chrome";
import { EVENT_TYPE_LABELS, formatCents } from "@/lib/booking/eligibility";
import { formatTime } from "@/lib/booking/format";
import { getRequestForProspect } from "@/lib/booking/requests";
import { getSiteSettings } from "@/lib/content/service";
import { formatLongDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { RespondForm } from "./respond-form";

export const metadata: Metadata = {
  title: "Your booking request",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const EXPIRY = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Chicago" });

const STATUS_COPY = {
  AWAITING_CONTACT: "Thanks! Someone from The Leftovers will contact you to discuss your event.",
  ACCEPTED: "You accepted the quote. Your date is now pending: the band will confirm times and details with you soon.",
  DECLINED_BY_PROSPECT: "You declined this quote. Thanks for considering us. If anything changes, request again anytime.",
  EXPIRED: "This quote has expired. Contact the band and we'll send a fresh one.",
  CONFIRMED: "Your date is confirmed. See you there!",
  CLOSED: "This request is closed. Contact the band if you have questions.",
} as const;

/** The prospect's private page (requirements BOOK-8). The token in the URL is the only key. */
export default async function BookingRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [request, settings] = await Promise.all([getRequestForProspect(db(), token), getSiteSettings(db())]);

  if (!request) {
    return (
      <PageBody title="Request not found">
        <p>That link isn&apos;t valid. Check the link in your email, or contact us at{" "}
          <a href={`mailto:${settings.bookingEmail}`} className="underline">{settings.bookingEmail}</a>.
        </p>
      </PageBody>
    );
  }

  return (
    <PageBody title="Your booking request">
      <p>
        Reference <strong>{request.reference}</strong>
      </p>
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="font-heading tracking-wide uppercase">Date</dt>
        <dd>{request.eventDate ? formatLongDate(request.eventDate) : "Flexible"}</dd>
        {request.startTime && request.endTime && (
          <>
            <dt className="font-heading tracking-wide uppercase">Time</dt>
            <dd>
              {formatTime(request.startTime)}–{formatTime(request.endTime)}
              {request.sets ? `, ${request.sets} set${request.sets === 1 ? "" : "s"}` : ""}
            </dd>
          </>
        )}
        {request.eventType && (
          <>
            <dt className="font-heading tracking-wide uppercase">Event</dt>
            <dd>{EVENT_TYPE_LABELS[request.eventType]}</dd>
          </>
        )}
      </dl>

      {request.status === "QUOTED" && request.quote ? (
        <section aria-labelledby="quote-heading" className="panel-paper mt-8 px-5 py-6">
          <h2 id="quote-heading" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Your quote
          </h2>
          <p className="mt-3 text-3xl font-bold">{formatCents(request.quote.totalCents)}</p>
          <p className="mt-1">
            {request.quote.sets} set{request.quote.sets === 1 ? "" : "s"} × {formatCents(request.quote.ratePerSetCents)} per set. Travel included.
          </p>
          <p className="mt-3 text-sm">
            This is an estimate. Your date is confirmed only after the band confirms times and details. This quote is good until{" "}
            <strong>{EXPIRY.format(request.quote.expiresAt)} Central</strong>.
          </p>
          <RespondForm token={token} />
        </section>
      ) : (
        <p role="status" className="panel-paper mt-8 px-5 py-5">
          {request.dateTaken
            ? "Sorry: this date was just taken by another booking. The band has your request and will contact you about options."
            : request.status === "QUOTED"
              ? STATUS_COPY.AWAITING_CONTACT
              : STATUS_COPY[request.status]}
          {request.responseNote && (
            <span className="mt-2 block text-sm">Your note: &ldquo;{request.responseNote}&rdquo;</span>
          )}
        </p>
      )}

      <p className="mt-8 text-sm">
        Questions? Email{" "}
        <a href={`mailto:${settings.bookingEmail}`} className="underline">{settings.bookingEmail}</a> and include your reference.{" "}
        <Link href="/book" className="underline">Back to the calendar</Link>
      </p>
    </PageBody>
  );
}
