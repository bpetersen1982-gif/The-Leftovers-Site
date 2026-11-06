import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import { runVideoJobs } from "@/lib/jobs/video-jobs";
import { listTakedownNotices } from "@/lib/photos/queries";
import { getBandVideoBoard, getPublicVideo, listPublicVideos } from "@/lib/video/queries";
import {
  applyStreamWebhook,
  completeVideoUpload,
  createVideoUpload,
  deleteVideo,
  embedOriginsFor,
  publishVideo,
  requestVideoRemoval,
  restoreVideo,
  setVideoCaptions,
  takedownVideo,
  updateVideoDetails,
} from "@/lib/video/service";
import { signStreamWebhook, verifyStreamWebhook } from "@/lib/video/webhook";
import { FAKE_ORIGIN, FakeStream } from "../support/fake-stream";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
let stream: FakeStream;
let deps: { prisma: typeof prisma; stream: FakeStream; embedOrigins: string[] };

async function makeUser(role: Role, name = role === "ADMIN" ? "Erik Admin" : "Jim Member") {
  const user = await prisma.user.create({ data: { id: randomUUID(), name, email: `${randomUUID()}@example.test`, role, emailVerified: true } });
  return { id: user.id, role };
}

async function current(id: string) {
  return prisma.video.findUniqueOrThrow({ where: { id } });
}

async function ref(id: string) {
  return { id, version: (await current(id)).version };
}

/** Upload + Stream finishes + title, ready to publish. */
async function readyVideo(admin: { id: string; role: Role }, title = "Sweet Child O' Mine (encore)") {
  const { videoId } = await createVideoUpload(deps, admin, { filename: "IMG_0042.MOV", size: 50_000_000 });
  const video = await current(videoId);
  stream.finish(video.streamUid);
  expect(await completeVideoUpload(deps, admin, videoId)).toBe("READY");
  await updateVideoDetails(deps, admin, { ...(await ref(videoId)), title, description: "Zoo Bar", posterSeconds: 12 });
  return videoId;
}

const NOTICE = { senderName: "Label Co", senderEmail: "legal@label.example", workClaimed: "Sound recording", receivedOn: "2026-10-30", notes: "" };

