import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { formatLongDate, todayInBandTimeZone } from "@/lib/dates";
import { showOptions } from "@/lib/shows/queries";
import { db } from "@/lib/db";
import { listBandAlbums } from "@/lib/photos/album-queries";
import { objectStorage } from "@/lib/storage";
import { CreateAlbumForm } from "./album-forms";

export const metadata: Metadata = { title: "Albums" };

const NOTICES: Record<string, string> = { deleted: "Album deleted. Its photos are still on the site." };

export default async function AdminAlbumsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requirePermission("albums:manage");
  const { notice } = await searchParams;
  const storage = objectStorage();
  const [albums, shows] = await Promise.all([storage ? listBandAlbums(db(), storage) : [], showOptions(db(), todayInBandTimeZone())]);
  const noticeText = notice ? NOTICES[notice] : undefined;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Albums</h1>
        <Link href="/admin/photos" className="underline">
          Back to photos
        </Link>
      </div>
      {noticeText && (
        <p role="status" className="font-semibold">
          {noticeText}
        </p>
      )}
      <p className="text-cream/90">
        Group published photos by show. A photo can be in more than one album. Albums only appear publicly once they&apos;re
        set to public and have at least one published photo.
      </p>

      {albums.length === 0 ? (
        <p>No albums yet.</p>
      ) : (
        <ul className="divide-y divide-olive/50 border-y border-olive/50">
          {albums.map((album) => (
            <li key={album.id} className="py-3">
              <Link href={`/admin/photos/albums/${album.id}`} className="group flex flex-wrap items-baseline justify-between gap-3">
                <span>
                  <span className="font-semibold group-hover:underline">{album.title}</span>
                  {album.eventDate && <span className="block text-sm text-cream/90">{formatLongDate(album.eventDate)}</span>}
                </span>
                <span className="text-right text-sm">
                  <span className="block font-heading tracking-wider uppercase">{album.isPublic ? "Public" : "Hidden"}</span>
                  <span className="block text-cream/90">
                    {album.totalPhotoCount} photo{album.totalPhotoCount === 1 ? "" : "s"}
                    {album.publicPhotoCount !== album.totalPhotoCount ? ` (${album.publicPhotoCount} on site)` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="new-album" className="space-y-4 border border-olive/60 p-4">
        <h2 id="new-album" className="font-heading text-xl font-bold tracking-wider uppercase">
          New album
        </h2>
        <CreateAlbumForm shows={shows} />
      </section>
    </div>
  );
}
