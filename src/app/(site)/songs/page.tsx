import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { listSongs } from "@/lib/songs/service";
import { SongSearch } from "./song-search";

export const metadata: Metadata = {
  title: "Song list",
  description: "The 90s and 2000s rock and alternative covers The Leftovers play: search by song, artist, or decade.",
  alternates: { canonical: "/songs" },
};

export default async function SongsPage() {
  const songs = await listSongs(db(), { includeHidden: false });
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">Song list</h1>
      <p className="mt-4 max-w-2xl">
        Some of the songs we play. Have a must-play song for your event? Mention it when you{" "}
        <Link href="/book" className="underline">
          book us
        </Link>
        .
      </p>
      <div className="mt-8">
        {songs.length === 0 ? (
          <p>The song list is coming soon.</p>
        ) : (
          <SongSearch songs={songs.map(({ id, title, artist, year, decade, note }) => ({ id, title, artist, year, decade, note }))} />
        )}
      </div>
    </main>
  );
}
