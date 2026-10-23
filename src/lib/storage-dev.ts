import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "./storage";

/**
 * Local development/test helpers for the docker compose S3 server. Never used against R2:
 * buckets there are created once in the Cloudflare dashboard.
 */

function localClient(config: StorageConfig): S3Client {
  if (config.endpoint.includes("r2.cloudflarestorage.com")) {
    throw new Error("storage-dev helpers only run against the local S3 server (STORAGE_ENDPOINT)");
  }
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function alreadyExists(error: unknown): boolean {
  if (error instanceof BucketAlreadyOwnedByYou) return true;
  return error instanceof S3ServiceException && ["BucketAlreadyExists", "BucketAlreadyOwnedByYou"].includes(error.name);
}

/** Creates the private and public buckets if they don't exist yet. */
export async function ensureLocalBuckets(config: StorageConfig): Promise<void> {
  const client = localClient(config);
  try {
    for (const bucket of [config.privateBucket, config.publicBucket]) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!alreadyExists(error)) throw error;
      }
    }
  } finally {
    client.destroy();
  }
}

/** Deletes every object in both buckets (test isolation). */
export async function emptyLocalBuckets(config: StorageConfig): Promise<void> {
  const client = localClient(config);
  try {
    for (const bucket of [config.privateBucket, config.publicBucket]) {
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        const keys = (page.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
        if (keys.length > 0) {
          await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
  } finally {
    client.destroy();
  }
}