beforeEach(async () => {
  await resetDatabase(prisma);
  stream = new FakeStream();
  deps = { prisma, stream, embedOrigins: embedOriginsFor("https://theleftoversband.com") };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("webhook signatures", () => {
  const secret = "whsec_test_secret_value_123";
  const body = JSON.stringify({ uid: "a".repeat(32) });
  const now = new Date("2026-11-05T12:00:00Z");
  const time = Math.floor(now.getTime() / 1000);

  it("accepts a correct, fresh signature and rejects everything else", () => {
    const header = `time=${time},sig1=${signStreamWebhook(secret, time, body)}`;
    expect(verifyStreamWebhook({ secret, header, rawBody: body, now })).toBe(true);
    expect(verifyStreamWebhook({ secret, header, rawBody: `${body} `, now })).toBe(false);
    expect(verifyStreamWebhook({ secret: "other-secret-value-xyz", header, rawBody: body, now })).toBe(false);
    expect(verifyStreamWebhook({ secret, header, rawBody: body, now: new Date(now.getTime() + 10 * 60_000) })).toBe(false);
    expect(verifyStreamWebhook({ secret, header: null, rawBody: body, now })).toBe(false);
    expect(verifyStreamWebhook({ secret, header: "time=abc,sig1=zz", rawBody: body, now })).toBe(false);
  });
});

describe("video upload and processing", () => {
  it("only Admins upload; validates file type and size", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    await expect(createVideoUpload(deps, member, { filename: "a.mp4", size: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createVideoUpload(deps, admin, { filename: "a.exe", size: 100 })).rejects.toThrow(/video file/);
    await expect(createVideoUpload(deps, admin, { filename: "a.mp4", size: 6 * 1024 ** 3 })).rejects.toThrow(/5 GB/);
    const { videoId, uploadUrl } = await createVideoUpload(deps, admin, { filename: "C:\\fakepath\\set.mp4", size: 100 });
    const video = await current(videoId);
    expect(video).toMatchObject({ status: "UPLOADING", originalFilename: "set.mp4", streamPublic: false });
    expect(uploadUrl).toContain(video.streamUid);
    expect(stream.videos.get(video.streamUid)?.requireSignedURLs).toBe(true);
  });

  it("moves through processing to ready from the webhook, idempotently", async () => {
    const admin = await makeUser("ADMIN");
    const { videoId } = await createVideoUpload(deps, admin, { filename: "a.mp4", size: 100 });
    const { streamUid } = await current(videoId);
    stream.finish(streamUid, "inprogress");
    expect(await completeVideoUpload(deps, admin, videoId)).toBe("PROCESSING");
    stream.finish(streamUid);
    expect(await applyStreamWebhook(deps, stream.report(streamUid))).toBe("ok");
    expect(await current(videoId)).toMatchObject({ status: "READY", durationSeconds: 95.4, width: 1920, playbackOrigin: FAKE_ORIGIN });
    const version = (await current(videoId)).version;
    // A repeated webhook changes nothing once a person can act on it.
    await applyStreamWebhook(deps, stream.report(streamUid));
    expect((await current(videoId)).version).toBe(version);
    expect(await applyStreamWebhook(deps, { ...stream.report(streamUid), uid: "b".repeat(32) })).toBe("ignored");
  });

  it("records failures with a readable reason and deletes the Stream copy", async () => {
    const admin = await makeUser("ADMIN");
    const { videoId } = await createVideoUpload(deps, admin, { filename: "a.mp4", size: 100 });
    const { streamUid } = await current(videoId);
    stream.finish(streamUid, "error", "ERR_NON_VIDEO");
    await applyStreamWebhook(deps, stream.report(streamUid));
    expect(await current(videoId)).toMatchObject({ status: "FAILED", failureReason: "That file isn't a video Stream can read." });
    expect(stream.videos.has(streamUid)).toBe(false);
  });
});

describe("publishing and removing", () => {
  it("publishes with a title, makes Stream public for our domains only, and lists it", async () => {
    const admin = await makeUser("ADMIN");
    const { videoId } = await createVideoUpload(deps, admin, { filename: "a.mp4", size: 100 });
    stream.finish((await current(videoId)).streamUid);
    await completeVideoUpload(deps, admin, videoId);
    await expect(publishVideo(deps, admin, await ref(videoId))).rejects.toMatchObject({ code: "TITLE_REQUIRED" });
    await expect(updateVideoDetails(deps, admin, { ...(await ref(videoId)), title: "x", description: "", posterSeconds: 500 })).rejects.toMatchObject({
      code: "POSTER_PAST_END",
    });
    await updateVideoDetails(deps, admin, { ...(await ref(videoId)), title: "Encore", description: "", posterSeconds: 12 });
    await publishVideo(deps, admin, await ref(videoId));

    const video = await current(videoId);
    expect(video).toMatchObject({ status: "PUBLISHED", streamPublic: true });
    expect(stream.videos.get(video.streamUid)).toMatchObject({ requireSignedURLs: false, allowedOrigins: ["theleftoversband.com", "www.theleftoversband.com"] });
    const listed = await listPublicVideos(prisma, 1);
    expect(listed.videos.map((item) => [item.title, item.duration])).toEqual([["Encore", "1:35"]]);
    expect(listed.videos[0]?.playback.posterUrl).toBe(`${FAKE_ORIGIN}/${video.streamUid}/thumbnails/thumbnail.jpg?time=12s&height=720`);
    expect(listed.videos[0]?.playback.iframeUrl).toMatch(new RegExp(`^${FAKE_ORIGIN}/${video.streamUid}/iframe\\?autoplay=true`));
  });

  it("doesn't publish if Stream is down, and leaves nothing public", async () => {
    const admin = await makeUser("ADMIN");
    const videoId = await readyVideo(admin);
    stream.down = true;
    await expect(publishVideo(deps, admin, await ref(videoId))).rejects.toMatchObject({ code: "STREAM_UNAVAILABLE" });
    expect((await current(videoId)).status).toBe("READY");
    expect((await listPublicVideos(prisma, 1)).total).toBe(0);
  });

  it("lets a Member take a video down at once; only Admins restore or delete", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    const videoId = await readyVideo(admin);
    await publishVideo(deps, admin, await ref(videoId));
    const { streamUid } = await current(videoId);

    expect(await requestVideoRemoval(deps, member, await ref(videoId), "Wrong song")).toEqual({ lockedOnStream: true });
    expect(await current(videoId)).toMatchObject({ status: "DELETION_REQUESTED", streamPublic: false, removalReason: "Wrong song" });
    expect(stream.videos.get(streamUid)?.requireSignedURLs).toBe(true);
    expect(await getPublicVideo(prisma, videoId)).toBeNull();

    await expect(restoreVideo(deps, member, await ref(videoId))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteVideo(deps, member, await ref(videoId))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await restoreVideo(deps, admin, await ref(videoId));
    expect((await current(videoId)).status).toBe("PUBLISHED");
    expect(stream.videos.get(streamUid)?.requireSignedURLs).toBe(false);
  });

  it("records a takedown notice; deleting removes it from Stream but keeps the notice", async () => {
    const admin = await makeUser("ADMIN");
    const member = await makeUser("MEMBER");
    const videoId = await readyVideo(admin);
    await publishVideo(deps, admin, await ref(videoId));
    const { streamUid } = await current(videoId);
    await expect(takedownVideo(deps, member, await ref(videoId), NOTICE)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await takedownVideo(deps, admin, await ref(videoId), NOTICE);
    expect((await current(videoId)).status).toBe("TAKEN_DOWN");
    expect(stream.videos.get(streamUid)?.requireSignedURLs).toBe(true);

    const adminBoard = await getBandVideoBoard(prisma, stream, admin);
    expect(adminBoard.takenDown.map((video) => video.notice?.senderName)).toEqual(["Label Co"]);
    // Private preview for the band uses a signed token, not the id.
    expect(adminBoard.takenDown[0]?.playback?.iframeUrl).toContain(`/token-${streamUid}`);
    expect((await getBandVideoBoard(prisma, stream, member)).takenDown).toEqual([]);

    expect(await deleteVideo(deps, admin, await ref(videoId))).toEqual({ deletedOnStream: true });
    expect(await prisma.video.findUnique({ where: { id: videoId } })).toBeNull();
    expect(stream.videos.has(streamUid)).toBe(false);
    expect((await listTakedownNotices(prisma))[0]).toMatchObject({ mediaKind: "VIDEO", mediaLabel: "Sweet Child O' Mine (encore)", resolution: "DELETED" });
    expect((await prisma.auditLog.findMany({ where: { targetId: videoId }, orderBy: { createdAt: "asc" } })).map((row) => row.action)).toEqual([
      "video.upload",
      "video.update",
      "video.publish",
      "media.takedown",
      "video.delete",
    ]);
  });

  it("is race-safe: two publishes of the same version, one wins", async () => {
    const erik = await makeUser("ADMIN");
    const brandon = await makeUser("ADMIN", "Brandon Admin");
    const videoId = await readyVideo(erik);
    const stale = await ref(videoId);
    const results = await Promise.allSettled([publishVideo(deps, erik, stale), publishVideo(deps, brandon, stale)]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await prisma.auditLog.count({ where: { action: "video.publish" } })).toBe(1);
    expect(await current(videoId)).toMatchObject({ status: "PUBLISHED", streamPublic: true });
  });
});

describe("captions", () => {
  it("accepts WebVTT and rejects other files", async () => {
    const admin = await makeUser("ADMIN");
    const videoId = await readyVideo(admin);
    const vtt = "\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:04.000\r\nThanks for coming out!\r\n";
    await expect(setVideoCaptions(deps, admin, await ref(videoId), "1\n00:00:01,000 --> 00:00:04,000\nSRT not VTT")).rejects.toThrow(/WebVTT/);
    await setVideoCaptions(deps, admin, await ref(videoId), vtt);
    const { streamUid, captionsLanguage } = await current(videoId);
    expect(captionsLanguage).toBe("en");
    expect(stream.videos.get(streamUid)?.captions.get("en")).toMatch(/^WEBVTT\n/);
    await setVideoCaptions(deps, admin, await ref(videoId), null);
    expect((await current(videoId)).captionsLanguage).toBeNull();
  });
});

describe("video jobs", () => {
  it("polls missed webhooks, expires dead uploads, and re-locks drifted videos", async () => {
    const admin = await makeUser("ADMIN");
    const now = new Date(Date.now() + 7 * 3_600_000);
    const missed = await createVideoUpload(deps, admin, { filename: "a.mp4", size: 100 });
    stream.finish((await current(missed.videoId)).streamUid);
    const dead = await createVideoUpload(deps, admin, { filename: "b.mp4", size: 100 });
    const deadUid = (await current(dead.videoId)).streamUid;
    // A video that's public on Stream but was taken off the site while Stream was down.
    const drifted = await readyVideo(admin, "Drifted");
    await publishVideo(deps, admin, await ref(drifted));
    stream.down = true;
    expect((await requestVideoRemoval(deps, admin, await ref(drifted), "")).lockedOnStream).toBe(false);
    stream.down = false;
    const driftedUid = (await current(drifted)).streamUid;
    expect(stream.videos.get(driftedUid)?.requireSignedURLs).toBe(false);
    await prisma.video.updateMany({ data: { updatedAt: new Date(Date.now() - 3_600_000) } });

    const result = await runVideoJobs(deps, now);
    expect(result).toMatchObject({ ran: true, polled: 1, expired: 1, relocked: 1 });
    expect((await current(missed.videoId)).status).toBe("READY");
    expect((await current(dead.videoId)).status).toBe("FAILED");
    expect(stream.videos.has(deadUid)).toBe(false);
    expect(stream.videos.get(driftedUid)?.requireSignedURLs).toBe(true);
    expect((await current(drifted)).streamPublic).toBe(false);
  });
});
