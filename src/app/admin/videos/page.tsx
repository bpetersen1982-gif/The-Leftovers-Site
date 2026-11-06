import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { todayInBandTimeZone } from "@/lib/dates";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { can } from "@/lib/permissions";
import { showOptions } from "@/lib/shows/queries";
import { type BandVideo, getBandVideoBoard } from "@/lib/video/queries";
import { streamClient, type StorageUsage } from "@/lib/video/stream";
import { type CardVideo, InProgressCard, PublishedCard, ReadyCard, RemovedCard, TakenDownCard } from "./video-cards";
import { RefreshWhileProcessing, VideoUploader } from "./video-uploader";

export const metadata: Metadata = { title: "Videos" };

const GRID = "grid gap-4 md:grid-cols-2";
/** Stream bills per 1,000 stored minutes; warn as the band nears the first block (MED-11). */
const STORAGE_WARN_MINUTES = 800;
const DOLLARS_PER_1000_MINUTES = 5;

function toCard(video: BandVideo): CardVideo {
  return {
    id: video.id,
    version: video.version,
    status: video.status,
    originalFilename: video.originalFilename,
    title: video.title,
    description: video.description,
    posterSeconds: video.posterSeconds,
    durationSeconds: video.durationSeconds,
    duration: video.duration,
    captionsLanguage: video.captionsLanguage,
    showId: video.showId,
    failureReason: video.failureReason,
    uploaderName: video.uploaderName,
    removalRequestedByName: video.removalRequestedByName,
    removalReason: video.removalReason,
    playback: video.playback,
  };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="space-y-4">
      <h2 id={`${id}-heading`} className="font-heading text-xl font-bold tracking-wider uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function UsageLine({ usage }: { usage: StorageUsage | null }) {
  if (!usage) return <p className="text-sm text-cream/90">Storage usage isn&apos;t available right now.</p>;
  const minutes = Math.round(usage.totalStorageMinutes);
  const blocks = Math.max(1, Math.ceil(minutes / 1000));
  const nearLimit = usage.totalStorageMinutesLimit ? minutes >= usage.totalStorageMinutesLimit * 0.8 : minutes >= STORAGE_WARN_MINUTES;
  return (
    <p className={`text-sm ${nearLimit ? "font-semibold text-red-text" : "text-cream/90"}`} role={nearLimit ? "alert" : undefined}>
      Stream storage: {minutes.toLocaleString("en-US")} minutes in {usage.videoCount} video{usage.videoCount === 1 ? "" : "s"}
      {usage.totalStorageMinutesLimit ? ` of ${usage.totalStorageMinutesLimit.toLocaleString("en-US")}` : ""} (about ${blocks * DOLLARS_PER_1000_MINUTES}/month
      plus viewing).
      {nearLimit ? " Getting close to the next price step: delete old drafts or long clips." : ""}
    </p>
  );
}

export default async function AdminVideosPage() {
  const viewer = await requirePermission("videos:view");
  const stream = streamClient();
  if (!stream) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Videos</h1>
        <p>Video isn&apos;t configured on this server yet (Cloudflare Stream settings are missing).</p>
      </div>
    );
  }
  const isAdmin = can(viewer.role, "videos:manage");
  const [board, usage, shows] = await Promise.all([
    getBandVideoBoard(db(), stream, viewer),
    isAdmin
      ? stream.storageUsage().catch((error: unknown) => {
          logger.warn({ err: error }, "stream storage usage unavailable");
          return null;
        })
      : Promise.resolve(null),
    isAdmin ? showOptions(db(), todayInBandTimeZone()) : Promise.resolve([]),
  ]);
  const today = todayInBandTimeZone();
  const processing = board.inProgress.some((video) => video.status !== "FAILED");

  return (
    <div className="space-y-10">
      <RefreshWhileProcessing active={processing} />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Videos</h1>
        <Link href="/videos" className="underline">
          View public page
        </Link>
      </div>

      {isAdmin ? (
        <>
          <VideoUploader maxGigabytes={Math.round(stream.maxBytes / 1024 ** 3)} />
          <UsageLine usage={usage} />
        </>
      ) : (
        <p className="text-cream/90">Admins add videos. You can take a published video off the site if something&apos;s wrong with it.</p>
      )}

      {isAdmin && board.inProgress.length > 0 && (
        <Section id="processing" title={`Uploading and processing (${board.inProgress.length})`}>
          <ul className={GRID}>
            {board.inProgress.map((video) => (
              <li key={`${video.id}:${video.version}`}>
                <InProgressCard video={toCard(video)} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isAdmin && (
        <Section id="ready" title={`Ready to publish (${board.ready.length})`}>
          {board.ready.length === 0 ? (
            <p className="text-cream/90">Nothing waiting. Processed uploads show up here, private, until you publish them.</p>
          ) : (
            <ul className={GRID}>
              {board.ready.map((video) => (
                <li key={`${video.id}:${video.version}`}>
                  <ReadyCard video={toCard(video)} shows={shows} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section id="published" title={`Published (${board.published.length})`}>
        {board.published.length === 0 ? (
          <p className="text-cream/90">No videos on the public site yet.</p>
        ) : (
          <ul className={GRID}>
            {board.published.map((video) => (
              <li key={`${video.id}:${video.version}`}>
                <PublishedCard video={toCard(video)} isAdmin={isAdmin} today={today} shows={shows} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {board.removed.length > 0 && (
        <Section id="removed" title={`Removed from site (${board.removed.length})`}>
          <ul className={GRID}>
            {board.removed.map((video) => (
              <li key={`${video.id}:${video.version}`}>
                <RemovedCard video={toCard(video)} isAdmin={isAdmin} today={today} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isAdmin && board.takenDown.length > 0 && (
        <Section id="takedowns" title={`Copyright takedowns (${board.takenDown.length})`}>
          <ul className={GRID}>
            {board.takenDown.map((video) => (
              <li key={`${video.id}:${video.version}`}>
                <TakenDownCard video={toCard(video)} notice={video.notice} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
