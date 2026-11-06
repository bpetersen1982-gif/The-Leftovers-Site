import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { getModerationBoard, listPublicFanPosts } from "@/lib/fan/queries";
import { completeFanPhoto, decideFanPosts, deleteFanPost, releaseStalledFanPhotos, setFanPhotoAltText, submitFanPost } from "@/lib/fan/service";
import { containsLink } from "@/lib/fan/validation";
import { originalKey, parseStoredFiles, privateFileKey } from "@/lib/photos/files";
import { createTestStorage, resetStorage } from "../support/storage";
import { createTestClient, resetDatabase } from "../support/test-db";

const sentEmails: { to: string; subject: string }[] = [];
vi.mock("@/lib/mail/mailer", () => ({
  sendEmail: async (message: { to: string; subject: string }) => {
    sentEmails.push({ to: message.to, subject: message.subject });
  },
}));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "http://localhost:3001" }) }));
const { runPhotoJobs } = await import("@/lib/jobs/photo-jobs");

const prisma = createTestClient();
const storage = createTestStorage();
const deps = { prisma, storage };

async function makeUser(role: Role, name = role === "ADMIN" ? "Erik Admin" : "Jim Member") {
  const user = await prisma.user.create({ data: { id: randomUUID(), name, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role, email: user.email };
}

const POST = { displayName: "  Kelsey ", message: "Best\r\n\r\n\r\nnight ever!", email: " Kelsey@Example.TEST ", showId: "", photo: null };
let ipCounter = 0;
const nextIp = () => ({ ip: `203.0.113.${(ipCounter += 1)}` });

async function current(id: string) {
  return prisma.fanPost.findUniqueOrThrow({ where: { id } });
}
async function ref(id: string) {
  return { id, version: (await current(id)).version };
}

async function postWithPhoto(body: Buffer, altText = "Crowd singing along") {
  const submitted = await submitFanPost(deps, { ...POST, photo: { filename: "crowd.jpg", contentType: "image/jpeg", size: body.byteLength, altText, consent: true } }, nextIp());
  const upload = submitted.photoUpload;
  if (!upload) throw new Error("expected an upload");
  const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(body) });
  expect(put.status).toBe(200);
  return { postId: submitted.postId, token: upload.completionToken };
}

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: "#884422" } }).jpeg().toBuffer();
}

