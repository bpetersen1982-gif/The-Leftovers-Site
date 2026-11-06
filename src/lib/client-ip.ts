import { headers } from "next/headers";

/**
 * The visitor's IP, for rate limits and the Turnstile check. Railway's edge proxy sets
 * X-Real-IP / X-Forwarded-For; the first X-Forwarded-For entry is the original client.
 * Only used for throttling, never for authorization.
 */
export async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get("x-real-ip") ?? list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
