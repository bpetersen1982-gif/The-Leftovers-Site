import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { type AuditActor, writeAudit } from "../audit";
import { can } from "../permissions";

/**
 * Song list (requirements CNT-4): the covers the band plays, searchable by title and
 * artist, filterable by decade. Admins add songs one at a time or paste a whole list.
 */

export const MAX_SONG_FIELD = 120;
export const MAX_SONG_NOTE = 200;
export const MAX_IMPORT_LINES = 1_000;
const MIN_YEAR = 1900;

export type SongErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "DUPLICATE";

const MESSAGES: Record<SongErrorCode, string> = {
  FORBIDDEN: "Only Admins can change the song list.",
  NOT_FOUND: "That song is no longer on the list.",
  CONFLICT: "Someone else changed this song while you were looking at it. Reload and try again.",
  DUPLICATE: "That song is already on the list.",
};

export class SongError extends Error {
  override readonly name = "SongError";
  constructor(readonly code: SongErrorCode) {
    super(MESSAGES[code]);
  }
}

const oneLine = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer`));

function maxYear(): number {
  return new Date().getUTCFullYear() + 1;
}

export const songInputSchema = z.strictObject({
  title: oneLine(MAX_SONG_FIELD, "Title").pipe(z.string().min(1, "Enter the song title.")),
  artist: oneLine(MAX_SONG_FIELD, "Artist").pipe(z.string().min(1, "Enter the artist.")),
  year: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value)))
    .refine((value) => value === null || (Number.isInteger(value) && value >= MIN_YEAR && value <= maxYear()), "Use a 4-digit release year, or leave it blank."),
  note: oneLine(MAX_SONG_NOTE, "Note"),
  isVisible: z.boolean(),
});
export type SongInput = z.input<typeof songInputSchema>;

export const songRefSchema = z.strictObject({ id: z.uuid(), version: z.coerce.number().int().min(1) });
export type SongRef = z.infer<typeof songRefSchema>;

/** Same song, however it's typed: "The Killers | Mr. Brightside" = "killers|mr brightside". */
export function songMatchKey(artist: string, title: string): string {
  const squeeze = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${squeeze(artist).replace(/^the /, "")}|${squeeze(title)}`;
}

/** "1997" -> "1990s". */
export function decadeOf(year: number | null): string | null {
  return year === null ? null : `${Math.floor(year / 10) * 10}s`;
}

function assertCanManage(actor: AuditActor): void {
  if (!can(actor.role, "songs:manage")) throw new SongError("FORBIDDEN");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

interface Meta {
  readonly requestId?: string | null;
}

export async function createSong(prisma: PrismaClient, actor: AuditActor, input: SongInput, meta: Meta = {}): Promise<string> {
  assertCanManage(actor);
  const song = songInputSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.song.create({ data: { ...song, matchKey: songMatchKey(song.artist, song.title) } });
      await writeAudit(tx, { actor, action: "song.create", targetType: "song", targetId: created.id, after: { title: song.title, artist: song.artist }, requestId: meta.requestId });
      return created.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SongError("DUPLICATE");
    throw error;
  }
}

