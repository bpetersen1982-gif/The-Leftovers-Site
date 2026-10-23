import type { Metadata } from "next";
import Link from "next/link";
import { PhotoImg } from "@/components/photo-img";
import { db } from "@/lib/db";
import { listPublicPhotos } from "@/lib/photos/queries";
import { objectStorage } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Photos",
  description: "Photos of The Leftovers playing 90s and 2000s rock around Lincoln, Nebraska.",
  alternates: { canonical: "/photos" },
};

function parsePage(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export default async function PhotosPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const storage = objectStorage();
  const gallery = storage ? await listPublicPhotos(db(), storage, page) : { photos: [], total: 0, pageCount: 1 };

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">Photos</h1>
      {gallery.photos.length === 0 ? (
        <p className="mt-6">{page > 1 ? "No photos on this page." : "Photos from our shows are coming soon."}</p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3">
          {gallery.photos.map((photo, index) => (
            <li key={photo.id}>
              <Link href={`/photos/${photo.id}`} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
                <PhotoImg
                  image={photo.image}
                  alt={photo.altText}
                  sizes="(min-width: 1152px) 380px, (min-width: 768px) 33vw, 50vw"
                  priority={index < 3 && page === 1}
                  className="aspect-square w-full bg-charcoal object-cover"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {gallery.pageCount > 1 && (
        <nav aria-label="Photo pages" className="mt-8 flex items-center justify-between font-heading tracking-wider uppercase">
          {page > 1 ? (
            <Link href={page === 2 ? "/photos" : `/photos?page=${page - 1}`} className="underline">
              Newer photos
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm">
            Page {page} of {gallery.pageCount}
          </span>
          {page < gallery.pageCount ? (
            <Link href={`/photos?page=${page + 1}`} className="underline">
              Older photos
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
