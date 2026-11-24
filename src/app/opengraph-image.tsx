import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Default link-preview card for every page that doesn't have its own (SEO-2). */
export const alt = "The Leftovers: 90s & 2000s rock cover band from Lincoln, Nebraska";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogCard({ eyebrow: "Live music · bars · weddings · festivals", title: "Real music. No bullshit.", subtitle: "Book us for your next show." });
}
