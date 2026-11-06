"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { takedownNoticeSchema } from "@/lib/photos/validation";
import { getRequestId } from "@/lib/request-id";
import { videoDeps } from "@/lib/video/deps";
import { VideoError } from "@/lib/video/errors";
import {
  completeVideoUpload,
  createVideoUpload,
  deleteVideo,
  publishVideo,
  requestVideoRemoval,
  restoreVideo,
  setVideoCaptions,
  takedownVideo,
  updateVideoDetails,
  type VideoDeps,
} from "@/lib/video/service";
import { MAX_CAPTIONS_BYTES, videoRefSchema } from "@/lib/video/validation";
import type { ActionState } from "../action-state";

/**
 * Server actions for /admin/videos. Every action re-checks permission; the video service
 * enforces state rules and version checks. Video bytes never come through here.
 */

function refresh(): void {
  revalidatePath("/admin/videos");
  revalidatePath("/videos", "layout");
}

function deps(): VideoDeps {
  const wired = videoDeps();
  if (!wired) throw new VideoError("VIDEO_DISABLED");
  return wired;
}

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) result[String(issue.path[0] ?? "form")] ??= issue.message;
  return result;
}

function expected(error: unknown): ActionState {
  if (error instanceof VideoError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(error) };
  throw error;
}

function refFrom(formData: FormData) {
  return videoRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
}

// ---------------------------------------------------------------- upload (called by the uploader)

export type StartVideoUploadResult = { readonly ok: true; readonly videoId: string; readonly uploadUrl: string } | { readonly ok: false; readonly message: string };

export async function startVideoUploadAction(input: { filename: string; size: number }): Promise<StartVideoUploadResult> {
  const actor = await requirePermission("videos:manage");
  try {
    const created = await createVideoUpload(deps(), actor, { filename: String(input.filename), size: Number(input.size) }, await getRequestId());
    refresh();
    return { ok: true, ...created };
  } catch (error) {
    const state = expected(error);
    return { ok: false, message: state.message ?? "That upload couldn't start." };
  }
}

export async function finishVideoUploadAction(videoId: string): Promise<{ ok: boolean; message: string }> {
  const actor = await requirePermission("videos:manage");
  const id = z.uuid().safeParse(videoId);
  if (!id.success) return { ok: false, message: "That upload isn't valid." };
  try {
    const status = await completeVideoUpload(deps(), actor, id.data);
    refresh();
    if (status === "FAILED") return { ok: false, message: "Stream couldn't use that file. See the details below." };
    return { ok: true, message: status === "READY" ? "Ready: add a title below." : "Uploaded. Stream is processing it (usually a few minutes)." };
  } catch (error) {
    if (error instanceof VideoError) return { ok: false, message: error.message };
    logger.error({ err: error, videoId: id.data }, "finishing video upload failed");
    return { ok: false, message: "The upload finished, but checking on it failed. Reload in a minute." };
  }
}

// ---------------------------------------------------------------- details, publish, captions

export async function saveVideoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("videos:manage");
  const requestId = await getRequestId();
  try {
    const wired = deps();
    const version = await updateVideoDetails(
      wired,
      actor,
      {
        id: String(formData.get("id") ?? ""),
        version: String(formData.get("version") ?? ""),
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? ""),
        posterSeconds: String(formData.get("posterSeconds") ?? "0"),
      },
      requestId,
    );
    if (formData.get("intent") === "publish") {
      await publishVideo(wired, actor, { id: String(formData.get("id")), version }, requestId);
      refresh();
      return { ok: true, message: "Published." };
    }
    refresh();
    return { ok: true, message: "Saved." };
  } catch (error) {
    return expected(error);
  }
}

export async function captionsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("videos:manage");
  const ref = refFrom(formData);
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  let vtt: string | null = null;
  if (formData.get("intent") !== "remove") {
    const file = formData.get("captions");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a .vtt captions file.", fieldErrors: { captions: "Choose a .vtt file." } };
    if (file.size > MAX_CAPTIONS_BYTES) return { ok: false, message: "Captions files can be up to 512 KB." };
    vtt = await file.text();
  }
  try {
    await setVideoCaptions(deps(), actor, ref.data, vtt, await getRequestId());
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: vtt === null ? "Captions removed." : "Captions added." };
}

// ---------------------------------------------------------------- remove / restore / delete / takedown

const decisionSchema = z.enum(["remove", "restore", "delete"]);

export async function videoDecisionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const intent = decisionSchema.safeParse(formData.get("intent"));
  const ref = refFrom(formData);
  if (!intent.success || !ref.success) return { ok: false, message: "Reload the page and try again." };
  const actor = await requirePermission(intent.data === "remove" ? "videos:requestRemoval" : "videos:manage");
  const requestId = await getRequestId();
  try {
    const wired = deps();
    let message: string;
    if (intent.data === "remove") {
      const result = await requestVideoRemoval(wired, actor, ref.data, String(formData.get("reason") ?? ""), requestId);
      message = result.lockedOnStream ? "Taken off the site." : "Taken off the site. Stream didn't respond, so its old link will be locked on the next retry (within 10 minutes).";
    } else if (intent.data === "restore") {
      await restoreVideo(wired, actor, ref.data, requestId);
      message = "Back on the site.";
    } else {
      const result = await deleteVideo(wired, actor, ref.data, requestId);
      message = result.deletedOnStream ? "Deleted." : "Deleted here, but Stream didn't confirm. It's been logged so it can be removed by hand.";
    }
    refresh();
    return { ok: true, message };
  } catch (error) {
    return expected(error);
  }
}

export async function takedownVideoAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("media:takedown");
  const ref = refFrom(formData);
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  const notice = takedownNoticeSchema.safeParse({
    senderName: String(formData.get("senderName") ?? ""),
    senderEmail: String(formData.get("senderEmail") ?? ""),
    workClaimed: String(formData.get("workClaimed") ?? ""),
    receivedOn: String(formData.get("receivedOn") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (!notice.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(notice.error) };
  try {
    const result = await takedownVideo(deps(), actor, ref.data, notice.data, await getRequestId());
    refresh();
    return { ok: true, message: `Taken down and the notice is recorded.${result.lockedOnStream ? "" : " Stream didn't respond; its old link will be locked on the next retry."}` };
  } catch (error) {
    return expected(error);
  }
}
