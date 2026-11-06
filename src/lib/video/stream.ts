import { z } from "zod";

/**
 * Cloudflare Stream API (requirements MED-6..MED-11). Video bytes never pass through the
 * app: the browser uploads straight to Stream with a one-time resumable (tus) URL.
 *
 * Videos are created with `requireSignedURLs`, so they can't be played by id until an
 * Admin publishes them. Removing or taking down a video turns signing back on, which
 * stops every existing link and embed from playing.
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 20_000;
const GIB = 1024 ** 3;

const configSchema = z.object({
  CF_ACCOUNT_ID: z.string().trim().regex(/^[a-f0-9]{32}$/, "CF_ACCOUNT_ID must be a 32-character Cloudflare account id"),
  CF_STREAM_API_TOKEN: z.string().trim().min(20),
  /** From the webhook registration (scripts/stream-webhook.ts). Optional locally. */
  CF_STREAM_WEBHOOK_SECRET: z.string().trim().min(16).optional(),
  /** MED-6: configurable size limit, default 5 GB. */
  VIDEO_MAX_BYTES: z.coerce.number().int().positive().max(30 * GIB).default(5 * GIB),
  VIDEO_MAX_DURATION_SECONDS: z.coerce.number().int().min(10).max(6 * 3600).default(3600),
});

export interface StreamConfig {
  readonly accountId: string;
  readonly apiToken: string;
  readonly webhookSecret: string | null;
  readonly maxBytes: number;
  readonly maxDurationSeconds: number;
}

const KEYS = ["CF_ACCOUNT_ID", "CF_STREAM_API_TOKEN", "CF_STREAM_WEBHOOK_SECRET", "VIDEO_MAX_BYTES", "VIDEO_MAX_DURATION_SECONDS"] as const;

