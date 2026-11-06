"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { type DecisionResult, decideFanPosts, deleteFanPost, FanError, setFanPhotoAltText } from "@/lib/fan/service";
import { type FanPostRef, fanPostRefSchema } from "@/lib/fan/validation";
import { getRequestId } from "@/lib/request-id";
import { objectStorage } from "@/lib/storage";
import type { ActionState } from "../action-state";

function deps() {
  return { prisma: db(), storage: objectStorage() };
}

function refresh(): void {
  revalidatePath("/admin/fan-wall");
  revalidatePath("/fan-wall");
  revalidatePath("/shows", "layout");
}

function expected(error: unknown): ActionState {
  if (error instanceof FanError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Check that and try again." };
  throw error;
}

/** Checkbox / button values are "id:version", so a stale page can't decide a changed post. */
function refsFrom(formData: FormData): FanPostRef[] | null {
  const refs: FanPostRef[] = [];
  for (const value of formData.getAll("post")) {
    const [id, version] = String(value).split(":");
    const parsed = fanPostRefSchema.safeParse({ id, version });
    if (!parsed.success) return null;
    refs.push(parsed.data);
  }
  return refs;
}

const OUTCOME_TEXT: Record<Exclude<DecisionResult["outcome"], "done">, string> = {
  unchanged: "already had that decision",
  conflict: "changed by someone else first",
  missing: "no longer exists",
  locked: "decided by an Admin (only an Admin can change it)",
  needsAltText: "needs a photo description first",
  notReady: "is still uploading its photo",
};

function summary(results: readonly DecisionResult[], verb: string): ActionState {
  const done = results.filter((result) => result.outcome === "done").length;
  const skipped = results.filter((result) => result.outcome !== "done");
  const parts = done > 0 ? [`${verb} ${done} post${done === 1 ? "" : "s"}.`] : [];
  const reasons = [...new Set(skipped.map((result) => OUTCOME_TEXT[result.outcome as keyof typeof OUTCOME_TEXT]))];
  if (skipped.length > 0) parts.push(`${skipped.length} skipped: ${reasons.join("; ")}. Reload to see the latest.`);
  return { ok: skipped.length === 0, message: parts.join(" ") };
}

export async function decideFanPostsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("fan:moderate");
  const refs = refsFrom(formData);
  if (!refs) return { ok: false, message: "Reload the page and try again." };
  if (refs.length === 0) return { ok: false, message: "Tick at least one post first." };
  const intent = formData.get("intent");
  if (intent !== "approve" && intent !== "reject") return { ok: false, message: "Choose approve or reject." };
  try {
    const results = await decideFanPosts(deps(), actor, refs, intent === "approve" ? "APPROVED" : "REJECTED", String(formData.get("reason") ?? ""), await getRequestId());
    refresh();
    return summary(results, intent === "approve" ? "Approved" : "Rejected");
  } catch (error) {
    return expected(error);
  }
}

export async function fanAltTextAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("fan:moderate");
  const ref = fanPostRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    await setFanPhotoAltText(deps(), actor, ref.data, String(formData.get("altText") ?? ""));
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function deleteFanPostAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("fan:delete");
  const ref = fanPostRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    await deleteFanPost(deps(), actor, ref.data, await getRequestId());
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: "Deleted." };
}