export async function updateSong(prisma: PrismaClient, actor: AuditActor, ref: SongRef, input: SongInput, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = songRefSchema.parse(ref);
  const song = songInputSchema.parse(input);
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.song.findUnique({ where: { id: parsedRef.id }, select: { title: true, artist: true, version: true } });
      if (!before) throw new SongError("NOT_FOUND");
      const updated = await tx.song.updateMany({
        where: { id: parsedRef.id, version: parsedRef.version },
        data: { ...song, matchKey: songMatchKey(song.artist, song.title), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new SongError("CONFLICT");
      await writeAudit(tx, {
        actor,
        action: "song.update",
        targetType: "song",
        targetId: parsedRef.id,
        before: { title: before.title, artist: before.artist },
        after: { title: song.title, artist: song.artist, isVisible: song.isVisible },
        requestId: meta.requestId,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SongError("DUPLICATE");
    throw error;
  }
}

export async function deleteSong(prisma: PrismaClient, actor: AuditActor, ref: SongRef, meta: Meta = {}): Promise<void> {
  assertCanManage(actor);
  const parsedRef = songRefSchema.parse(ref);
  await prisma.$transaction(async (tx) => {
    const song = await tx.song.findUnique({ where: { id: parsedRef.id }, select: { title: true, artist: true } });
    if (!song) throw new SongError("NOT_FOUND");
    const deleted = await tx.song.deleteMany({ where: { id: parsedRef.id, version: parsedRef.version } });
    if (deleted.count !== 1) throw new SongError("CONFLICT");
    await writeAudit(tx, { actor, action: "song.delete", targetType: "song", targetId: parsedRef.id, before: song, requestId: meta.requestId });
  });
}

// ---------------------------------------------------------------- bulk import

export interface ParsedLine {
  readonly line: number;
  readonly artist: string;
  readonly title: string;
  readonly year: string;
}

export interface ImportProblem {
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

/**
 * Reads a pasted list. Each line is either tab-separated (pasted from a spreadsheet:
 * artist, title, optional year) or "Artist - Title" with an optional "(1997)" at the end.
 * A header row ("artist / title / year") is skipped. Blank lines are ignored.
 */
export function parseSongList(text: string): { songs: ParsedLine[]; problems: ImportProblem[] } {
  const songs: ParsedLine[] = [];
  const problems: ImportProblem[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > MAX_IMPORT_LINES) {
    return { songs: [], problems: [{ line: MAX_IMPORT_LINES + 1, text: "", reason: `Paste up to ${MAX_IMPORT_LINES} lines at a time.` }] };
  }
  lines.forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim();
    if (text === "") return;
    if (raw.includes("\t")) {
      const [artist = "", title = "", year = ""] = raw.split("\t").map((cell) => cell.trim());
      if (index === 0 && /^artist$/i.test(artist) && /^(title|song)$/i.test(title)) return;
      songs.push({ line, artist, title, year });
      return;
    }
    const match = /^(.+?)\s+[-–—]\s+(.+?)(?:\s*\((\d{4})\))?$/.exec(text);
    if (!match) {
      problems.push({ line, text: text.slice(0, 80), reason: 'Use "Artist - Title (Year)" or paste from a spreadsheet.' });
      return;
    }
    songs.push({ line, artist: match[1] ?? "", title: match[2] ?? "", year: match[3] ?? "" });
  });
  return { songs, problems };
}

export interface ImportResult {
  readonly added: number;
  readonly alreadyListed: number;
  readonly problems: readonly ImportProblem[];
}

/** Adds every valid, new song from a pasted list. Re-importing the same list adds nothing. */
export async function importSongs(prisma: PrismaClient, actor: AuditActor, text: string, meta: Meta = {}): Promise<ImportResult> {
  assertCanManage(actor);
  const parsed = parseSongList(text);
  const problems = [...parsed.problems];
  const valid: { title: string; artist: string; year: number | null; matchKey: string }[] = [];
  const seen = new Set<string>();
  let duplicatesInPaste = 0;
  for (const row of parsed.songs) {
    const result = songInputSchema.safeParse({ title: row.title, artist: row.artist, year: row.year, note: "", isVisible: true });
    if (!result.success) {
      problems.push({ line: row.line, text: `${row.artist} - ${row.title}`.slice(0, 80), reason: result.error.issues[0]?.message ?? "Invalid line." });
      continue;
    }
    const matchKey = songMatchKey(result.data.artist, result.data.title);
    if (seen.has(matchKey)) {
      duplicatesInPaste += 1;
      continue;
    }
    seen.add(matchKey);
    valid.push({ title: result.data.title, artist: result.data.artist, year: result.data.year, matchKey });
  }
  const added = await prisma.$transaction(async (tx) => {
    // skipDuplicates makes concurrent or repeated imports safe.
    const created = await tx.song.createMany({ data: valid, skipDuplicates: true });
    if (created.count > 0) {
      await writeAudit(tx, { actor, action: "song.import", targetType: "song", targetId: "bulk", after: { added: created.count }, requestId: meta.requestId });
    }
    return created.count;
  });
  return { added, alreadyListed: valid.length - added + duplicatesInPaste, problems: problems.sort((a, b) => a.line - b.line) };
}

// ---------------------------------------------------------------- reads

export interface SongView {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly artist: string;
  readonly year: number | null;
  readonly decade: string | null;
  readonly note: string;
  readonly isVisible: boolean;
}

/** Sorted by artist (ignoring a leading "The"), then title. */
export async function listSongs(prisma: PrismaClient, options: { includeHidden: boolean }): Promise<SongView[]> {
  const rows = await prisma.song.findMany({
    where: options.includeHidden ? {} : { isVisible: true },
    select: { id: true, version: true, title: true, artist: true, year: true, note: true, isVisible: true, matchKey: true },
  });
  return rows
    .sort((a, b) => a.matchKey.localeCompare(b.matchKey))
    .map(({ matchKey: _key, ...row }) => ({ ...row, decade: decadeOf(row.year) }));
}
