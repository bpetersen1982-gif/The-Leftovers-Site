import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { JsonLd } from "@/components/json-ld";
import { PhotoImg } from "@/components/photo-img";
import { VideoPlayer } from "@/components/video-player";
import { formatLongDate, todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { fanPostsForShow } from "@/lib/fan/queries";
import { formatShowTime, getPublicShow, musicEventJsonLd } from "@/lib/shows/queries";
import { SHOW_STATUS_LABELS } from "@/lib/shows/service";
import { objectStorage } from "@/lib/storage";

type Params = Promise<{ slug: string }>;
const SLUG = /^[a-z0-9-]{1,80}$/;

const loadShow = cache(async (slug: string) => (SLUG.test(slug) ? getPublicShow(db(), objectStorage(), slug) : null));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const show = await loadShow((await params).slug);
  if (!show) return { title: "Show not found" };
  return {
    title: `${show.venueName}, ${formatLongDate(show.date)}: Shows`,
    description: `The Leftovers at ${show.venueName} in ${show.city}, ${show.state} on ${formatLongDate(show.date)}.`,
    alternates: { canonical: `/shows/${show.slug}` },
  };
}

export default async function ShowPage({ params }: { params: Params }) {
  const show = await loadShow((await params).slug);
  if (!show) notFound();
  const fanPosts = await fanPostsForShow(db(), objectStorage(), show.id);
  const time = formatShowTime(show);
  const isPast = show.date < todayInBandTimeZone();
  const address = [show.street, `${show.city}, ${show.state}`].filter(Boolean).join(", ");
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <Link href="/shows" className="font-heading tracking-wider uppercase underline">
        All shows
      </Link>
      <p className="mt-6 font-heading text-lg tracking-wider uppercase">{formatLongDate(show.date)}</p>
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">{show.venueName}</h1>
      <p className="mt-2">
        {address}
        {time ? ` · ${time}` : ""}
        {show.priceText ? ` · ${show.priceText}` : ""}
      </p>
      {show.status !== "SCHEDULED" && (
        <p className={`mt-3 font-heading text-xl font-bold tracking-wider uppercase ${show.status === "CANCELLED" ? "text-red-text" : ""}`}>{SHOW_STATUS_LABELS[show.status]}</p>
      )}
      {show.description && <p className="mt-4 max-w-2xl whitespace-pre-line">{show.description}</p>}
      {!isPast && show.status !== "CANCELLED" && (
        <div className="mt-6 flex flex-wrap gap-3">
          {show.ticketUrl && show.status === "SCHEDULED" && (
            <a href={show.ticketUrl} rel="noopener noreferrer" target="_blank" className="btn-primary">
              Get tickets<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <a href={`/shows/${show.slug}/calendar.ics`} className="border border-cream/70 px-4 py-3 font-heading tracking-wider uppercase hover:bg-cream hover:text-ink">
            Add to calendar
          </a>
        </div>
      )}

      {show.albums.length > 0 && (
        <section aria-labelledby="show-photos" className="mt-12">
          <h2 id="show-photos" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Photos
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {show.albums.map((album) => (
              <li key={album.slug}>
                <Link href={`/photos/albums/${album.slug}`} className="group block">
                  {album.cover && <PhotoImg image={album.cover.image} alt="" sizes="(min-width: 768px) 33vw, 50vw" className="aspect-[4/3] w-full bg-charcoal object-cover" />}
                  <span className="mt-2 block font-heading tracking-wide uppercase group-hover:underline">{album.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {show.videos.length > 0 && (
        <section aria-labelledby="show-videos" className="mt-12">
          <h2 id="show-videos" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Videos
          </h2>
          <ul className="mt-4 grid gap-6 md:grid-cols-2">
            {show.videos.map((video) => (
              <li key={video.id}>
                <VideoPlayer title={video.title} posterUrl={video.playback.posterUrl} iframeUrl={video.playback.iframeUrl} />
                <p className="mt-2 font-heading tracking-wide uppercase">{video.title}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {fanPosts.length > 0 && (
        <section aria-labelledby="show-fans" className="mt-12">
          <h2 id="show-fans" className="font-heading text-2xl font-bold tracking-wider uppercase">
            From the crowd
          </h2>
          <ul className="mt-4 space-y-4">
            {fanPosts.map((post) => (
              <li key={post.id} className="panel-paper px-5 py-4">
                {post.photo && <PhotoImg image={post.photo.image} alt={post.photo.altText} sizes="(min-width: 896px) 832px, 100vw" className="mb-3 max-h-96 w-full bg-charcoal object-contain" />}
                <p className="whitespace-pre-line">{post.message}</p>
                <p className="mt-2 text-sm font-semibold">{post.displayName}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <Link href="/fan-wall" className="underline">
              Were you there? Leave a note on the Fan Wall
            </Link>
          </p>
        </section>
      )}
      <JsonLd data={musicEventJsonLd(show)} />
    </main>
  );
}
