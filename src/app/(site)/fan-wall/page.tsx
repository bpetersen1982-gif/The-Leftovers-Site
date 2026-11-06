import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { BlockContent } from "@/components/block-content";
import { db } from "@/lib/db";
import { getPage } from "@/lib/content/service";
import { formatLongDate } from "@/lib/dates";
import { listPublicFanPosts } from "@/lib/fan/queries";
import { pickableShows } from "@/lib/fan/service";
import { PhotoImg } from "@/components/photo-img";
import { objectStorage } from "@/lib/storage";
import { turnstileSiteKey } from "@/lib/turnstile";
import { FanWallForm } from "./fan-wall-form";

export const metadata: Metadata = {
  title: "Fan Wall",
  description: "Notes and photos from people who've seen The Leftovers play.",
  alternates: { canonical: "/fan-wall" },
};

const POSTED = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

function parsePage(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export default async function FanWallPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = parsePage((await searchParams).page);
  const [intro, { posts, pageCount }, shows, nonce] = await Promise.all([
    getPage(db(), "fan-wall"),
    listPublicFanPosts(db(), objectStorage(), page),
    pickableShows(db()),
    headers().then((list) => list.get("x-nonce") ?? ""),
  ]);
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">Fan Wall</h1>
      {intro.blocks.length > 0 && (
        <div className="mt-4">
          <BlockContent blocks={intro.blocks} />
        </div>
      )}
      {page === 1 && (
        <section aria-labelledby="post-heading" className="mt-8 border border-olive/60 p-5">
          <h2 id="post-heading" className="font-heading text-2xl font-bold tracking-wider uppercase">
            Leave a note
          </h2>
          <div className="mt-4">
            <FanWallForm siteKey={turnstileSiteKey()} nonce={nonce} shows={shows} />
          </div>
        </section>
      )}
      <section aria-labelledby="posts-heading" className="mt-12">
        <h2 id="posts-heading" className="sr-only">
          Posts
        </h2>
        {posts.length === 0 ? (
          <p>{page > 1 ? "No posts on this page." : "No posts yet. Be the first."}</p>
        ) : (
          <ul className="space-y-6">
            {posts.map((post) => (
              <li key={post.id}>
                <article className="panel-paper px-5 py-5" aria-label={`From ${post.displayName}`}>
                  {post.photo && (
                    <PhotoImg image={post.photo.image} alt={post.photo.altText} sizes="(min-width: 896px) 832px, 100vw" className="mb-4 max-h-[60dvh] w-full bg-charcoal object-contain" />
                  )}
                  <p className="whitespace-pre-line">{post.message}</p>
                  <p className="mt-3 text-sm font-semibold">
                    {post.displayName}
                    {post.show && (
                      <>
                        {" · at "}
                        <Link href={`/shows/${post.show.slug}`} className="underline">
                          {post.show.venueName}, {formatLongDate(post.show.date)}
                        </Link>
                      </>
                    )}
                    <span className="font-normal"> · {POSTED.format(post.createdAt)}</span>
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <nav aria-label="Fan Wall pages" className="mt-8 flex items-center justify-between font-heading tracking-wider uppercase">
            {page > 1 ? (
              <Link href={page === 2 ? "/fan-wall" : `/fan-wall?page=${page - 1}`} className="underline">
                Newer posts
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={`/fan-wall?page=${page + 1}`} className="underline">
                Older posts
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </main>
  );
}
