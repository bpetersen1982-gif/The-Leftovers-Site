import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { type AlbumPhoto, getBandAlbum } from "@/lib/photos/album-queries";
import { objectStorage } from "@/lib/storage";
import { AddPhotosForm, AlbumPhotoList, type AlbumPhotoCard, DeleteAlbumForm, EditAlbumForm } from "../album-forms";

export const metadata: Metadata = { title: "Album" };

const NOTICES: Record<string, string> = { created: "Album created. Add photos below." };

function toCard(photo: AlbumPhoto): AlbumPhotoCard {
  return { id: photo.id, altText: photo.altText, isPublic: photo.status === "APPROVED", image: photo.image };
}

export default async function AdminAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  await requirePermission("albums:manage");
  const [{ id: rawId }, { notice }] = await Promise.all([params, searchParams]);
  const id = z.uuid().safeParse(rawId);
  const storage = objectStorage();
  if (!id.success || !storage) notFound();
  const album = await getBandAlbum(db(), storage, id.data);
  if (!album) notFound();
  const noticeText = notice ? NOTICES[notice] : undefined;
  const publicCount = album.photos.filter((photo) => photo.status === "APPROVED").length;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">{album.title}</h1>
        <span className="flex gap-4">
          {album.isPublic && publicCount > 0 && (
            <Link href={`/photos/albums/${album.slug}`} className="underline">
              View public page
            </Link>
          )}
          <Link href="/admin/photos/albums" className="underline">
            All albums
          </Link>
        </span>
      </div>
      {noticeText && (
        <p role="status" className="font-semibold">
          {noticeText}
        </p>
      )}

      <section aria-labelledby="album-details" className="space-y-4">
        <h2 id="album-details" className="font-heading text-xl font-bold tracking-wider uppercase">
          Details
        </h2>
        <EditAlbumForm
          albumId={album.id}
          version={album.version}
          details={{ title: album.title, description: album.description, eventDate: album.eventDate, isPublic: album.isPublic }}
        />
      </section>

      <section aria-labelledby="album-photos" className="space-y-4">
        <h2 id="album-photos" className="font-heading text-xl font-bold tracking-wider uppercase">
          Photos in this album ({album.photos.length})
        </h2>
        {album.photos.length === 0 ? (
          <p className="text-cream/90">No photos yet. Pick some below.</p>
        ) : (
          <AlbumPhotoList albumId={album.id} version={album.version} photos={album.photos.map(toCard)} coverPhotoId={album.coverPhotoId} />
        )}
      </section>

      <section aria-labelledby="album-add" className="space-y-4">
        <h2 id="album-add" className="font-heading text-xl font-bold tracking-wider uppercase">
          Add published photos
        </h2>
        <AddPhotosForm albumId={album.id} version={album.version} photos={album.addable.map(toCard)} />
      </section>

      <section aria-labelledby="album-delete" className="space-y-2 border-t border-olive/60 pt-6">
        <h2 id="album-delete" className="font-heading text-xl font-bold tracking-wider uppercase">
          Delete album
        </h2>
        <p className="text-cream/90">Deleting the album doesn&apos;t delete its photos.</p>
        <DeleteAlbumForm albumId={album.id} version={album.version} title={album.title} />
      </section>
    </div>
  );
}
