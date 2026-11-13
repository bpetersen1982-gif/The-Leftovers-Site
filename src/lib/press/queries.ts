import type { PrismaClient } from "@/generated/prisma/client";
import type { Block } from "../content/blocks";
import { getPage, getSiteSettings } from "../content/service";
import { type PhotoImage, publicImage } from "../photos/queries";
import { listSongs, type SongView } from "../songs/service";
import type { ObjectStorage } from "../storage";
import { formatDuration, playbackFor, type VideoPlayback } from "../video/queries";
import { listPressFiles, type PressFileView } from "./service";

/** Everything /press shows. Empty sections stay empty so the page can say "coming soon". */
export interface PressKit {
  readonly shortBio: readonly Block[];
  readonly longBio: readonly Block[];
  readonly rider: readonly Block[];
  readonly bookingEmail: string;
  readonly photos: readonly { id: string; altText: string; credit: string; image: PhotoImage }[];
  readonly videos: readonly { id: string; title: string; duration: string | null; playback: VideoPlayback }[];
  readonly files: Partial<Record<PressFileView["kind"], PressFileView>>;
  readonly songs: readonly SongView[];
  readonly songTotal: number;
}

const SAMPLE_SONGS = 15;

export async function getPressKit(prisma: PrismaClient, storage: ObjectStorage | null): Promise<PressKit> {
  const [shortBio, longBio, rider, settings, photoRows, videoRows, files, songs] = await Promise.all([
    getPage(prisma, "press-short-bio"),
    getPage(prisma, "press-long-bio"),
    getPage(prisma, "press-rider"),
    getSiteSettings(prisma),
    prisma.photo.findMany({
      where: { status: "APPROVED", isPressPhoto: true },
      orderBy: { publishedAt: "desc" },
      select: { id: true, width: true, height: true, variants: true, blurDataUrl: true, publicPrefix: true, altText: true, credit: true },
    }),
    prisma.video.findMany({
      where: { status: "PUBLISHED", isPressHighlight: true, playbackOrigin: { not: null } },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, streamUid: true, playbackOrigin: true, posterSeconds: true, captionsLanguage: true, durationSeconds: true },
    }),
    listPressFiles(prisma, storage),
    listSongs(prisma, { includeHidden: false }),
  ]);
  return {
    shortBio: shortBio.blocks,
    longBio: longBio.blocks,
    rider: rider.blocks,
    bookingEmail: settings.bookingEmail,
    photos: storage
      ? photoRows.flatMap((row) => {
          const image = publicImage(storage, row);
          return image ? [{ id: row.id, altText: row.altText, credit: row.credit, image }] : [];
        })
      : [],
    videos: videoRows.flatMap((row) =>
      row.playbackOrigin
        ? [{ id: row.id, title: row.title, duration: formatDuration(row.durationSeconds), playback: playbackFor(row.playbackOrigin, row.streamUid, row.posterSeconds, row.captionsLanguage) }]
        : [],
    ),
    files,
    // A spread of the list rather than only the start of the alphabet.
    songs: songs.length <= SAMPLE_SONGS ? songs : Array.from({ length: SAMPLE_SONGS }, (_, index) => songs[Math.floor((index * songs.length) / SAMPLE_SONGS)] as SongView),
    songTotal: songs.length,
  };
}
