"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { FanError, completeFanPhoto, submitFanPost } from "@/lib/fan/service";
import { logger } from "@/lib/logger";
import { getRequestId } from "@/lib/request-id";
import { objectStorage } from "@/lib/storage";
import { turnstileConfig, turnstileMessage, verifyTurnstile } from "@/lib/turnstile";

/**
 * Public Fan Wall actions (requirements FAN-1..FAN-4). Spam protection in order: honeypot
 * and minimum fill time (silently dropped), Turnstile (fails closed), then the per-IP rate
 * limit and validation in the service. Nothing from the browser is trusted.
 */

const MIN_FILL_MS = 3_000;

const inputSchema = z.object({
  displayName: z.string().max(500),
  message: z.string().max(5_000),
  email: z.string().max(500),
  showId: z.string().max(100),
  photo: z
    .object({ filename: z.string().max(500), contentType: z.string().max(100), size: z.number(), altText: z.string().max(1_000), consent: z.boolean() })
    .nullable(),
  website: z.string().max(500),
  startedAt: z.number(),
  turnstileToken: z.string().max(4_096),
});

export type FanSubmitResult =
  | { readonly ok: true; readonly photoUpload: { postId: string; url: string; headers: Record<string, string>; token: string } | null }
  | { readonly ok: false; readonly message: string; readonly fieldErrors?: Partial<Record<string, string>> };

export async function submitFanPostAction(raw: unknown): Promise<FanSubmitResult> {
  const input = inputSchema.safeParse(raw);
  if (!input.success) return { ok: false, message: "Something about that form was off. Reload and try again." };
  // Bots fill hidden fields and submit instantly: give them a believable success and save nothing.
  if (input.data.website !== "" || Date.now() - input.data.startedAt < MIN_FILL_MS) return { ok: true, photoUpload: null };

  const ip = await clientIp();
  const turnstile = turnstileConfig();
  if (!turnstile) {
    logger.error({ requestId: await getRequestId() }, "fan wall post refused: turnstile not configured");
    return { ok: false, message: "The Fan Wall isn't taking posts right now. Try again later." };
  }
  const check = await verifyTurnstile({ secretKey: turnstile.secretKey, token: input.data.turnstileToken, remoteIp: ip, expectedAction: "fan-post" });
  if (!check.ok) return { ok: false, message: turnstileMessage(check) };

  try {
    const { displayName, message, email, showId, photo } = input.data;
    const submitted = await submitFanPost(
      { prisma: db(), storage: objectStorage() },
      { displayName, message, email, showId, photo: photo ? { ...photo, consent: photo.consent as true } : null },
      { ip },
    );
    revalidatePath("/admin/fan-wall");
    const upload = submitted.photoUpload;
    return {
      ok: true,
      photoUpload: upload ? { postId: submitted.postId, url: upload.url, headers: { ...upload.headers }, token: upload.completionToken } : null,
    };
  } catch (error) {
    if (error instanceof FanError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) {
      const fieldErrors: Partial<Record<string, string>> = {};
      for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
      return { ok: false, message: "Fix the highlighted fields.", fieldErrors };
    }
    throw error;
  }
}

export async function completeFanPhotoAction(postId: unknown, token: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = z.object({ postId: z.uuid(), token: z.string().min(20).max(100) }).safeParse({ postId, token });
  if (!parsed.success) return { ok: false, message: "Your message was sent, but the photo couldn't be attached." };
  try {
    const result = await completeFanPhoto({ prisma: db(), storage: objectStorage() }, parsed.data.postId, parsed.data.token);
    revalidatePath("/admin/fan-wall");
    return result.photo === "added"
      ? { ok: true, message: "Thanks! A band member will read it soon. Posts show up here once they're approved." }
      : { ok: false, message: `Your message was sent, but the photo couldn't be used: ${result.reason}` };
  } catch (error) {
    if (error instanceof FanError) return { ok: false, message: `Your message was sent. ${error.message}` };
    throw error;
  }
}
