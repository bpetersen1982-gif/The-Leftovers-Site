"use client";

import { useId, useMemo, useState } from "react";

export interface PublicSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly year: number | null;
  readonly decade: string | null;
  readonly note: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Searchable song list (CNT-4). Every song is in the HTML (works without JavaScript and is
 * indexable); the search box and decade buttons just filter it in the browser.
 */
export function SongSearch({ songs }: { songs: readonly PublicSong[] }) {
  const [query, setQuery] = useState("");
  const [decade, setDecade] = useState<string | null>(null);
  const searchId = useId();
  const decades = useMemo(() => [...new Set(songs.flatMap((song) => (song.decade ? [song.decade] : [])))].sort(), [songs]);
  const shown = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return songs.filter((song) => {
      if (decade && song.decade !== decade) return false;
      const haystack = normalize(`${song.title} ${song.artist}`);
      return words.every((word) => haystack.includes(word));
    });
  }, [songs, query, decade]);

  const chip = (value: string | null, label: string) => (
    <button
      type="button"
      onClick={() => setDecade(value)}
      aria-pressed={decade === value}
      className={`border px-3 py-1 font-heading tracking-wider uppercase ${decade === value ? "border-cream bg-cream text-ink" : "border-cream/60 hover:bg-cream hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <label htmlFor={searchId} className="block font-heading font-semibold tracking-wide uppercase">
            Search songs or artists
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full border-2 border-cream/60 bg-charcoal px-3 py-2 text-cream"
            placeholder="e.g. Foo Fighters"
          />
        </div>
        {decades.length > 1 && (
          <div role="group" aria-label="Decade" className="flex flex-wrap gap-2">
            {chip(null, "All")}
            {decades.map((value) => chip(value, value))}
          </div>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-sm text-cream/90">
        {shown.length === songs.length ? `${songs.length} songs` : `${shown.length} of ${songs.length} songs`}
      </p>
      {shown.length === 0 ? (
        <p>No match. We may still know it, or learn it for your event: ask when you book.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Songs The Leftovers play</caption>
          <thead>
            <tr className="border-b border-olive/60 font-heading tracking-wider uppercase">
              <th scope="col" className="py-2 pr-4">
                Song
              </th>
              <th scope="col" className="py-2 pr-4">
                Artist
              </th>
              <th scope="col" className="hidden py-2 sm:table-cell">
                Year
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((song) => (
              <tr key={song.id} className="border-b border-olive/30 align-top">
                <td className="py-2 pr-4">
                  {song.title}
                  {song.note && <span className="block text-sm text-cream/80">{song.note}</span>}
                </td>
                <td className="py-2 pr-4">{song.artist}</td>
                <td className="hidden py-2 sm:table-cell">{song.year ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
