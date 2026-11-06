import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listSongs } from "@/lib/songs/service";
import { AddSongForm, ImportSongsForm, SongRow } from "./song-forms";

export const metadata: Metadata = { title: "Song list" };

export default async function AdminSongsPage() {
  await requirePermission("songs:manage");
  const songs = await listSongs(db(), { includeHidden: true });
  const hidden = songs.filter((song) => !song.isVisible).length;
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Song list</h1>
        <Link href="/songs" className="underline">
          View public page
        </Link>
      </div>
      <p className="text-cream/90">
        The covers you play. Venues and couples use it to check you know their songs. Adding the year sorts each song into its decade.
      </p>

      <section aria-labelledby="add-song" className="space-y-4 border border-olive/60 p-4">
        <h2 id="add-song" className="font-heading text-xl font-bold tracking-wider uppercase">
          Add a song
        </h2>
        <AddSongForm />
      </section>

      <section aria-labelledby="import-songs" className="space-y-4 border border-olive/60 p-4">
        <h2 id="import-songs" className="font-heading text-xl font-bold tracking-wider uppercase">
          Add many at once
        </h2>
        <ImportSongsForm />
      </section>

      <section aria-labelledby="all-songs" className="space-y-2">
        <h2 id="all-songs" className="font-heading text-xl font-bold tracking-wider uppercase">
          On the list ({songs.length}
          {hidden > 0 ? `, ${hidden} hidden` : ""})
        </h2>
        {songs.length === 0 ? (
          <p className="text-cream/90">No songs yet.</p>
        ) : (
          <div>
            {songs.map((song) => (
              <SongRow key={`${song.id}:${song.version}`} song={song} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
