import type { Metadata } from "next";
import Link from "next/link";
import { VideoPlayer } from "@/components/video-player";
import { db } from "@/lib/db";
import { listPublicVideos } from "@/lib/video/queries";

export const metadata: Metadata = {
  title: "Videos",
  description: "Live clips of The Leftovers playing 90s and 2000s rock around Lincoln, Nebraska.",
  alternates: { canonical: "/videos" },
};

function parsePage(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const { videos, pageCount } = await listPublicVideos(db(), page);
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">Videos</h1>
      {videos.length === 0 ? (
        <p className="mt-6">{page > 1 ? "No videos on this page." : "Live clips are coming soon."}</p>
      ) : (
        <ul className="mt-8 grid gap-8 md:grid-cols-2">
          {videos.map((video, index) => (
            <li key={video.id}>
              <VideoPlayer title={video.title} posterUrl={video.playback.posterUrl} iframeUrl={video.playback.iframeUrl} priority={index < 2 && page === 1} />
              <h2 className="mt-3 font-heading text-xl font-bold tracking-wide uppercase">
                <Link href={`/videos/${video.id}`} className="hover:underline">
                  {video.title}
                </Link>
              </h2>
              {video.duration && <p className="text-sm text-cream/90">{video.duration}</p>}
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 && (
        <nav aria-label="Video pages" className="mt-8 flex items-center justify-between font-heading tracking-wider uppercase">
          {page > 1 ? (
            <Link href={page === 2 ? "/videos" : `/videos?page=${page - 1}`} className="underline">
              Newer videos
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={`/videos?page=${page + 1}`} className="underline">
              Older videos
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
