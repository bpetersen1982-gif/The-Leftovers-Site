import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { VideoPlayer } from "@/components/video-player";
import { db } from "@/lib/db";
import { getPublicVideo } from "@/lib/video/queries";

type Params = Promise<{ id: string }>;

const loadVideo = cache(async (rawId: string) => {
  const id = z.uuid().safeParse(rawId);
  return id.success ? getPublicVideo(db(), id.data) : null;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const video = await loadVideo((await params).id);
  if (!video) return { title: "Video not found" };
  return {
    title: `${video.title}: Videos`,
    description: video.description || `${video.title}, live from The Leftovers.`,
    alternates: { canonical: `/videos/${video.id}` },
    openGraph: { type: "video.other", images: [{ url: video.playback.posterUrl, alt: video.title }] },
  };
}

export default async function VideoPage({ params }: { params: Params }) {
  const video = await loadVideo((await params).id);
  if (!video) notFound();
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/videos" className="font-heading tracking-wider uppercase underline">
        All videos
      </Link>
      <h1 className="mt-4 mb-4 font-heading text-3xl font-bold tracking-wider uppercase">{video.title}</h1>
      <VideoPlayer title={video.title} posterUrl={video.playback.posterUrl} iframeUrl={video.playback.iframeUrl} priority />
      {video.description && <p className="mt-4 max-w-3xl whitespace-pre-line">{video.description}</p>}
    </main>
  );
}
