import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type StorageConfig, storageConfig } from "./storage-config";

/**
 * Object storage for photos (requirements §1.2): Cloudflare R2 in production, a local
 * S3-compatible server (docker compose `storage`) in development and tests.
 *
 * Two buckets:
 * - private: browser uploads, originals, and processed variants awaiting approval. Never public.
 * - public:  copies of approved variants only, served from R2_PUBLIC_URL (media.theleftoversband.com).
 *
 * Browsers upload straight to the private bucket with a short-lived presigned PUT whose
 * Content-Type and Content-Length are part of the signature, so the app server never
 * proxies upload bytes and a URL can't be reused for a different size or type.
 */

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Photo storage is not configured");
    this.name = "StorageNotConfiguredError";
  }
}

export class ObjectTooLargeError extends Error {
  constructor(readonly key: string, readonly maxBytes: number) {
    super(`Object ${key} is larger than ${maxBytes} bytes`);
    this.name = "ObjectTooLargeError";
  }
}

export interface ObjectInfo {
  readonly size: number;
  readonly contentType: string | undefined;
}

export interface PresignedUpload {
  readonly url: string;
  /** Headers the browser must send unchanged (they are signed). */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

/** Storage operations the app uses. An interface so services take it as a dependency. */
export interface ObjectStorage {
  readonly publicUrl: string;
  presignPrivateUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;
  /** Short-lived GET URL for a private object (band-only previews of unpublished photos). */
  presignPrivateRead(key: string, expiresInSeconds: number): Promise<string>;
  headPrivate(key: string): Promise<ObjectInfo | null>;
  /** Reads a private object fully into memory, refusing anything over maxBytes. */
  readPrivate(key: string, maxBytes: number): Promise<Buffer>;
  putPrivate(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Copies a private object into the public bucket under the same or a new key. */
  publish(privateKey: string, publicKey: string, input: { contentType: string; cacheControl: string }): Promise<void>;
  deletePrivate(keys: readonly string[]): Promise<void>;
  /** Deletes every private object under a prefix ending in "/" (e.g. a photo's variants). */
  deletePrivatePrefix(prefix: string): Promise<void>;
  deletePublic(keys: readonly string[]): Promise<void>;
  /** Deletes every public object under a prefix ending in "/" (all public copies of a photo). */
  deletePublicPrefix(prefix: string): Promise<void>;
  publicUrlFor(publicKey: string): string;
}

/** Keys are generated server-side only; this guards against a bug ever building a bad one. */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,500}$/;
function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Refusing unsafe storage key: ${JSON.stringify(key)}`);
  }
}

/** S3 DeleteObjects accepts at most 1000 keys per call. */
const DELETE_BATCH = 1000;

function isMissing(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) return true;
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

export function createObjectStorage(config: StorageConfig): ObjectStorage {
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 doesn't need the newer default checksum headers, and presigned browser PUTs can't send them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  async function deleteKeys(bucket: string, keys: readonly string[]): Promise<void> {
    keys.forEach(assertSafeKey);
    for (let start = 0; start < keys.length; start += DELETE_BATCH) {
      const batch = keys.slice(start, start + DELETE_BATCH);
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failures = (result.Errors ?? []).filter((failure) => failure.Code !== "NoSuchKey");
      if (failures.length > 0) {
        const detail = failures.map((failure) => `${failure.Key}: ${failure.Code}`).join(", ");
        throw new Error(`Failed to delete ${failures.length} object(s) from ${bucket}: ${detail}`);
      }
    }
  }

  async function deletePrefix(bucket: string, prefix: string): Promise<void> {
    assertSafeKey(prefix);
    if (!prefix.endsWith("/")) throw new Error(`Refusing prefix without trailing slash: ${prefix}`);
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : []));
      if (keys.length > 0) await deleteKeys(bucket, keys);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  return {
    publicUrl: config.publicUrl,

    async presignPrivateUpload({ key, contentType, contentLength, expiresInSeconds }) {
      assertSafeKey(key);
      const command = new PutObjectCommand({
        Bucket: config.privateBucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
        // Keep both in the signature (not hoisted to the query) so the upload must match them.
        signableHeaders: new Set(["content-type", "content-length"]),
        unhoistableHeaders: new Set(["content-type", "content-length"]),
      });
      return {
        url,
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
    },

    async presignPrivateRead(key, expiresInSeconds) {
      assertSafeKey(key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.privateBucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    async headPrivate(key) {
      assertSafeKey(key);
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: config.privateBucket, Key: key }));
        return { size: head.ContentLength ?? 0, contentType: head.ContentType };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async readPrivate(key, maxBytes) {
      assertSafeKey(key);
      const object = await client.send(new GetObjectCommand({ Bucket: config.privateBucket, Key: key }));
      if (!object.Body) throw new Error(`Object ${key} has no body`);
      if ((object.ContentLength ?? 0) > maxBytes) {
        object.Body.transformToWebStream().cancel().catch(() => undefined);
        throw new ObjectTooLargeError(key, maxBytes);
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of object.Body.transformToWebStream()) {
        const bytes = chunk as Uint8Array;
        total += bytes.byteLength;
        if (total > maxBytes) throw new ObjectTooLargeError(key, maxBytes);
        chunks.push(bytes);
      }
      return Buffer.concat(chunks, total);
    },

    async putPrivate(key, body, contentType) {
      assertSafeKey(key);
      await client.send(
        new PutObjectCommand({ Bucket: config.privateBucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async publish(privateKey, publicKey, { contentType, cacheControl }) {
      assertSafeKey(privateKey);
      assertSafeKey(publicKey);
      await client.send(
        new CopyObjectCommand({
          Bucket: config.publicBucket,
          Key: publicKey,
          CopySource: `${config.privateBucket}/${privateKey}`,
          MetadataDirective: "REPLACE",
          ContentType: contentType,
          CacheControl: cacheControl,
        }),
      );
    },

    deletePrivate: (keys) => deleteKeys(config.privateBucket, keys),

    deletePrivatePrefix: (prefix) => deletePrefix(config.privateBucket, prefix),
    deletePublic: (keys) => deleteKeys(config.publicBucket, keys),
    deletePublicPrefix: (prefix) => deletePrefix(config.publicBucket, prefix),

    publicUrlFor(publicKey) {
      assertSafeKey(publicKey);
      return `${config.publicUrl}/${publicKey}`;
    },
  };
}

export { storageConfig, type StorageConfig };

let cachedStorage: ObjectStorage | null | undefined;

/** Process-wide storage client, or null when storage isn't configured. */
export function objectStorage(): ObjectStorage | null {
  if (cachedStorage === undefined) {
    const config = storageConfig();
    cachedStorage = config ? createObjectStorage(config) : null;
  }
  return cachedStorage;
}

/** Like objectStorage(), but throws when photos can't work without it. */
export function requireObjectStorage(): ObjectStorage {
  const storage = objectStorage();
  if (!storage) throw new StorageNotConfiguredError();
  return storage;
}
