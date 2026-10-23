import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PAGES } from "@/lib/content/pages";
import {
  ContentServiceError,
  createBandMember,
  deleteBandMember,
  getPage,
  getSiteSettings,
  listBandMembers,
  moveBandMember,
  saveSiteSettings,
  savePage,
  updateBandMember,
} from "@/lib/content/service";
import { DEFAULT_SETTINGS } from "@/lib/content/settings";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
let admin: { id: string; role: "ADMIN" };

async function expectCode(promise: Promise<unknown>, code: ContentServiceError["code"]) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof ContentServiceError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase(prisma);
  const user = await prisma.user.create({ data: { id: randomUUID(), email: "a@example.test", name: "Admin", role: "ADMIN" } });
  admin = { id: user.id, role: "ADMIN" };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("pages", () => {
  it("serves default copy until first save, then the saved content", async () => {
    expect(await getPage(prisma, "about")).toMatchObject({ version: 0, blocks: PAGES.about.defaultContent });
    const version = await savePage(prisma, { actor: admin, slug: "about", blocks: [{ type: "paragraph", text: "New" }], version: 0 });
    expect(version).toBe(1);
    expect(await getPage(prisma, "about")).toMatchObject({ version: 1, blocks: [{ type: "paragraph", text: "New" }] });
  });

  it("rejects a stale save instead of overwriting someone else's edit", async () => {
    await savePage(prisma, { actor: admin, slug: "about", blocks: [{ type: "paragraph", text: "First" }], version: 0 });
    await savePage(prisma, { actor: admin, slug: "about", blocks: [{ type: "paragraph", text: "Second" }], version: 1 });
    await expectCode(savePage(prisma, { actor: admin, slug: "about", blocks: [{ type: "paragraph", text: "Stale" }], version: 1 }), "CONFLICT");
    await expectCode(savePage(prisma, { actor: admin, slug: "about", blocks: [], version: 0 }), "CONFLICT");
    expect((await getPage(prisma, "about")).blocks).toEqual([{ type: "paragraph", text: "Second" }]);
  });

  it("lets exactly one of two simultaneous saves of the same version win", async () => {
    await savePage(prisma, { actor: admin, slug: "home", blocks: [{ type: "paragraph", text: "v1" }], version: 0 });
    const results = await Promise.allSettled([
      savePage(prisma, { actor: admin, slug: "home", blocks: [{ type: "paragraph", text: "A" }], version: 1 }),
      savePage(prisma, { actor: admin, slug: "home", blocks: [{ type: "paragraph", text: "B" }], version: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("audits before and after", async () => {
    await savePage(prisma, { actor: admin, slug: "about", blocks: [{ type: "paragraph", text: "New" }], version: 0 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "page.update" } });
    expect(audit).toMatchObject({ actorId: admin.id, targetId: "about", after: { version: 1 } });
  });
});

describe("band members", () => {
  const input = { name: "Mike Douglas", instrument: "Drums", bio: [], isVisible: true };

  it("creates at the end, hides hidden members from the public list", async () => {
    const first = await createBandMember(prisma, { actor: admin, member: input });
    await createBandMember(prisma, { actor: admin, member: { ...input, name: "Hidden", isVisible: false } });
    expect((await listBandMembers(prisma, { includeHidden: true })).map((m) => m.name)).toEqual(["Mike Douglas", "Hidden"]);
    expect((await listBandMembers(prisma, { includeHidden: false })).map((m) => m.id)).toEqual([first]);
  });

  it("updates with version checking", async () => {
    const id = await createBandMember(prisma, { actor: admin, member: input });
    await updateBandMember(prisma, { actor: admin, id, version: 1, member: { ...input, instrument: "Drums & vocals" } });
    await expectCode(updateBandMember(prisma, { actor: admin, id, version: 1, member: input }), "CONFLICT");
    expect((await listBandMembers(prisma, { includeHidden: true }))[0]?.instrument).toBe("Drums & vocals");
  });

  it("reorders by swapping neighbors and ignores moves past the ends", async () => {
    const a = await createBandMember(prisma, { actor: admin, member: { ...input, name: "A" } });
    await createBandMember(prisma, { actor: admin, member: { ...input, name: "B" } });
    const c = await createBandMember(prisma, { actor: admin, member: { ...input, name: "C" } });
    await moveBandMember(prisma, { actor: admin, id: c, direction: "up" });
    await moveBandMember(prisma, { actor: admin, id: a, direction: "up" });
    expect((await listBandMembers(prisma, { includeHidden: true })).map((m) => m.name)).toEqual(["A", "C", "B"]);
  });

  it("deletes, audits the removed data, and reports missing members", async () => {
    const id = await createBandMember(prisma, { actor: admin, member: input });
    await deleteBandMember(prisma, { actor: admin, id });
    expect(await listBandMembers(prisma, { includeHidden: true })).toEqual([]);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "member.delete" } })).before).toMatchObject({ name: "Mike Douglas" });
    await expectCode(deleteBandMember(prisma, { actor: admin, id }), "NOT_FOUND");
  });
});

describe("site settings", () => {
  it("falls back to defaults, saves, and rejects stale versions", async () => {
    expect(await getSiteSettings(prisma)).toEqual(DEFAULT_SETTINGS);
    const values = {
      bookingEmail: "booking@example.test",
      generalEmail: "hi@example.test",
      copyrightEmail: "c@example.test",
      socialLinks: [{ platform: "instagram" as const, url: "https://instagram.com/leftovers" }],
    };
    await saveSiteSettings(prisma, { actor: admin, version: 1, values });
    const saved = await getSiteSettings(prisma);
    expect(saved).toMatchObject({ ...values, version: 2 });
    await expectCode(saveSiteSettings(prisma, { actor: admin, version: 1, values }), "CONFLICT");
  });
});
