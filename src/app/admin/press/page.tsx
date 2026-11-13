import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { getPage } from "@/lib/content/service";
import { db } from "@/lib/db";
import { publicImage } from "@/lib/photos/queries";
import { formatBytes, listPressFiles, MAX_PRESS_PHOTOS, MAX_PRESS_VIDEOS } from "@/lib/press/service";
import { objectStorage } from "@/lib/storage";
import { playbackFor } from "@/lib/video/queries";
import { PressFileSlot, PressPhotoPicker, PressVideoPicker } from "./press-forms";

export const metadata: Metadata = { title: "Press kit" };

const UPLOADED = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" });

export default async function AdminPressPage() {
  await requirePermission("press:manage");
  const storage = objectStorage();
  const [shortBio, longBio, rider, files, photos, videos] = await Promise.all([
    getPage(db(), "press-short-bio"),
    getPage(db(), "press-long-bio"),
    getPage(db(), "press-rider"),
    listPressFiles(db(), storage),
    db().photo.findMany({
      where: { status: "APPROVED" },
      orderBy: { publishedAt: "desc" },
      take: 200,
      select: { id: true, width: true, height: true, variants: true, blurDataUrl: true, publicPrefix: true, altText: true, isPressPhoto: true },
    }),
    db().video.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, streamUid: true, playbackOrigin: true, posterSeconds: true, isPressHighlight: true },
    }),
  ]);
  const current = (kind: keyof typeof files) => {
    const file = files[kind];
    return file ? { url: file.url, size: formatBytes(file.bytes), uploaded: UPLOADED.format(file.uploadedAt) } : null;
  };
  const sections = [
    { slug: "press-short-bio", label: "Short bio", filled: shortBio.blocks.length > 0 },
    { slug: "press-long-bio", label: "Long bio", filled: longBio.blocks.length > 0 },
    { slug: "press-rider", label: "Rider and stage needs", filled: rider.blocks.length > 0 },
  ];

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Press kit</h1>
        <Link href="/press" className="underline">
          View public page
        </Link>
      </div>
      <p className="text-cream/90">For promoters, venues, and press. Anything left empty shows as &ldquo;coming soon&rdquo; on the public page.</p>

      <section aria-labelledby="press-text" className="space-y-3">
        <h2 id="press-text" className="font-heading text-xl font-bold tracking-wider uppercase">
          Text
        </h2>
        <ul className="divide-y divide-olive/50 border-y border-olive/50">
          {sections.map((section) => (
            <li key={section.slug} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <span>
                {section.label} <span className="text-sm text-cream/80">· {section.filled ? "written" : "empty"}</span>
              </span>
              <Link href={`/admin/pages/${section.slug}`} className="underline">
                Edit {section.label.toLowerCase()}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="press-files" className="space-y-3">
        <h2 id="press-files" className="font-heading text-xl font-bold tracking-wider uppercase">
          Downloads
        </h2>
        {!storage ? (
          <p>File storage isn&apos;t set up on this server.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <PressFileSlot kind="LOGO" label="Hi-res logo" accept="image/png,image/jpeg" current={current("LOGO")} />
            <PressFileSlot kind="RIDER" label="Tech rider" accept="application/pdf,.pdf" current={current("RIDER")} />
            <PressFileSlot kind="STAGE_PLOT" label="Stage plot" accept="application/pdf,.pdf" current={current("STAGE_PLOT")} />
          </div>
        )}
        <p className="text-sm text-cream/90">Logo: PNG or JPEG up to 25 MB (a transparent PNG at least 2000 px wide is ideal). Rider and stage plot: PDF up to 15 MB.</p>
      </section>

      <section aria-labelledby="press-photo-pick" className="space-y-3">
        <h2 id="press-photo-pick" className="font-heading text-xl font-bold tracking-wider uppercase">
          Press photos
        </h2>
        {photos.length === 0 || !storage ? (
          <p className="text-cream/90">
            No published photos yet.{" "}
            <Link href="/admin/photos" className="underline">
              Add photos
            </Link>
          </p>
        ) : (
          <PressPhotoPicker
            max={MAX_PRESS_PHOTOS}
            items={photos.map((photo) => ({ id: photo.id, label: photo.altText, thumbUrl: publicImage(storage, photo)?.sources[0]?.url ?? null, selected: photo.isPressPhoto }))}
          />
        )}
      </section>

      <section aria-labelledby="press-video-pick" className="space-y-3">
        <h2 id="press-video-pick" className="font-heading text-xl font-bold tracking-wider uppercase">
          Video highlights
        </h2>
        {videos.length === 0 ? (
          <p className="text-cream/90">
            No published videos yet.{" "}
            <Link href="/admin/videos" className="underline">
              Add videos
            </Link>
          </p>
        ) : (
          <PressVideoPicker
            max={MAX_PRESS_VIDEOS}
            items={videos.map((video) => ({
              id: video.id,
              label: video.title,
              thumbUrl: video.playbackOrigin ? playbackFor(video.playbackOrigin, video.streamUid, video.posterSeconds, null).posterUrl : null,
              selected: video.isPressHighlight,
            }))}
          />
        )}
      </section>
    </div>
  );
}
