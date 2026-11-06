import type { PrismaClient } from "@/generated/prisma/client";
import type { ShowStatus } from "@/generated/prisma/enums";
import { fromUtc, type IsoDate, toDbDate } from "../dates";
import { publicImage, type PhotoImage } from "../photos/queries";
import type { ObjectStorage } from "../storage";
import { formatDuration, playbackFor, type VideoPlayback } from "../video/queries";
import { showEndUtc, zonedIso, zonedToUtc } from "./service";

/** Read models for shows. The public only sees `isPublic` shows. */

export interface ShowSummary {
  readonly id: string;
  readonly version: number;
  readonly slug: string;
  readonly date: IsoDate;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly timeZone: string;
  readonly venueName: string;
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly ticketUrl: string | null;
  readonly priceText: string;
  readonly description: string;
  readonly status: ShowStatus;
  readonly isPublic: boolean;
  readonly bookingRequestId: string | null;
}

const SELECT = {
  id: true,
  version: true,
  slug: true,
  date: true,
  startTime: true,
  endTime: true,
  timeZone: true,
  venueName: true,
  street: true,
  city: true,
  state: true,
  ticketUrl: true,
  priceText: true,
  description: true,
  status: true,
  isPublic: true,
  bookingRequestId: true,
} as const;

type Row = Omit<ShowSummary, "date"> & { date: Date };

function toSummary(row: Row): ShowSummary {
  return { ...row, date: fromUtc(row.date) };
}

const PAST_LIMIT = 50;

export async function listPublicShows(prisma: PrismaClient, today: IsoDate): Promise<{ upcoming: ShowSummary[]; past: ShowSummary[] }> {
  const [upcoming, past] = await Promise.all([
    prisma.show.findMany({ where: { isPublic: true, date: { gte: toDbDate(today) } }, orderBy: [{ date: "asc" }, { startTime: "asc" }], select: SELECT }),
    prisma.show.findMany({ where: { isPublic: true, date: { lt: toDbDate(today) } }, orderBy: [{ date: "desc" }], take: PAST_LIMIT, select: SELECT }),
  ]);
  return { upcoming: upcoming.map(toSummary), past: past.map(toSummary) };
}

/** Every show for the band's list: upcoming first, then the most recent past ones. */
export async function listBandShows(prisma: PrismaClient, today: IsoDate): Promise<{ upcoming: ShowSummary[]; past: ShowSummary[] }> {
  const [upcoming, past] = await Promise.all([
    prisma.show.findMany({ where: { date: { gte: toDbDate(today) } }, orderBy: [{ date: "asc" }, { startTime: "asc" }], select: SELECT }),
    prisma.show.findMany({ where: { date: { lt: toDbDate(today) } }, orderBy: [{ date: "desc" }], take: PAST_LIMIT, select: SELECT }),
  ]);
  return { upcoming: upcoming.map(toSummary), past: past.map(toSummary) };
}

export async function getBandShow(prisma: PrismaClient, id: string): Promise<ShowSummary | null> {
  const row = await prisma.show.findUnique({ where: { id }, select: SELECT });
  return row ? toSummary(row) : null;
}

/** Shows to pick from when linking an album or video: the last two years and anything upcoming. */
export async function showOptions(prisma: PrismaClient, today: IsoDate): Promise<{ id: string; label: string }[]> {
  const since = new Date(toDbDate(today).getTime() - 730 * 86_400_000);
  const rows = await prisma.show.findMany({ where: { date: { gte: since } }, orderBy: { date: "desc" }, select: { id: true, date: true, venueName: true, city: true } });
  return rows.map((row) => ({ id: row.id, label: `${fromUtc(row.date)} · ${row.venueName}, ${row.city}` }));
}

export interface PublicShowMedia {
  readonly albums: readonly { slug: string; title: string; cover: { image: PhotoImage; altText: string } | null }[];
  readonly videos: readonly { id: string; title: string; duration: string | null; playback: VideoPlayback }[];
}

