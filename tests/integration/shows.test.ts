import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { EventType, Role } from "@/generated/prisma/enums";
import { createAlbum, updateAlbum } from "@/lib/photos/albums";
import { getPublicShow, listPublicShows, musicEventJsonLd, showIcs, showOptions } from "@/lib/shows/queries";
import { createShow, createShowFromBooking, deleteShow, updateShow, zonedIso, zonedToUtc } from "@/lib/shows/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();

async function makeUser(role: Role) {
  const user = await prisma.user.create({ data: { id: randomUUID(), name: role, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role };
}

const SHOW = {
  date: "2026-11-14",
  startTime: "21:00",
  endTime: "00:30",
  venueName: "Zoo Bar",
  street: "136 N 14th St",
  city: "Lincoln",
  state: "ne",
  ticketUrl: "",
  priceText: "$10 at the door",
  description: "Two sets of 90s rock; then more.",
  status: "SCHEDULED" as const,
  isPublic: true,
};

async function confirmedBooking(eventType: EventType) {
  return prisma.bookingRequest.create({
    data: {
      reference: `LO-${randomUUID().slice(0, 6).toUpperCase()}`,
      kind: "WIZARD",
      status: "CONFIRMED",
      eventDate: new Date("2026-12-05T00:00:00Z"),
      startTime: "19:00",
      endTime: "23:00",
      eventType,
      contactName: "Pat Prospect",
      email: "pat@example.test",
      phone: "(402) 555-0123",
      organization: eventType === "WEDDING" ? "" : "Duffy's Tavern",
      street: "1412 O St",
      city: "Lincoln",
      state: "NE",
      accessTokenHash: randomUUID(),
    },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("time helpers", () => {
  it("converts Lincoln local time to UTC across daylight saving", () => {
    expect(zonedToUtc("2026-07-04", "21:00").toISOString()).toBe("2026-07-05T02:00:00.000Z"); // CDT, -5
    expect(zonedToUtc("2026-12-31", "21:00").toISOString()).toBe("2027-01-01T03:00:00.000Z"); // CST, -6
    expect(zonedIso("2026-11-14", "21:00")).toBe("2026-11-14T21:00:00-06:00");
    expect(zonedIso("2026-10-17", "20:30")).toBe("2026-10-17T20:30:00-05:00");
  });
});

describe("shows", () => {
  it("only Admins manage shows; slugs are stable and unique; validation is strict", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await expect(createShow(prisma, member, SHOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await createShow(prisma, admin, SHOW);
    const second = await createShow(prisma, admin, SHOW);
    const slugs = (await prisma.show.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true, state: true } })).map((row) => [row.slug, row.state]);
    expect(slugs).toEqual([
      ["2026-11-14-zoo-bar", "NE"],
      ["2026-11-14-zoo-bar-2", "NE"],
    ]);
    await expect(createShow(prisma, admin, { ...SHOW, ticketUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(createShow(prisma, admin, { ...SHOW, startTime: "", endTime: "23:00" })).rejects.toThrow(/start time/);
    await expect(createShow(prisma, admin, { ...SHOW, state: "Nebraska" })).rejects.toThrow(/2-letter/);

    await updateShow(prisma, admin, { id: first, version: 1 }, { ...SHOW, venueName: "Zoo Bar (patio)", status: "SOLD_OUT" });
    await expect(updateShow(prisma, admin, { id: first, version: 1 }, SHOW)).rejects.toMatchObject({ code: "CONFLICT" });
    // Renaming keeps the original link working.
    expect((await prisma.show.findUniqueOrThrow({ where: { id: first } })).slug).toBe("2026-11-14-zoo-bar");
    await deleteShow(prisma, admin, { id: second, version: 1 });
    expect(await prisma.show.count()).toBe(1);
  });

  it("lists only public shows, splitting upcoming from past", async () => {
    const admin = await makeUser("ADMIN");
    await createShow(prisma, admin, SHOW);
    await createShow(prisma, admin, { ...SHOW, date: "2026-12-05", venueName: "Private wedding", isPublic: false });
    await createShow(prisma, admin, { ...SHOW, date: "2026-09-01", venueName: "Bourbon Theatre" });
    const { upcoming, past } = await listPublicShows(prisma, "2026-11-06");
    expect(upcoming.map((show) => show.venueName)).toEqual(["Zoo Bar"]);
    expect(past.map((show) => show.venueName)).toEqual(["Bourbon Theatre"]);
    expect(await getPublicShow(prisma, null, "2026-12-05-private-wedding")).toBeNull();
    expect((await showOptions(prisma, "2026-11-06")).map((option) => option.label)).toContain("2026-12-05 · Private wedding, Lincoln");
  });

  it("turns a confirmed booking into a show once; weddings start private without the client's address", async () => {
    const admin = await makeUser("ADMIN");
    const bar = await confirmedBooking("BAR_CLUB");
    const showId = await createShowFromBooking(prisma, admin, bar.id);
    expect(await createShowFromBooking(prisma, admin, bar.id)).toBe(showId);
    expect(await prisma.show.findUniqueOrThrow({ where: { id: showId } })).toMatchObject({ venueName: "Duffy's Tavern", isPublic: true, street: "1412 O St", startTime: "19:00" });

    const wedding = await confirmedBooking("WEDDING");
    const weddingShow = await prisma.show.findUniqueOrThrow({ where: { id: await createShowFromBooking(prisma, admin, wedding.id) } });
    expect(weddingShow).toMatchObject({ venueName: "Private event", isPublic: false, street: "" });

    const pending = await prisma.bookingRequest.update({ where: { id: (await confirmedBooking("BAR_CLUB")).id }, data: { status: "ACCEPTED" } });
    await expect(createShowFromBooking(prisma, admin, pending.id)).rejects.toMatchObject({ code: "BOOKING_NOT_CONFIRMED" });
  });

  it("links albums to shows and produces structured data and a calendar file", async () => {
    const admin = await makeUser("ADMIN");
    const showId = await createShow(prisma, admin, { ...SHOW, ticketUrl: "https://tickets.example/zoo" });
    const album = await createAlbum(prisma, admin, { title: "Zoo Bar", description: "", eventDate: "", isPublic: true, showId });
    expect((await prisma.album.findUniqueOrThrow({ where: { id: album.id } })).showId).toBe(showId);
    await expect(updateAlbum(prisma, admin, { id: album.id, version: 1 }, { title: "Zoo Bar", description: "", eventDate: "", isPublic: true, showId: randomUUID() })).rejects.toMatchObject({
      code: "SHOW_NOT_FOUND",
    });

    const show = await getPublicShow(prisma, null, "2026-11-14-zoo-bar");
    if (!show) throw new Error("show missing");
    const ld = musicEventJsonLd(show);
    expect(ld).toMatchObject({
      "@type": "MusicEvent",
      startDate: "2026-11-14T21:00:00-06:00",
      // 00:30 is after midnight: the next day.
      endDate: "2026-11-15T06:30:00.000Z",
      offers: { url: "https://tickets.example/zoo", availability: "https://schema.org/InStock" },
      location: { name: "Zoo Bar", address: { addressLocality: "Lincoln", addressRegion: "NE" } },
    });

    const ics = showIcs(show, new Date("2026-11-06T12:00:00Z"));
    expect(ics).toContain("DTSTART:20261115T030000Z\r\n");
    expect(ics).toContain("DTEND:20261115T063000Z\r\n");
    expect(ics).toContain("SUMMARY:The Leftovers at Zoo Bar\r\n");
    // Commas and semicolons escaped per RFC 5545; long lines folded at 75 octets.
    expect(ics).toContain("LOCATION:Zoo Bar\\, 136 N 14th St\\, Lincoln\\, NE");
    expect(ics).toContain("90s rock\\; then more.");
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });
});
