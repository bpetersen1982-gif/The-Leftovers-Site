import { z } from "zod";

/**
 * Object storage settings (Cloudflare R2 in production, the docker compose S3 server
 * locally). Kept apart from the S3 client so the request proxy can read the storage
 * origins for its Content-Security-Policy without loading the AWS SDK.
 */

const configSchema = z.object({
  R2_ACCOUNT_ID: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/, "R2_ACCOUNT_ID must be a 32-character Cloudflare account id")
    .optional(),
  /** Local/test only: overrides the R2 endpoint derived from R2_ACCOUNT_ID. */
  STORAGE_ENDPOINT: z.url().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
  R2_PRIVATE_BUCKET: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  R2_PUBLIC_BUCKET: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  R2_PUBLIC_URL: z
    .url()
    .transform((value) => value.replace(/\/+$/, "")),
});

export interface StorageConfig {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly privateBucket: string;
  readonly publicBucket: string;
  /** Base URL that serves the public bucket, no trailing slash. */
  readonly publicUrl: string;
  /**
   * Path-style addressing (https://endpoint/bucket/key). R2 and the local server both
   * accept it, and it keeps every storage URL on one origin, which the CSP allows.
   */
  readonly forcePathStyle: true;
}

const STORAGE_KEYS = [
  "R2_ACCOUNT_ID",
  "STORAGE_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PRIVATE_BUCKET",
  "R2_PUBLIC_BUCKET",
  "R2_PUBLIC_URL",
] as const;

/**
 * Reads storage settings. Returns null when none are set (photos disabled, e.g. a fresh
 * dev checkout); throws when they are partially or wrongly set, so a typo never silently
 * disables uploads. Production must use R2 over https.
 */
export function storageConfig(source: Readonly<Record<string, string | undefined>> = process.env): StorageConfig | null {
  const provided = Object.fromEntries(
    STORAGE_KEYS.map((key) => [key, source[key]?.trim() || undefined] as const).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(provided).length === 0) return null;

  const parsed = configSchema.safeParse(provided);
  if (!parsed.success) {
    const summary = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid storage configuration:\n  ${summary.join("\n  ")}`);
  }
  const data = parsed.data;
  if (!data.STORAGE_ENDPOINT && !data.R2_ACCOUNT_ID) {
    throw new Error("Invalid storage configuration: set R2_ACCOUNT_ID (or STORAGE_ENDPOINT for local development)");
  }
  if (data.R2_PRIVATE_BUCKET === data.R2_PUBLIC_BUCKET) {
    throw new Error("Invalid storage configuration: private and public buckets must differ");
  }

  const isProduction = source.NODE_ENV === "production" && source.LEFTOVERS_ENV === "production";
  if (isProduction && (data.STORAGE_ENDPOINT || !data.R2_PUBLIC_URL.startsWith("https://"))) {
    throw new Error("Invalid storage configuration: production must use R2 (no STORAGE_ENDPOINT) and an https R2_PUBLIC_URL");
  }

  return {
    endpoint: data.STORAGE_ENDPOINT ?? `https://${data.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKeyId: data.R2_ACCESS_KEY_ID,
    secretAccessKey: data.R2_SECRET_ACCESS_KEY,
    privateBucket: data.R2_PRIVATE_BUCKET,
    publicBucket: data.R2_PUBLIC_BUCKET,
    publicUrl: data.R2_PUBLIC_URL,
    forcePathStyle: true,
  };
}

export interface StorageCspOrigins {
  /** Where <img> may load from: public CDN + signed private previews. */
  readonly img: readonly string[];
  /** Where the browser may PUT uploads. */
  readonly connect: readonly string[];
}

/** CSP origins for photo storage, or empty lists when storage isn't configured. */
export function storageCspOrigins(source: Readonly<Record<string, string | undefined>> = process.env): StorageCspOrigins {
  const config = storageConfig(source);
  if (!config) return { img: [], connect: [] };
  const endpoint = new URL(config.endpoint).origin;
  const publicOrigin = new URL(config.publicUrl).origin;
  return { img: [...new Set([publicOrigin, endpoint])], connect: [endpoint] };
}
