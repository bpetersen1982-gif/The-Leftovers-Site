import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { videoDeps } from "@/lib/video/deps";
import { applyStreamWebhook } from "@/lib/video/service";
import { streamConfig } from "@/lib/video/stream";
import { verifyStreamWebhook } from "@/lib/video/webhook";

/**
 * Cloudflare Stream webhook (requirements MED-7): "video ready" / "video failed".
 * Signature-verified (HMAC with the registered secret, 5-minute replay window) and
 * idempotent: applying the same notification twice changes nothing.
 */

export const runtime = "nodejs";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = streamConfig()?.webhookSecret;
  const deps = videoDeps();
  if (!secret || !deps) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });

  if (!verifyStreamWebhook({ secret, header: request.headers.get("webhook-signature"), rawBody })) {
    logger.warn({ path: "/api/stream/webhook" }, "rejected stream webhook with a bad or stale signature");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  try {
    const outcome = await applyStreamWebhook(deps, body);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "unexpected payload" }, { status: 400 });
    logger.error({ err: error }, "stream webhook failed");
    // 500 makes Stream retry later.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
