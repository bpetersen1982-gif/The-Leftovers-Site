import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BlockContent } from "@/components/block-content";
import { PhotoImg } from "@/components/photo-img";
import { VideoPlayer } from "@/components/video-player";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getPressKit } from "@/lib/press/queries";
import { formatBytes } from "@/lib/press/service";
import { objectStorage } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Press kit",
  description: "Bios, photos, logo, video, song list, and tech rider for The Leftovers, a 90s & 2000s rock cover band from Lincoln, Nebraska.",
  alternates: { canonical: "/press" },
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="font-heading text-2xl font-bold tracking-wider uppercase">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ editHref, canEdit }: { editHref: string; canEdit: boolean }) {
  return (
    <p className="italic">
      Coming soon.{" "}
      {canEdit && (
        <Link href={editHref} className="font-semibold not-italic underline">
          Add it
        </Link>
      )}
    </p>
  );
}

export default async function PressPage() {
  const [kit, viewer] = await Promise.all([getPressKit(db(), objectStorage()), getCurrentUser()]);
  const canEdit = viewer !== null && can(viewer.role, "press:manage");
  const logo = kit.files.LOGO;
  const documents = [
    { kind: "RIDER" as const, label: "Tech rider" },
    { kind: "STAGE_PLOT" as const, label: "Stage plot" },
  ].flatMap((doc) => (kit.files[doc.kind] ? [{ ...doc, file: kit.files[doc.kind] }] : []));

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-heading text-4xl font-bold tracking-wider uppercase">Press kit</h1>
      <p className="mt-4 max-w-2xl">
        Everything for promoters, venues, and press. Booking:{" "}
        <a href={`mailto:${kit.bookingEmail}`} className="font-semibold underline">
          {kit.bookingEmail}
        </a>{" "}
        or{" "}
        <Link href="/book" className="underline">
          check dates and get a quote
        </Link>
        .
      </p>

      <Section id="short-bio" title="Short bio">
        {kit.shortBio.length > 0 ? <BlockContent blocks={kit.shortBio} /> : <Empty editHref="/admin/pages/press-short-bio" canEdit={canEdit} />}
      </Section>
      <Section id="long-bio" title="Long bio">
        {kit.longBio.length > 0 ? <BlockContent blocks={kit.longBio} /> : <Empty editHref="/admin/pages/press-long-bio" canEdit={canEdit} />}
      </Section>

      <Section id="press-photos" title="Photos">
        {kit.photos.length === 0 ? (
          <Empty editHref="/admin/press" canEdit={canEdit} />
        ) : (
          <>
            <p className="mb-4 text-sm text-cream/90">Free to use for promoting The Leftovers. Please credit the photographer where listed.</p>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {kit.photos.map((photo) => (
                <li key={photo.id}>
                  <PhotoImg image={photo.image} alt={photo.altText} sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw" className="aspect-[4/3] w-full bg-charcoal object-cover" />
                  {photo.image.jpeg && (
                    <a href={photo.image.jpeg.url} target="_blank" rel="noopener" className="mt-2 inline-block text-sm underline">
                      Full-size JPEG ({photo.image.jpeg.width}×{photo.image.jpeg.height})<span className="sr-only">: {photo.altText} (opens in a new tab)</span>
                    </a>
                  )}
                  {photo.credit && <p className="text-xs text-cream/80">Photo: {photo.credit}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section id="logo" title="Logo">
        <div className="flex flex-wrap items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
          <img src="/brand/logo-wordmark.png" alt="The Leftovers logo" width={315} height={166} className="w-56" />
          <ul className="space-y-2">
            {logo && (
              <li>
                <a href={logo.url} className="btn-primary">
                  Download hi-res logo
                </a>
                <span className="ml-2 text-sm">
                  {logo.width && logo.height ? `${logo.width}×${logo.height}, ` : ""}
                  {formatBytes(logo.bytes)}
                </span>
              </li>
            )}
            <li>
              <a href="/brand/logo-wordmark.png" download="the-leftovers-logo-web.png" className="underline">
                Web-size logo (PNG)
              </a>
            </li>
          </ul>
        </div>
      </Section>

      <Section id="video" title="Video">
        {kit.videos.length === 0 ? (
          <Empty editHref="/admin/press" canEdit={canEdit} />
        ) : (
          <ul className="grid gap-6 md:grid-cols-2">
            {kit.videos.map((video) => (
              <li key={video.id}>
                <VideoPlayer title={video.title} posterUrl={video.playback.posterUrl} iframeUrl={video.playback.iframeUrl} />
                <p className="mt-2 font-heading tracking-wide uppercase">
                  {video.title}
                  {video.duration ? <span className="ml-2 text-sm normal-case">{video.duration}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="songs" title="Sample song list">
        {kit.songs.length === 0 ? (
          <Empty editHref="/admin/songs" canEdit={canEdit} />
        ) : (
          <>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {kit.songs.map((song) => (
                <li key={song.id}>
                  {song.title} <span className="text-cream/80">· {song.artist}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4">
              <Link href="/songs" className="underline">
                See all {kit.songTotal} songs
              </Link>
            </p>
          </>
        )}
      </Section>

      <Section id="rider" title="Rider and stage needs">
        {kit.rider.length > 0 && <BlockContent blocks={kit.rider} />}
        {documents.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-3">
            {documents.map((doc) => (
              <li key={doc.kind}>
                <a href={doc.file?.url} className="btn-primary">
                  Download {doc.label.toLowerCase()} (PDF{doc.file ? `, ${formatBytes(doc.file.bytes)}` : ""})
                </a>
              </li>
            ))}
          </ul>
        )}
        {kit.rider.length === 0 && documents.length === 0 && <Empty editHref="/admin/press" canEdit={canEdit} />}
      </Section>
    </main>
  );
}