/** One public show with its public albums and published videos (EVT-3). */
export async function getPublicShow(prisma: PrismaClient, storage: ObjectStorage | null, slug: string): Promise<(ShowSummary & PublicShowMedia) | null> {
  const row = await prisma.show.findFirst({
    where: { slug, isPublic: true },
    select: {
      ...SELECT,
      albums: {
        where: { isPublic: true, items: { some: { photo: { status: "APPROVED" } } } },
        orderBy: { createdAt: "asc" },
        select: {
          slug: true,
          title: true,
          items: {
            where: { photo: { status: "APPROVED" } },
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { photo: { select: { id: true, width: true, height: true, variants: true, blurDataUrl: true, publicPrefix: true, altText: true } } },
          },
        },
      },
      videos: {
        where: { status: "PUBLISHED", playbackOrigin: { not: null } },
        orderBy: { publishedAt: "asc" },
        select: { id: true, title: true, streamUid: true, playbackOrigin: true, posterSeconds: true, captionsLanguage: true, durationSeconds: true },
      },
    },
  });
  if (!row) return null;
  const { albums, videos, ...show } = row;
  return {
    ...toSummary(show),
    albums: albums.map((album) => {
      const photo = album.items[0]?.photo;
      const image = photo && storage ? publicImage(storage, photo) : null;
      return { slug: album.slug, title: album.title, cover: image && photo ? { image, altText: photo.altText } : null };
    }),
    videos: videos.flatMap((video) =>
      video.playbackOrigin
        ? [{ id: video.id, title: video.title, duration: formatDuration(video.durationSeconds), playback: playbackFor(video.playbackOrigin, video.streamUid, video.posterSeconds, video.captionsLanguage) }]
        : [],
    ),
  };
}

// ---------------------------------------------------------------- formatting & structured data

const SITE_URL = "https://theleftoversband.com";

export function formatShowTime(show: Pick<ShowSummary, "startTime" | "endTime">): string | null {
  const fmt = (time: string) => {
    const [hour = 0, minute = 0] = time.split(":").map(Number);
    const suffix = hour >= 12 ? "pm" : "am";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return minute === 0 ? `${twelve}${suffix}` : `${twelve}:${String(minute).padStart(2, "0")}${suffix}`;
  };
  if (!show.startTime) return null;
  return show.endTime ? `${fmt(show.startTime)}–${fmt(show.endTime)}` : fmt(show.startTime);
}

/** schema.org MusicEvent (EVT-2) for Google's event results. */
export function musicEventJsonLd(show: ShowSummary): Record<string, unknown> {
  const location = {
    "@type": "Place",
    name: show.venueName,
    address: { "@type": "PostalAddress", streetAddress: show.street || undefined, addressLocality: show.city, addressRegion: show.state, addressCountry: "US" },
  };
  const start = show.startTime ? zonedIso(show.date, show.startTime, show.timeZone) : show.date;
  const end = show.startTime ? showEndUtc(show.date, show.startTime, show.endTime, show.timeZone).toISOString() : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: `The Leftovers at ${show.venueName}`,
    url: `${SITE_URL}/shows/${show.slug}`,
    startDate: start,
    endDate: end,
    eventStatus: show.status === "CANCELLED" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location,
    description: show.description || "90s & 2000s rock and alternative covers.",
    performer: { "@type": "MusicGroup", name: "The Leftovers", url: SITE_URL },
    organizer: { "@type": "MusicGroup", name: "The Leftovers", url: SITE_URL },
    image: [`${SITE_URL}/brand/logo-wordmark.png`],
    ...(show.ticketUrl
      ? {
          offers: {
            "@type": "Offer",
            url: show.ticketUrl,
            availability: show.status === "SOLD_OUT" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------- calendar file (EVT-4)

/** RFC 5545 text escaping. */
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines over 75 octets are folded (CRLF + space). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function showIcs(show: ShowSummary, now: Date = new Date()): string {
  const location = [show.venueName, show.street, `${show.city}, ${show.state}`].filter(Boolean).join(", ");
  const when = show.startTime
    ? [`DTSTART:${icsUtc(zonedToUtc(show.date, show.startTime, show.timeZone))}`, `DTEND:${icsUtc(showEndUtc(show.date, show.startTime, show.endTime, show.timeZone))}`]
    : [`DTSTART;VALUE=DATE:${show.date.replace(/-/g, "")}`];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Leftovers//Shows//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${show.id}@theleftoversband.com`,
    `DTSTAMP:${icsUtc(now)}`,
    ...when,
    `SUMMARY:${icsText(`The Leftovers at ${show.venueName}`)}`,
    `LOCATION:${icsText(location)}`,
    `DESCRIPTION:${icsText([show.description, `${SITE_URL}/shows/${show.slug}`].filter(Boolean).join("\n\n"))}`,
    `URL:${SITE_URL}/shows/${show.slug}`,
    `STATUS:${show.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
