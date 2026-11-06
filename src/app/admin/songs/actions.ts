"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getRequestId } from "@/lib/request-id";
import { createSong, deleteSong, importSongs, type SongInput, SongError, songRefSchema, updateSong } from "@/lib/songs/service";
import type { ActionState } from "../action-state";

function refresh(): void {
  revalidatePath("/admin/songs");
  revalidatePath("/songs");
}

function songFrom(formData: FormData): SongInput {
  return {
    title: String(formData.get("title") ?? ""),
    artist: String(formData.get("artist") ?? ""),
    year: String(formData.get("year") ?? ""),
    note: String(formData.get("note") ?? ""),
    isVisible: formData.get("isVisible") === "on",
  };
}

function expected(error: unknown): ActionState {
  if (error instanceof SongError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, message: "Fix the highlighted fields.", fieldErrors };
  }
  throw error;
}

export async function createSongAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("songs:manage");
  const song = songFrom(formData);
  try {
    await createSong(db(), actor, song, { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: `Added "${song.title.trim()}".` };
}

export async function updateSongAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("songs:manage");
  const ref = songRefSchema.safeParse({ id: formData.get("id"), version: formData.get("version") });
  if (!ref.success) return { ok: false, message: "Reload the page and try again." };
  try {
    if (formData.get("intent") === "delete") {
      await deleteSong(db(), actor, ref.data, { requestId: await getRequestId() });
      refresh();
      return { ok: true, message: "Deleted." };
    }
    await updateSong(db(), actor, ref.data, songFrom(formData), { requestId: await getRequestId() });
  } catch (error) {
    return expected(error);
  }
  refresh();
  return { ok: true, message: "Saved." };
}

export async function importSongsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("songs:manage");
  const text = String(formData.get("list") ?? "");
  if (text.trim() === "") return { ok: false, message: "Paste some songs first." };
  if (text.length > 200_000) return { ok: false, message: "That's too much to paste at once. Split it up." };
  const result = await importSongs(db(), actor, text, { requestId: await getRequestId() });
  refresh();
  const parts = [`Added ${result.added} song${result.added === 1 ? "" : "s"}.`];
  if (result.alreadyListed > 0) parts.push(`${result.alreadyListed} already on the list.`);
  if (result.problems.length > 0) {
    const shown = result.problems.slice(0, 5).map((problem) => `line ${problem.line}: ${problem.reason}`);
    parts.push(`${result.problems.length} line${result.problems.length === 1 ? "" : "s"} skipped (${shown.join("; ")}${result.problems.length > 5 ? "; ..." : ""}).`);
  }
  return { ok: result.problems.length === 0, message: parts.join(" ") };
}
