import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { createSong, decadeOf, deleteSong, importSongs, listSongs, parseSongList, songMatchKey, updateSong } from "@/lib/songs/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();

async function makeUser(role: Role) {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: role, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role };
}

const SONG = { title: "Mr. Brightside", artist: "The Killers", year: "2003", note: "", isVisible: true };

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("song helpers", () => {
  it("matches the same song however it's typed, and finds decades", () => {
    expect(songMatchKey("The Killers", "Mr. Brightside")).toBe(songMatchKey("killers", "Mr Brightside"));
    expect(songMatchKey("Guns N' Roses", "Sweet Child O' Mine")).toBe("guns n roses|sweet child o mine");
    expect(decadeOf(1997)).toBe("1990s");
    expect(decadeOf(null)).toBeNull();
  });

  it("parses pasted lines and spreadsheet rows", () => {
    const { songs, problems } = parseSongList("Artist\tTitle\tYear\nFoo Fighters\tEverlong\t1997\n\nThird Eye Blind - Semi-Charmed Life (1997)\nBlink-182 – All the Small Things\njust some words\n");
    expect(songs.map((song) => [song.artist, song.title, song.year])).toEqual([
      ["Foo Fighters", "Everlong", "1997"],
      ["Third Eye Blind", "Semi-Charmed Life", "1997"],
      ["Blink-182", "All the Small Things", ""],
    ]);
    expect(problems.map((problem) => problem.line)).toEqual([6]);
  });
});

describe("song list", () => {
  it("only Admins edit; duplicates and stale edits are refused", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await expect(createSong(prisma, member, SONG)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const id = await createSong(prisma, admin, SONG);
    await expect(createSong(prisma, admin, { ...SONG, artist: "killers", title: "mr brightside" })).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(createSong(prisma, admin, { ...SONG, year: "97" })).rejects.toThrow(/4-digit/);

    await updateSong(prisma, admin, { id, version: 1 }, { ...SONG, note: "  Always   closes the night " });
    await expect(updateSong(prisma, admin, { id, version: 1 }, SONG)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await listSongs(prisma, { includeHidden: false }))[0]).toMatchObject({ note: "Always closes the night", decade: "2000s" });

    await updateSong(prisma, admin, { id, version: 2 }, { ...SONG, isVisible: false });
    expect(await listSongs(prisma, { includeHidden: false })).toEqual([]);
    expect(await listSongs(prisma, { includeHidden: true })).toHaveLength(1);
    await deleteSong(prisma, admin, { id, version: 3 });
    expect(await prisma.song.count()).toBe(0);
  });

  it("imports a pasted list, skipping songs already listed, and sorts by artist ignoring 'The'", async () => {
    const admin = await makeUser("ADMIN");
    await createSong(prisma, admin, SONG);
    const paste = "Third Eye Blind - Semi-Charmed Life (1997)\nThe Killers - Mr. Brightside (2003)\nBlink-182 - All the Small Things (1999)\nblink-182 - all the small things\nCake - The Distance (3000)\n";
    const result = await importSongs(prisma, admin, paste);
    expect(result).toMatchObject({ added: 2, alreadyListed: 2 });
    expect(result.problems).toEqual([{ line: 5, text: "Cake - The Distance", reason: "Use a 4-digit release year, or leave it blank." }]);
    expect((await importSongs(prisma, admin, paste)).added).toBe(0);
    expect((await listSongs(prisma, { includeHidden: false })).map((song) => song.artist)).toEqual(["Blink-182", "The Killers", "Third Eye Blind"]);
  });
});