beforeEach(async () => {
  await resetDatabase(prisma);
  await resetStorage();
  sentEmails.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("posting", () => {
  it("saves a cleaned-up post as pending; nothing is public yet", async () => {
    const { postId, photoUpload } = await submitFanPost(deps, POST, nextIp());
    expect(photoUpload).toBeNull();
    expect(await current(postId)).toMatchObject({ status: "PENDING", displayName: "Kelsey", message: "Best\n\nnight ever!", email: "kelsey@example.test" });
    expect((await listPublicFanPosts(prisma, storage, 1)).posts).toEqual([]);
  });

  it("refuses links, overlong text, and photos without consent", async () => {
    for (const text of ["visit spam.com", "http://x.y", "www.example.org", "[url=x]"]) expect(containsLink(text)).toBe(true);
    expect(containsLink("Mr. Brightside was amazing. See you in Omaha!")).toBe(false);
    await expect(submitFanPost(deps, { ...POST, message: "cheap pills at pills.shop" }, nextIp())).rejects.toThrow(/links/);
    await expect(submitFanPost(deps, { ...POST, displayName: "visit www.spam.io" }, nextIp())).rejects.toThrow(/links/);
    await expect(submitFanPost(deps, { ...POST, message: "x".repeat(1001) }, nextIp())).rejects.toThrow(/1000/);
    await expect(
      submitFanPost(deps, { ...POST, photo: { filename: "a.jpg", contentType: "image/jpeg", size: 100, altText: "", consent: false as unknown as true } }, nextIp()),
    ).rejects.toThrow(/Confirm/);
    await expect(submitFanPost(deps, { ...POST, photo: { filename: "a.jpg", contentType: "image/jpeg", size: 11 * 1024 * 1024, altText: "", consent: true } }, nextIp())).rejects.toThrow(/10 MB/);
    expect(await prisma.fanPost.count()).toBe(0);
  });

  it("rate-limits by IP", async () => {
    const ip = { ip: "198.51.100.7" };
    for (let i = 0; i < 5; i += 1) await submitFanPost(deps, POST, ip);
    await expect(submitFanPost(deps, POST, ip)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(submitFanPost(deps, POST, nextIp())).resolves.toBeTruthy();
    // The raw IP is never stored.
    const keys = await prisma.rateLimit.findMany({ select: { key: true } });
    expect(keys.every((row) => !row.key.includes("198.51.100.7"))).toBe(true);
  });

  it("only links shows a fan could have been at", async () => {
    const admin = await makeUser("ADMIN");
    const today = new Date().toISOString().slice(0, 10);
    const base = { startTime: null, endTime: null, venueName: "Zoo Bar", city: "Lincoln", state: "NE", createdById: admin.id };
    const recent = await prisma.show.create({ data: { ...base, slug: "recent", date: new Date(`${today}T00:00:00Z`), isPublic: true } });
    const privateShow = await prisma.show.create({ data: { ...base, slug: "private", date: new Date(`${today}T00:00:00Z`), isPublic: false } });
    const ok = await submitFanPost(deps, { ...POST, showId: recent.id }, nextIp());
    const hidden = await submitFanPost(deps, { ...POST, showId: privateShow.id }, nextIp());
    expect((await current(ok.postId)).showId).toBe(recent.id);
    expect((await current(hidden.postId)).showId).toBeNull();
  });
});

describe("fan photos", () => {
  it("processes the photo once, keeps it private until approval, then publishes it", async () => {
    const member = await makeUser("MEMBER");
    const { postId, token } = await postWithPhoto(await jpeg());
    expect((await current(postId)).status).toBe("AWAITING_PHOTO");
    expect(await completeFanPhoto(deps, postId, token)).toEqual({ photo: "added" });
    await expect(completeFanPhoto(deps, postId, token)).rejects.toMatchObject({ code: "UPLOAD_INVALID" });
    const post = await current(postId);
    expect(post.status).toBe("PENDING");
    expect(post.photoConsentAt).not.toBeNull();
    expect(await storage.headPrivate(originalKey(postId))).toBeNull();
    const files = parseStoredFiles(post.photoVariants);
    expect(files.map((file) => file.file)).toEqual(["w480.webp", "w960.webp", "w1200.webp", "full.jpg"]);

    expect(await decideFanPosts(deps, member, [await ref(postId)], "APPROVED", "")).toEqual([{ id: postId, outcome: "done" }]);
    const [shown] = (await listPublicFanPosts(prisma, storage, 1)).posts;
    expect(shown?.photo?.altText).toBe("Crowd singing along");
    expect((await fetch(shown?.photo?.image.src ?? "")).status).toBe(200);
    expect(JSON.stringify(shown)).not.toContain("kelsey@example.test");

    // Rejecting later takes the public copy down.
    const publicUrl = shown?.photo?.image.src ?? "";
    await decideFanPosts(deps, member, [await ref(postId)], "REJECTED", "");
    expect((await fetch(publicUrl)).ok).toBe(false);
    expect(await storage.headPrivate(privateFileKey(postId, "w480.webp"))).not.toBeNull();
  });

  it("keeps the message when the photo is unusable or never arrives", async () => {
    const bad = await postWithPhoto(Buffer.from("<html>not an image</html>"));
    expect(await completeFanPhoto(deps, bad.postId, bad.token)).toMatchObject({ photo: "rejected" });
    expect(await current(bad.postId)).toMatchObject({ status: "PENDING", photoFailureReason: expect.stringMatching(/isn't a JPEG/) });

    const stalled = await submitFanPost(deps, { ...POST, photo: { filename: "a.jpg", contentType: "image/jpeg", size: 100, altText: "", consent: true } }, nextIp());
    expect(await releaseStalledFanPhotos(deps, new Date(Date.now() + 40 * 60_000))).toBe(1);
    expect(await current(stalled.postId)).toMatchObject({ status: "PENDING", photoFailureReason: "The photo didn't finish uploading." });
  });

  it("needs a photo description before approval", async () => {
    const admin = await makeUser("ADMIN");
    const { postId, token } = await postWithPhoto(await jpeg(), "");
    await completeFanPhoto(deps, postId, token);
    expect(await decideFanPosts(deps, admin, [await ref(postId)], "APPROVED", "")).toEqual([{ id: postId, outcome: "needsAltText" }]);
    await setFanPhotoAltText(deps, admin, await ref(postId), "Fans up front");
    expect((await decideFanPosts(deps, admin, [await ref(postId)], "APPROVED", ""))[0]?.outcome).toBe("done");
  });
});

describe("moderation rules", () => {
  it("Members decide and can change each other's calls; an Admin's call is final; Admin changes are overrides", async () => {
    const jim = await makeUser("MEMBER", "Jim Member");
    const jake = await makeUser("MEMBER", "Jake Member");
    const erik = await makeUser("ADMIN");
    const { postId } = await submitFanPost(deps, POST, nextIp());

    await decideFanPosts(deps, jim, [await ref(postId)], "REJECTED", "Too short");
    await decideFanPosts(deps, jake, [await ref(postId)], "APPROVED", "");
    expect(await current(postId)).toMatchObject({ status: "APPROVED", decidedByRole: "MEMBER", decidedById: jake.id });

    const board = await getModerationBoard(prisma, storage, erik);
    expect(board.recent.map((post) => [post.id, post.isOverride, post.canChange])).toEqual([[postId, true, true]]);
    expect(board.memberDecisionCount).toBe(1);

    await decideFanPosts(deps, erik, [await ref(postId)], "REJECTED", "Mentions a private party");
    expect(await current(postId)).toMatchObject({ status: "REJECTED", decidedByRole: "ADMIN", decisionReason: "Mentions a private party" });
    expect(await decideFanPosts(deps, jim, [await ref(postId)], "APPROVED", "")).toEqual([{ id: postId, outcome: "locked" }]);
    expect((await getModerationBoard(prisma, storage, jim)).recent[0]?.canChange).toBe(false);

    const decisions = await prisma.moderationDecision.findMany({ where: { fanPostId: postId }, orderBy: { createdAt: "asc" } });
    expect(decisions.map((decision) => [decision.verdict, decision.actorRole])).toEqual([
      ["REJECTED", "MEMBER"],
      ["APPROVED", "MEMBER"],
      ["REJECTED", "ADMIN"],
    ]);
    expect(decisions[2]?.overridesDecisionId).toBe(decisions[1]?.id);
    expect(await prisma.auditLog.count({ where: { action: "fan.override", targetId: postId } })).toBe(1);
  });

  it("bulk decisions report per item; simultaneous decisions can't both win", async () => {
    const jim = await makeUser("MEMBER", "Jim Member");
    const erik = await makeUser("ADMIN");
    const a = await submitFanPost(deps, POST, nextIp());
    const b = await submitFanPost(deps, POST, nextIp());
    const staleA = await ref(a.postId);
    const results = await Promise.all([
      decideFanPosts(deps, jim, [staleA], "APPROVED", ""),
      decideFanPosts(deps, erik, [staleA, await ref(b.postId)], "REJECTED", ""),
    ]);
    const outcomesForA = [results[0]?.[0]?.outcome, results[1]?.[0]?.outcome].sort();
    expect(outcomesForA).toEqual(["conflict", "done"]);
    expect(results[1]?.[1]).toEqual({ id: b.postId, outcome: "done" });
    expect(await prisma.moderationDecision.count({ where: { fanPostId: a.postId } })).toBe(1);
  });

  it("only Admins delete, and deleting removes the message, email, and files", async () => {
    const jim = await makeUser("MEMBER");
    const erik = await makeUser("ADMIN");
    const { postId, token } = await postWithPhoto(await jpeg());
    await completeFanPhoto(deps, postId, token);
    await expect(deleteFanPost(deps, jim, await ref(postId))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteFanPost(deps, erik, await ref(postId));
    expect(await prisma.fanPost.findUnique({ where: { id: postId } })).toBeNull();
    expect(await storage.headPrivate(privateFileKey(postId, "w480.webp"))).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "fan.delete" } });
    expect(JSON.stringify(log)).not.toContain("kelsey");
  });
});

describe("daily digest", () => {
  it("Members hear about fan posts; Admins hear about fan posts and photos", async () => {
    const member = await makeUser("MEMBER");
    const admin = await makeUser("ADMIN");
    await submitFanPost(deps, POST, nextIp());
    await submitFanPost(deps, POST, nextIp());
    const tenAm = new Date("2026-11-07T16:00:00Z");
    expect((await runPhotoJobs(prisma, storage, tenAm)).digestsSent).toBe(2);
    expect(sentEmails.sort((x, y) => x.to.localeCompare(y.to))).toEqual(
      [
        { to: member.email, subject: "2 fan posts to review: The Leftovers" },
        { to: admin.email, subject: "2 fan posts to review: The Leftovers" },
      ].sort((x, y) => x.to.localeCompare(y.to)),
    );
  });
});