/** Null when Stream isn't configured (video disabled); throws when it's half-configured. */
export function streamConfig(source: Readonly<Record<string, string | undefined>> = process.env): StreamConfig | null {
  const provided = Object.fromEntries(KEYS.flatMap((key) => (source[key]?.trim() ? [[key, source[key]?.trim()]] : [])));
  if (!provided.CF_ACCOUNT_ID && !provided.CF_STREAM_API_TOKEN) return null;
  const parsed = configSchema.safeParse(provided);
  if (!parsed.success) {
    const summary = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid video configuration:\n  ${summary.join("\n  ")}`);
  }
  return {
    accountId: parsed.data.CF_ACCOUNT_ID,
    apiToken: parsed.data.CF_STREAM_API_TOKEN,
    webhookSecret: parsed.data.CF_STREAM_WEBHOOK_SECRET ?? null,
    maxBytes: parsed.data.VIDEO_MAX_BYTES,
    maxDurationSeconds: parsed.data.VIDEO_MAX_DURATION_SECONDS,
  };
}

// ---------------------------------------------------------------- what Stream tells us

const STREAM_UID = /^[a-f0-9]{32}$/;
export const streamUidSchema = z.string().regex(STREAM_UID);

export const streamVideoSchema = z.object({
  uid: streamUidSchema,
  readyToStream: z.boolean().optional().default(false),
  status: z
    .object({
      state: z.string(),
      errorReasonCode: z.string().optional(),
      errReasonCode: z.string().optional(),
    })
    .passthrough(),
  duration: z.number().optional().nullable(),
  size: z.number().optional().nullable(),
  input: z.object({ width: z.number().optional(), height: z.number().optional() }).optional().nullable(),
  preview: z.url().optional().nullable(),
  thumbnail: z.url().optional().nullable(),
  requireSignedURLs: z.boolean().optional(),
});
export type StreamVideo = z.infer<typeof streamVideoSchema>;

export interface StorageUsage {
  readonly videoCount: number;
  readonly totalStorageMinutes: number;
  readonly totalStorageMinutesLimit: number | null;
}

export interface CreatedStreamUpload {
  readonly uid: string;
  /** One-time tus URL the browser uploads to. */
  readonly uploadUrl: string;
}

/** Everything the app asks of Stream. An interface so services take it as a dependency. */
export interface StreamClient {
  readonly maxBytes: number;
  readonly maxDurationSeconds: number;
  createUpload(input: { sizeBytes: number; name: string; expiresAt: Date }): Promise<CreatedStreamUpload>;
  getVideo(uid: string): Promise<StreamVideo | null>;
  /**
   * Public: anyone may play it by id, embedded only on `allowedOrigins`.
   * Private: only signed tokens play it; every existing link and embed stops working.
   */
  setPlayback(uid: string, playback: { public: true; allowedOrigins: readonly string[] } | { public: false }): Promise<void>;
  deleteVideo(uid: string): Promise<void>;
  /** One-hour playback token for a private video (band previews). */
  createToken(uid: string): Promise<string>;
  uploadCaptions(uid: string, language: string, vtt: string): Promise<void>;
  deleteCaptions(uid: string, language: string): Promise<void>;
  storageUsage(): Promise<StorageUsage>;
}

export class StreamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StreamApiError";
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number().optional(), message: z.string().optional() })).optional().default([]),
  result: z.unknown(),
});

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** Pulls the uid out of a tus Location like https://upload.cloudflarestream.com/tus/<uid>?tusv2=true */
export function uidFromUploadUrl(location: string): string | null {
  try {
    const last = new URL(location).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return STREAM_UID.test(last) ? last : null;
  } catch {
    return null;
  }
}

export function createStreamClient(config: StreamConfig): StreamClient {
  const accountBase = `${API_BASE}/accounts/${config.accountId}/stream`;

  async function call(path: string, init: RequestInit & { allowNotFound?: boolean } = {}): Promise<unknown> {
    const response = await fetch(`${accountBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.apiToken}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (init.allowNotFound && response.status === 404) return null;
    const text = await response.text();
    let envelope: z.infer<typeof envelopeSchema> | null = null;
    try {
      envelope = envelopeSchema.parse(JSON.parse(text));
    } catch {
      // Some endpoints (DELETE) return an empty body on success.
    }
    if (!response.ok || (envelope && !envelope.success)) {
      const detail = envelope?.errors.map((error) => `${error.code ?? ""} ${error.message ?? ""}`.trim()).join("; ") || text.slice(0, 200);
      throw new StreamApiError(`Stream API ${init.method ?? "GET"} ${path} failed (${response.status}): ${detail}`, response.status);
    }
    return envelope?.result ?? null;
  }

  return {
    maxBytes: config.maxBytes,
    maxDurationSeconds: config.maxDurationSeconds,

    async createUpload({ sizeBytes, name, expiresAt }) {
      // Direct creator upload over tus: constraints go in Upload-Metadata (base64 values).
      const metadata = [
        `maxDurationSeconds ${base64(String(config.maxDurationSeconds))}`,
        "requiresignedurls",
        `expiry ${base64(expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"))}`,
        `name ${base64(name)}`,
      ].join(",");
      const response = await fetch(`${accountBase}?direct_user=true`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(sizeBytes),
          "Upload-Metadata": metadata,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (!response.ok || !location) {
        const body = (await response.text()).slice(0, 200);
        throw new StreamApiError(`Stream tus creation failed (${response.status}): ${body}`, response.status);
      }
      const uid = response.headers.get("stream-media-id") ?? uidFromUploadUrl(location);
      if (!uid || !STREAM_UID.test(uid)) throw new StreamApiError("Stream tus creation returned no video id", response.status);
      return { uid, uploadUrl: location };
    },

    async getVideo(uid) {
      const result = await call(`/${streamUidSchema.parse(uid)}`, { allowNotFound: true });
      return result === null ? null : streamVideoSchema.parse(result);
    },

    async setPlayback(uid, playback) {
      const body = playback.public
        ? { uid, requireSignedURLs: false, allowedOrigins: [...playback.allowedOrigins] }
        : { uid, requireSignedURLs: true };
      await call(`/${streamUidSchema.parse(uid)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    },

    async deleteVideo(uid) {
      try {
        await call(`/${streamUidSchema.parse(uid)}`, { method: "DELETE", allowNotFound: true });
      } catch (error) {
        // Already gone counts as deleted.
        if (error instanceof StreamApiError && error.status === 404) return;
        throw error;
      }
    },

    async createToken(uid) {
      const result = z.object({ token: z.string().min(20) }).parse(await call(`/${streamUidSchema.parse(uid)}/token`, { method: "POST" }));
      return result.token;
    },

    async uploadCaptions(uid, language, vtt) {
      const form = new FormData();
      form.append("file", new Blob([vtt], { type: "text/vtt" }), `${language}.vtt`);
      await call(`/${streamUidSchema.parse(uid)}/captions/${encodeURIComponent(language)}`, { method: "PUT", body: form });
    },

    async deleteCaptions(uid, language) {
      await call(`/${streamUidSchema.parse(uid)}/captions/${encodeURIComponent(language)}`, { method: "DELETE", allowNotFound: true });
    },

    async storageUsage() {
      const result = z
        .object({
          videoCount: z.number().optional().default(0),
          totalStorageMinutes: z.number().optional().default(0),
          totalStorageMinutesLimit: z.number().optional().nullable(),
        })
        .parse(await call("/storage-usage"));
      return { videoCount: result.videoCount, totalStorageMinutes: result.totalStorageMinutes, totalStorageMinutesLimit: result.totalStorageMinutesLimit ?? null };
    },
  };
}

let cached: StreamClient | null | undefined;

/** Process-wide Stream client, or null when video isn't configured. */
export function streamClient(): StreamClient | null {
  if (cached === undefined) {
    const config = streamConfig();
    cached = config ? createStreamClient(config) : null;
  }
  return cached;
}
