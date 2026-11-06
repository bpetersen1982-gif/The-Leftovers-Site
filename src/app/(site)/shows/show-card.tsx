import Link from "next/link";
import { formatLongDate } from "@/lib/dates";
import { formatShowTime, type ShowSummary } from "@/lib/shows/queries";
import { SHOW_STATUS_LABELS } from "@/lib/shows/service";

/** One show in a list: date, venue, time, status, ticket link. */
export function ShowCard({ show, headingLevel = 2 }: { show: ShowSummary; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const time = formatShowTime(show);
  return (
    <article className="flex flex-wrap items-baseline justify-between gap-3 border-b border-olive/50 py-4">
      <div>
        <p className="font-heading tracking-wider uppercase">{formatLongDate(show.date)}</p>
        <Heading className="text-xl font-bold">
          <Link href={`/shows/${show.slug}`} className="hover:underline">
            {show.venueName}
          </Link>
        </Heading>
        <p className="text-sm text-cream/90">
          {show.city}, {show.state}
          {time ? ` · ${time}` : ""}
          {show.priceText ? ` · ${show.priceText}` : ""}
        </p>
      </div>
      <div className="text-right">
        {show.status !== "SCHEDULED" ? (
          <span className={`font-heading font-bold tracking-wider uppercase ${show.status === "CANCELLED" ? "text-red-text" : ""}`}>{SHOW_STATUS_LABELS[show.status]}</span>
        ) : show.ticketUrl ? (
          <a href={show.ticketUrl} rel="noopener noreferrer" target="_blank" className="btn-primary">
            Tickets<span className="sr-only"> for {show.venueName} (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}
