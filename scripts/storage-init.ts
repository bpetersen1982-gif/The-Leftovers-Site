import "dotenv/config";
import { storageConfig } from "../src/lib/storage";
import { ensureLocalBuckets } from "../src/lib/storage-dev";

/**
 * Creates the local development buckets in the docker compose S3 server.
 * Usage: pnpm storage:init   (reads STORAGE_ENDPOINT and R2_* from .env)
 */
async function main(): Promise<void> {
  const config = storageConfig();
  if (!config) throw new Error("No storage settings found in .env (see .env.example)");
  await ensureLocalBuckets(config);
  console.log(`Buckets ready at ${config.endpoint}: ${config.privateBucket}, ${config.publicBucket}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
