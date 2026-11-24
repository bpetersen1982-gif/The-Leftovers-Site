import { db } from "@/lib/db";
import { formatLongDate } from "@/lib/dates";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { formatShowTime, getPublicShow } from "@/lib/shows/queries";
import { SHOW_STATUS_LABELS } from "@/lib/shows/service";

/** Link-preview card for a show: date, venue, time, and sold out / cancelled (SEO-2). */
export const alt = "The Leftovers show details";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const show = /^[a-z0-9-]{1,80}$/.test(slug) ? await getPublicShow(db(), null, slug) : null;
  if (!show) return ogCard({ title: "Shows", subtitle: "See where we're playing next." });
  const time = formatShowTime(show);
  return ogCard({
    eyebrow: formatLongDate(show.date),
    title: show.venueName,
    subtitle: [`${show.city}, ${show.state}`, time, show.priceText].filter(Boolean).join(" · "),
    badge: show.status === "SCHEDULED" ? undefined : SHOW_STATUS_LABELS[show.status],
  });
}
