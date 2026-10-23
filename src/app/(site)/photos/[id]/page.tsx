import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { PhotoImg } from "@/components/photo-img";
import { db } from "@/lib/db";
import { getPublicPhoto } from "@/lib/photos/queries";
import { objectStorage } from "@/lib/storage";

type Params = Promise<{ id: string }>;

/** One lookup per request, shared by the page and its metadata. */
const loadPhoto = cache(async (rawId: string) => {
  const id = z.uuid().safeParse(rawId);
  const storage = objectStorage();
  if (!id.success || !storage) return null;
  return getPublicPhoto(db(), storage, id.data);
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await loadPhoto((await params).id);
  if (!result) return { title: "Photo not found" };
  const { photo } = result;
  const description = photo.caption || photo.altText;
  return {
    title: photo.caption ? `${photo.caption}: Photos` : "Photo",
    description,
    alternates: { canonical: `/photos/${photo.id}` },
    openGraph: {
      type: "article",
      images: photo.image.jpeg ? [{ url: photo.image.jpeg.url, width: photo.image.jpeg.width, height: photo.image.jpeg.height, alt: photo.altText }] : [],
    },
  };
}

export default async function PhotoPage({ params }: { params: Params }) {
  const result = await loadPhoto((await params).id);
  if (!result) notFound();
  const { photo, newerId, olderId } = result;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <nav aria-label="Photo navigation" className="mb-4 flex items-center justify-between gap-4 font-heading tracking-wider uppercase">
        <Link href="/photos" className="underline">
          All photos
        </Link>
        <span className="flex gap-6">
          {newerId ? (
            <Link href={`/photos/${newerId}`} className="underline" rel="prev">
              Newer
            </Link>
          ) : null}
          {olderId ? (
            <Link href={`/photos/${olderId}`} className="underline" rel="next">
              Older
            </Link>
          ) : null}
        </span>
      </nav>
      <figure>
        <PhotoImg
          image={photo.image}
          alt={photo.altText}
          sizes="(min-width: 1024px) 992px, 100vw"
          priority
          className="mx-auto max-h-[80dvh] w-auto bg-charcoal object-contain"
        />
        {(photo.caption || photo.credit) && (
          <figcaption className="mt-3 text-center">
            {photo.caption}
            {photo.credit && <span className="block text-sm text-cream/90">Photo: {photo.credit}</span>}
          </figcaption>
        )}
      </figure>
    </main>
  );
}
