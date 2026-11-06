import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { listPublicShows, musicEventJsonLd } from "@/lib/shows/queries";
import { ShowCard } from "./show-card";

export const metadata: Metadata = {
  title: "Shows",
  description: "Where The Leftovers are playing next: 90s & 2000s rock and alternative covers around Lincoln, Nebraska.",
  alternates: { canonical: "/shows" },
};

export default async function ShowsPage() {
  const { upcoming, past } = await listPublicShows(db(), todayInBandTimeZone());
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">Shows</h1>
      <section aria-labelledby="upcoming" className="mt-8">
        <h2 id="upcoming" className="sr-only">
          Upcoming shows
        </h2>
        {upcoming.length === 0 ? (
          <p>
            No public shows on the calendar right now. Want us at your place or event?{" "}
            <Link href="/book" className="underline">
              Book us
            </Link>
            .
          </p>
        ) : (
          <div className="border-t border-olive/50">
            {upcoming.map((show) => (
              <ShowCard key={show.id} show={show} headingLevel={3} />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section aria-labelledby="past" className="mt-12">
          <h2 id="past" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Past shows
          </h2>
          <div className="mt-2 border-t border-olive/50">
            {past.map((show) => (
              <ShowCard key={show.id} show={show} headingLevel={3} />
            ))}
          </div>
        </section>
      )}
      {upcoming.length > 0 && <JsonLd data={upcoming.map(musicEventJsonLd)} />}
    </main>
  );
}
