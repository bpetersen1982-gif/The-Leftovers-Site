"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { blockSourceSchema } from "@/lib/content/blocks";
import { memberInputSchema, memberUpdateSchema } from "@/lib/content/members";
import { PAGES, isPageSlug } from "@/lib/content/pages";
import {
  ContentServiceError,
  createBandMember,
  deleteBandMember,
  moveBandMember,
  saveSiteSettings,
  savePage,
  updateBandMember,
} from "@/lib/content/service";
import { SOCIAL_PLATFORM_KEYS, siteSettingsInputSchema } from "@/lib/content/settings";
import { db } from "@/lib/db";
import { getRequestId } from "@/lib/request-id";
import type { ActionState } from "./action-state";

/** Content editors save a new version on success; the form needs it for its next save. */
export interface SaveState extends ActionState {
  readonly version?: number;
}

function fieldErrorsOf(error: z.ZodError): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    result[key] ??= issue.message;
  }
  return result;
}

function expectedFailure(error: unknown): ActionState {
  if (error instanceof ContentServiceError) return { ok: false, message: error.message };
  throw error;
}

const versionSchema = z.coerce.number().int().min(0);

// ---------------------------------------------------------------- pages

export async function savePageAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const actor = await requirePermission("content:edit");
  const slug = String(formData.get("slug") ?? "");
  if (!isPageSlug(slug)) return { ok: false, message: "Unknown page." };
  const version = versionSchema.safeParse(formData.get("version"));
  const blocks = blockSourceSchema.safeParse(String(formData.get("content") ?? ""));
  if (!version.success) return { ok: false, message: "Reload the page and try again." };
  if (!blocks.success) return { ok: false, message: blocks.error.issues[0]?.message ?? "Invalid content." };

  try {
    const next = await savePage(db(), { actor, slug, blocks: blocks.data, version: version.data, requestId: await getRequestId() });
    revalidatePath(PAGES[slug].path);
    return { ok: true, message: "Saved. The public page is updated.", version: next };
  } catch (error) {
    return expectedFailure(error);
  }
}

// ---------------------------------------------------------------- band members

function memberFields(formData: FormData) {
  return {
    name: formData.get("name"),
    instrument: formData.get("instrument") ?? "",
    bio: String(formData.get("bio") ?? ""),
    isVisible: formData.get("isVisible") === "on",
  };
}

function revalidateMembers(): void {
  revalidatePath("/members");
  revalidatePath("/admin/members");
}

export async function createMemberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("members:edit");
  const parsed = memberInputSchema.safeParse(memberFields(formData));
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  await createBandMember(db(), { actor, member: parsed.data, requestId: await getRequestId() });
  revalidateMembers();
  return { ok: true, message: `Added ${parsed.data.name}.` };
}

export async function updateMemberAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const actor = await requirePermission("members:edit");
  const parsed = memberUpdateSchema.safeParse({ ...memberFields(formData), id: formData.get("id"), version: formData.get("version") });
  if (!parsed.success) return { ok: false, message: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  const { id, version, ...member } = parsed.data;
  try {
    await updateBandMember(db(), { actor, id, version, member, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidateMembers();
  return { ok: true, message: "Saved.", version: version + 1 };
}

export async function deleteMemberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("members:edit");
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Invalid member." };
  if (formData.get("confirm") !== "yes") return { ok: false, message: "Check the box to confirm deletion." };
  try {
    await deleteBandMember(db(), { actor, id: id.data, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidateMembers();
  return { ok: true, message: "Deleted." };
}

export async function moveMemberAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("members:edit");
  const input = z
    .strictObject({ id: z.uuid(), direction: z.enum(["up", "down"]) })
    .safeParse({ id: formData.get("id"), direction: formData.get("direction") });
  if (!input.success) return { ok: false, message: "Invalid move." };
  try {
    await moveBandMember(db(), { actor, ...input.data, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidateMembers();
  return { ok: true, message: null };
}

// ---------------------------------------------------------------- settings

export async function saveSettingsAction(_previous: SaveState, formData: FormData): Promise<SaveState> {
  const actor = await requirePermission("settings:edit");
  const socialLinks = SOCIAL_PLATFORM_KEYS.flatMap((platform) => {
    const url = String(formData.get(`social.${platform}`) ?? "").trim();
    return url ? [{ platform, url }] : [];
  });
  const parsed = siteSettingsInputSchema.safeParse({
    bookingEmail: formData.get("bookingEmail"),
    generalEmail: formData.get("generalEmail"),
    copyrightEmail: formData.get("copyrightEmail"),
    socialLinks,
    version: formData.get("version"),
  });
  if (!parsed.success) {
    // Map array errors (socialLinks.0.url) back to the platform's field name.
    const errors = fieldErrorsOf(parsed.error);
    for (const [key, message] of Object.entries(errors)) {
      const match = /^socialLinks\.(\d+)/.exec(key);
      const link = match ? socialLinks[Number(match[1])] : undefined;
      if (link) errors[`social.${link.platform}`] = message;
    }
    return { ok: false, message: "Fix the highlighted fields.", fieldErrors: errors };
  }
  const { version, ...values } = parsed.data;
  try {
    await saveSiteSettings(db(), { actor, version, values, requestId: await getRequestId() });
  } catch (error) {
    return expectedFailure(error);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved.", version: version + 1 };
}
