import type { PrismaClient } from "@/generated/prisma/client";
import { type AuditActor, writeAudit } from "../audit";
import { type Block, readBlocks } from "./blocks";
import type { MemberInput } from "./members";
import { PAGES, type PageSlug } from "./pages";
import { DEFAULT_SETTINGS, type SiteSettings, type SocialLink, readSocialLinks } from "./settings";

/**
 * Content operations: pages, band members, site settings (requirements CNT-1, CNT-7, FAN-9).
 *
 * Every save uses optimistic concurrency: the editor submits the version it loaded, and
 * the update only applies if nobody saved in between. Otherwise CONFLICT, so two Admins
 * editing at once never silently overwrite each other. Every change is audited.
 */

export type ContentErrorCode = "CONFLICT" | "NOT_FOUND";

const MESSAGES: Record<ContentErrorCode, string> = {
  CONFLICT: "Someone else saved this while you were editing. Reload to see their changes, then edit again.",
  NOT_FOUND: "That item no longer exists.",
};

export class ContentServiceError extends Error {
  override readonly name = "ContentServiceError";
  constructor(readonly code: ContentErrorCode) {
    super(MESSAGES[code]);
  }
}

interface RequestMeta {
  readonly requestId?: string | null;
}

// ---------------------------------------------------------------- pages

export interface PageContent {
  readonly slug: PageSlug;
  readonly blocks: readonly Block[];
  /** 0 = never saved; default copy is being shown. */
  readonly version: number;
  readonly updatedAt: Date | null;
}

export async function getPage(prisma: PrismaClient, slug: PageSlug): Promise<PageContent> {
  const row = await prisma.page.findUnique({ where: { slug } });
  if (!row) return { slug, blocks: PAGES[slug].defaultContent, version: 0, updatedAt: null };
  return { slug, blocks: readBlocks(row.content), version: row.version, updatedAt: row.updatedAt };
}

export async function savePage(
  prisma: PrismaClient,
  input: { actor: AuditActor; slug: PageSlug; blocks: Block[]; version: number } & RequestMeta,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.page.findUnique({ where: { slug: input.slug } });
    let nextVersion: number;

    if (input.version === 0) {
      if (before) throw new ContentServiceError("CONFLICT");
      await tx.page.create({
        data: { slug: input.slug, title: PAGES[input.slug].title, content: input.blocks, updatedById: input.actor.id },
      });
      nextVersion = 1;
    } else {
      const updated = await tx.page.updateMany({
        where: { slug: input.slug, version: input.version },
        data: { content: input.blocks, version: { increment: 1 }, updatedById: input.actor.id },
      });
      if (updated.count !== 1) throw new ContentServiceError("CONFLICT");
      nextVersion = input.version + 1;
    }

    await writeAudit(tx, {
      actor: input.actor,
      action: "page.update",
      targetType: "page",
      targetId: input.slug,
      before: before ? { content: before.content as Block[], version: before.version } : { content: [...PAGES[input.slug].defaultContent], version: 0 },
      after: { content: input.blocks, version: nextVersion },
      requestId: input.requestId,
    });
    return nextVersion;
  });
}

// ---------------------------------------------------------------- band members

export interface BandMemberView {
  readonly id: string;
  readonly name: string;
  readonly instrument: string;
  readonly bio: readonly Block[];
  readonly isVisible: boolean;
  readonly sortOrder: number;
  readonly version: number;
}

export async function listBandMembers(prisma: PrismaClient, options: { includeHidden: boolean }): Promise<BandMemberView[]> {
  const rows = await prisma.bandMember.findMany({
    where: options.includeHidden ? {} : { isVisible: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    instrument: row.instrument,
    bio: readBlocks(row.bio),
    isVisible: row.isVisible,
    sortOrder: row.sortOrder,
    version: row.version,
  }));
}

function memberSnapshot(member: { name: string; instrument: string; bio: unknown; isVisible: boolean }) {
  return { name: member.name, instrument: member.instrument, bio: readBlocks(member.bio), isVisible: member.isVisible };
}

export async function createBandMember(prisma: PrismaClient, input: { actor: AuditActor; member: MemberInput } & RequestMeta): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.bandMember.aggregate({ _max: { sortOrder: true } });
    const created = await tx.bandMember.create({
      data: { ...input.member, sortOrder: (last._max.sortOrder ?? 0) + 1 },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor: input.actor,
      action: "member.create",
      targetType: "bandMember",
      targetId: created.id,
      after: memberSnapshot(input.member),
      requestId: input.requestId,
    });
    return created.id;
  });
}

