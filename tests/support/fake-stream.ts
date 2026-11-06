import { randomBytes } from "node:crypto";
import type { StreamClient, StreamVideo } from "@/lib/video/stream";

/**
 * In-memory stand-in for Cloudflare Stream in tests. Behaves like the real API for what
 * the app uses (state, signed-URL flag, captions, deletion) and can be told to fail.
 */
export interface FakeVideo {
  state: "pendingupload" | "inprogress" | "ready" | "error";
  errorCode: string;
  requireSignedURLs: boolean;
  allowedOrigins: string[];
  captions: Map<string, string>;
  duration: number;
}

export const FAKE_ORIGIN = "https://customer-testcode123.cloudflarestream.com";

export class FakeStream implements StreamClient {
  readonly maxBytes = 5 * 1024 ** 3;
  readonly maxDurationSeconds = 3600;
  readonly videos = new Map<string, FakeVideo>();
  /** When set, every call throws (simulates Stream being down). */
  down = false;

  private check(): void {
    if (this.down) throw new Error("fake stream is down");
  }

  async createUpload() {
    this.check();
    const uid = randomBytes(16).toString("hex");
    this.videos.set(uid, { state: "pendingupload", errorCode: "", requireSignedURLs: true, allowedOrigins: [], captions: new Map(), duration: -1 });
    return { uid, uploadUrl: `https://upload.cloudflarestream.com/tus/${uid}?tusv2=true` };
  }

  /** What Stream would report (and send in a webhook) for this video. */
  report(uid: string): StreamVideo {
    const video = this.videos.get(uid);
    if (!video) throw new Error(`no fake video ${uid}`);
    const ready = video.state === "ready";
    return {
      uid,
      readyToStream: ready,
      status: { state: video.state, errorReasonCode: video.errorCode },
      duration: video.duration,
      size: 1000,
      input: ready ? { width: 1920, height: 1080 } : { width: -1, height: -1 },
      preview: ready ? `${FAKE_ORIGIN}/${uid}/watch` : null,
      thumbnail: ready ? `${FAKE_ORIGIN}/${uid}/thumbnails/thumbnail.jpg` : null,
      requireSignedURLs: video.requireSignedURLs,
    };
  }

  /** Simulates Stream finishing (or failing) encoding. */
  finish(uid: string, outcome: "ready" | "error" | "inprogress" = "ready", errorCode = ""): void {
    const video = this.videos.get(uid);
    if (!video) throw new Error(`no fake video ${uid}`);
    video.state = outcome;
    video.errorCode = errorCode;
    if (outcome === "ready") video.duration = 95.4;
  }

  async getVideo(uid: string) {
    this.check();
    return this.videos.has(uid) ? this.report(uid) : null;
  }

  async setPlayback(uid: string, playback: { public: true; allowedOrigins: readonly string[] } | { public: false }) {
    this.check();
    const video = this.videos.get(uid);
    if (!video) throw new Error("404");
    video.requireSignedURLs = !playback.public;
    video.allowedOrigins = playback.public ? [...playback.allowedOrigins] : video.allowedOrigins;
  }

  async deleteVideo(uid: string) {
    this.check();
    this.videos.delete(uid);
  }

  async createToken(uid: string) {
    this.check();
    if (!this.videos.has(uid)) throw new Error("404");
    return `token-${uid}-${"x".repeat(20)}`;
  }

  async uploadCaptions(uid: string, language: string, vtt: string) {
    this.check();
    this.videos.get(uid)?.captions.set(language, vtt);
  }

  async deleteCaptions(uid: string, language: string) {
    this.check();
    this.videos.get(uid)?.captions.delete(language);
  }

  async storageUsage() {
    this.check();
    return { videoCount: this.videos.size, totalStorageMinutes: 12, totalStorageMinutesLimit: 1000 };
  }
}
