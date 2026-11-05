import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PhotoImg } from "@/components/photo-img";
import { formatLongDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { getPublicAlbum } from "@/lib/photos/album-queries";
import { objectStorage } from "@/lib/storage";

type Params = Promise<{ slug: string }>;

const SLUG = /^[a-z0-9-]{1,70}$/;

/** One lookup per request, shared by the page and its metadata. */
const loadAlbum = cache(async (slug: string) => {
  const storage = objectStorage();
  if (!SLUG.test(slug) || !storage) return null;
  return getPublicAlbum(db(), storage, slug);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const album = await loadAlbum((await params).slug);
  if (!album) return { title: "Album not found" };
  const jpeg = album.cover?.image.jpeg;
  return {
    title: `${album.title}: Photos`,
    description: album.description || `Photos of The Leftovers: ${album.title}.`,
    alternates: { canonical: `/photos/albums/${album.slug}` },
    openGraph: {
      type: "website",
      images: jpeg && album.cover ? [{ url: jpeg.url, width: jpeg.width, height: jpeg.height, alt: album.cover.altText }] : [],
    },
  };
}

export default async function AlbumPage({ params }: { params: Params }) {
  const album = await loadAlbum((await params).slug);
  if (!album) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <Link href="/photos" className="font-heading tracking-wider uppercase underline">
        All photos
      </Link>
      <h1 className="mt-4 font-heading text-4xl font-bold tracking-wider uppercase">{album.title}</h1>
      {album.eventDate && <p className="mt-1">{formatLongDate(album.eventDate)}</p>}
      {album.description && <p className="mt-4 max-w-3xl whitespace-pre-line">{album.description}</p>}
      <ul className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
        {album.photos.map((photo, index) => (
          <li key={photo.id}>
            <Link href={`/photos/${photo.id}`} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
              <PhotoImg
                image={photo.image}
                alt={photo.altText}
                sizes="(min-width: 1152px) 380px, (min-width: 768px) 33vw, 50vw"
                priority={index < 3}
                className="aspect-square w-full bg-charcoal object-cover"
              />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
