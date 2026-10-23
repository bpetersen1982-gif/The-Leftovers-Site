import { createObjectStorage, storageConfig, type ObjectStorage, type StorageConfig } from "@/lib/storage";
import { emptyLocalBuckets, ensureLocalBuckets } from "@/lib/storage-dev";

/**
 * Test storage: the docker compose S3 server with dedicated test buckets, so tests never
 * touch dev uploads (and can never reach R2: the endpoint is fixed to localhost).
 */
export const TEST_STORAGE_ENV = {
  STORAGE_ENDPOINT: process.env.LEFTOVERS_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9100",
  R2_ACCESS_KEY_ID: "leftovers_dev_key",
  R2_SECRET_ACCESS_KEY: "leftovers_dev_secret_only",
  R2_PRIVATE_BUCKET: "leftovers-test-private",
  R2_PUBLIC_BUCKET: "leftovers-test-public",
  R2_PUBLIC_URL: `${process.env.LEFTOVERS_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9100"}/leftovers-test-public`,
} as const;

export function testStorageConfig(): StorageConfig {
  const config = storageConfig({ ...TEST_STORAGE_ENV, NODE_ENV: "test" });
  if (!config) throw new Error("unreachable: test storage config is always set");
  return config;
}

export function createTestStorage(): ObjectStorage {
  return createObjectStorage(testStorageConfig());
}

export async function resetStorage(): Promise<void> {
  const config = testStorageConfig();
  await ensureLocalBuckets(config);
  await emptyLocalBuckets(config);
}