export async function updateBandMember(
  prisma: PrismaClient,
  input: { actor: AuditActor; id: string; version: number; member: MemberInput } & RequestMeta,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.bandMember.findUnique({ where: { id: input.id } });
    if (!before) throw new ContentServiceError("NOT_FOUND");
    const updated = await tx.bandMember.updateMany({
      where: { id: input.id, version: input.version },
      data: { ...input.member, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ContentServiceError("CONFLICT");
    await writeAudit(tx, {
      actor: input.actor,
      action: "member.update",
      targetType: "bandMember",
      targetId: input.id,
      before: memberSnapshot(before),
      after: memberSnapshot(input.member),
      requestId: input.requestId,
    });
  });
}

export async function deleteBandMember(prisma: PrismaClient, input: { actor: AuditActor; id: string } & RequestMeta): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.bandMember.findUnique({ where: { id: input.id } });
    if (!before) throw new ContentServiceError("NOT_FOUND");
    await tx.bandMember.delete({ where: { id: input.id } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "member.delete",
      targetType: "bandMember",
      targetId: input.id,
      before: memberSnapshot(before),
      requestId: input.requestId,
    });
  });
}

/** Swaps a member with its neighbor. Rows are locked so concurrent moves can't scramble the order. */
export async function moveBandMember(
  prisma: PrismaClient,
  input: { actor: AuditActor; id: string; direction: "up" | "down" } & RequestMeta,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ordered = await tx.$queryRaw<{ id: string; sortOrder: number }[]>`
      SELECT id, "sortOrder" FROM band_member ORDER BY "sortOrder" ASC, "createdAt" ASC FOR UPDATE`;
    const index = ordered.findIndex((row) => row.id === input.id);
    if (index === -1) throw new ContentServiceError("NOT_FOUND");
    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    const neighbor = ordered[neighborIndex];
    if (!neighbor) return; // Already first/last; nothing to do.

    // Renumber 1..n with the two swapped, which also repairs any duplicate sortOrder values.
    const ids = ordered.map((row) => row.id);
    [ids[index], ids[neighborIndex]] = [neighbor.id, input.id];
    for (const [position, id] of ids.entries()) {
      await tx.bandMember.update({ where: { id }, data: { sortOrder: position + 1 } });
    }
    await writeAudit(tx, {
      actor: input.actor,
      action: "member.reorder",
      targetType: "bandMember",
      targetId: input.id,
      after: { direction: input.direction, position: neighborIndex + 1 },
      requestId: input.requestId,
    });
  });
}

// ---------------------------------------------------------------- settings

export async function getSiteSettings(prisma: PrismaClient): Promise<SiteSettings> {
  const row = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_SETTINGS;
  return {
    bookingEmail: row.bookingEmail || DEFAULT_SETTINGS.bookingEmail,
    generalEmail: row.generalEmail || DEFAULT_SETTINGS.generalEmail,
    copyrightEmail: row.copyrightEmail || DEFAULT_SETTINGS.copyrightEmail,
    socialLinks: readSocialLinks(row.socialLinks),
    version: row.version,
  };
}

export async function saveSiteSettings(
  prisma: PrismaClient,
  input: {
    actor: AuditActor;
    version: number;
    values: { bookingEmail: string; generalEmail: string; copyrightEmail: string; socialLinks: SocialLink[] };
  } & RequestMeta,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.siteSettings.findUnique({ where: { id: 1 } });
    if (!before) {
      // Only reachable if the seed row was removed; the editor showed defaults at version 1.
      if (input.version !== DEFAULT_SETTINGS.version) throw new ContentServiceError("CONFLICT");
      await tx.siteSettings.create({ data: { id: 1, ...input.values, version: 2 } });
    } else {
      const updated = await tx.siteSettings.updateMany({
        where: { id: 1, version: input.version },
        data: { ...input.values, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ContentServiceError("CONFLICT");
    }
    await writeAudit(tx, {
      actor: input.actor,
      action: "settings.update",
      targetType: "siteSettings",
      targetId: "1",
      before: before
        ? {
            bookingEmail: before.bookingEmail,
            generalEmail: before.generalEmail,
            copyrightEmail: before.copyrightEmail,
            socialLinks: readSocialLinks(before.socialLinks),
          }
        : undefined,
      after: input.values,
      requestId: input.requestId,
    });
  });
}
