import { db } from "../db";
import { env } from "../env";
import type { VideoDeps } from "./service";
import { embedOriginsFor } from "./service";
import { streamClient } from "./stream";

/** Production wiring for the video services, or null when Stream isn't configured. */
export function videoDeps(): VideoDeps | null {
  const stream = streamClient();
  if (!stream) return null;
  return { prisma: db(), stream, embedOrigins: embedOriginsFor(env().APP_URL) };
}
