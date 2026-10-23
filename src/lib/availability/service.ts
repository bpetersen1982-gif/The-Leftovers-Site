import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AvailabilityScope, Role } from "@/generated/prisma/enums";
import { type AuditActor, writeAudit } from "../audit";
import {
  type IsoDate,
  addDays,
  calendarHorizon,
  compareDates,
  daysBetween,
  fromUtc,
  isIsoDate,
  toDbDate,
  todayInBandTimeZone,
} from "../dates";
import { liveClaimWhere } from "../booking/claims";
import { can } from "../permissions";

/**
 * Availability (requirements §6.2, BOOK-19): members mark their own out-of-office ranges
 * (date shows "Limited"); Admins can also mark ranges for any member or for the whole
 * band (date shows "Unavailable").
 */

export const MAX_RANGE_DAYS = 366;
export const NOTE_MAX = 200;

export type AvailabilityErrorCode = "NOT_FOUND" | "FORBIDDEN";

export class AvailabilityError extends Error {
  override readonly name = "AvailabilityError";
  constructor(readonly code: AvailabilityErrorCode) {
    super(code === "NOT_FOUND" ? "That entry no longer exists." : "You can only change your own out-of-office dates.");
  }
}

const isoDate = z.string().trim().refine(isIsoDate, "Enter a valid date");

/** Builds the input schema relative to "today" so the past/horizon checks are testable. */
export function availabilityInputSchema(today: IsoDate) {
  return z
    .strictObject({
      scope: z.enum(["MEMBER", "BAND"]),
      userId: z.string().trim().max(64).optional(),
      startDate: isoDate,
      endDate: isoDate,
      note: z.string().trim().max(NOTE_MAX, `Note must be ${NOTE_MAX} characters or fewer`).default(""),
    })
    .superRefine((value, ctx) => {
      if (!isIsoDate(value.startDate) || !isIsoDate(value.endDate)) return;
      if (compareDates(value.endDate, value.startDate) < 0) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date can't be before the start date" });
      }
      if (compareDates(value.startDate, today) < 0) {
        ctx.addIssue({ code: "custom", path: ["startDate"], message: "Start date can't be in the past" });
      }
      // Members may plan further out than the public calendar shows (e.g. a known trip).
      if (compareDates(value.endDate, addDays(calendarHorizon(today), 366)) > 0) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "That's too far out" });
      }
      if (daysBetween(value.startDate, value.endDate) + 1 > MAX_RANGE_DAYS) {
        ctx.addIssue({ code: "custom", path: ["endDate"], message: "A single entry can cover at most a year" });
      }
      if (value.scope === "MEMBER" && !value.userId) {
        ctx.addIssue({ code: "custom", path: ["userId"], message: "Choose who is out" });
      }
    });
}

export type AvailabilityInput = z.infer<ReturnType<typeof availabilityInputSchema>>;

interface RequestMeta {
  readonly requestId?: string | null;
}

/**
 * Creates a block. Members can only create MEMBER blocks for themselves; Admins can
 * create for anyone, and BAND blocks. Enforced here, not just in the UI.
 */
export async function createAvailabilityBlock(
  prisma: PrismaClient,
  input: { actor: AuditActor; block: AvailabilityInput } & RequestMeta,
): Promise<string> {
  const { actor, block } = input;
  const ownerId = block.scope === "BAND" ? null : (block.userId ?? null);
  if (block.scope === "BAND" && !can(actor.role, "availability:manageBand")) throw new AvailabilityError("FORBIDDEN");
  if (ownerId !== actor.id && block.scope === "MEMBER" && !can(actor.role, "availability:manageAll")) {
    throw new AvailabilityError("FORBIDDEN");
  }

  return prisma.$transaction(async (tx) => {
    if (ownerId) {
      const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { deactivatedAt: true } });
      if (!owner || owner.deactivatedAt) throw new AvailabilityError("NOT_FOUND");
    }
    const created = await tx.availabilityBlock.create({
      data: {
        scope: block.scope,
        userId: ownerId,
        startDate: toDbDate(block.startDate),
        endDate: toDbDate(block.endDate),
        note: block.note,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor,
      action: "availability.create",
      targetType: "availabilityBlock",
      targetId: created.id,
      // Dates and scope only: the private note stays out of the audit log.
      after: { scope: block.scope, userId: ownerId, startDate: block.startDate, endDate: block.endDate },
      requestId: input.requestId,
    });
    return created.id;
  });
}

export async function deleteAvailabilityBlock(
  prisma: PrismaClient,
  input: { actor: AuditActor; id: string } & RequestMeta,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const block = await tx.availabilityBlock.findUnique({ where: { id: input.id } });
    if (!block) throw new AvailabilityError("NOT_FOUND");
    const isOwn = block.scope === "MEMBER" && block.userId === input.actor.id;
    if (!isOwn && !can(input.actor.role, "availability:manageAll")) throw new AvailabilityError("FORBIDDEN");
    await tx.availabilityBlock.delete({ where: { id: block.id } });
    await writeAudit(tx, {
      actor: input.actor,
      action: "availability.delete",
      targetType: "availabilityBlock",
      targetId: block.id,
      before: { scope: block.scope, userId: block.userId, startDate: fromUtc(block.startDate), endDate: fromUtc(block.endDate) },
      requestId: input.requestId,
    });
  });
}

// ---------------------------------------------------------------- reading

export interface AvailabilityEntry {
  readonly id: string;
  readonly scope: AvailabilityScope;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly userId: string | null;
  readonly userName: string | null;
  /** Only included for the owner and Admins. */
  readonly note: string | null;
  readonly canDelete: boolean;
}

/** Upcoming entries for the band's internal view (names visible; notes per viewer). */
export async function listUpcomingBlocks(
  prisma: PrismaClient,
  viewer: { id: string; role: Role },
  today: IsoDate = todayInBandTimeZone(),
): Promise<AvailabilityEntry[]> {
  const rows = await prisma.availabilityBlock.findMany({
    where: { endDate: { gte: toDbDate(today) } },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, scope: true, startDate: true, endDate: true, userId: true, note: true, user: { select: { name: true } } },
  });
  const isAdmin = can(viewer.role, "availability:manageAll");
  return rows.map((row) => {
    const isOwn = row.userId === viewer.id;
    return {
      id: row.id,
      scope: row.scope,
      startDate: fromUtc(row.startDate),
      endDate: fromUtc(row.endDate),
      userId: row.userId,
      userName: row.user?.name ?? null,
      note: isOwn || isAdmin ? row.note : null,
      canDelete: isAdmin || (row.scope === "MEMBER" && isOwn),
    };
  });
}

/** What the public sees for a date (requirements §6.2). */
export type PublicDayState = "available" | "limited" | "pending" | "booked" | "unavailable" | "past";

export const PUBLIC_DAY_LABELS: Record<PublicDayState, string> = {
  available: "Available",
  limited: "Limited availability",
  pending: "Pending",
  booked: "Booked",
  unavailable: "Unavailable",
  past: "Past",
};

/** Higher wins when several things apply to one date (§6.2 table, top to bottom). */
const PRIORITY: Record<PublicDayState, number> = { past: 6, unavailable: 5, booked: 4, pending: 3, limited: 2, available: 1 };

function raise(states: Map<IsoDate, PublicDayState>, date: IsoDate, next: PublicDayState): void {
  const current = states.get(date);
  if (current !== undefined && PRIORITY[next] > PRIORITY[current]) states.set(date, next);
}

/**
 * Computes the public state of every date in [from, to]. Exposes no names, notes,
 * venues, or counts: only the state per day.
 */
export async function publicDayStates(
  prisma: Pick<PrismaClient, "availabilityBlock" | "dateClaim">,
  range: { from: IsoDate; to: IsoDate },
  today: IsoDate = todayInBandTimeZone(),
  now: Date = new Date(),
): Promise<Map<IsoDate, PublicDayState>> {
  const [blocks, claims] = await Promise.all([
    prisma.availabilityBlock.findMany({
      where: { startDate: { lte: toDbDate(range.to) }, endDate: { gte: toDbDate(range.from) } },
      select: { scope: true, startDate: true, endDate: true },
    }),
    prisma.dateClaim.findMany({
      where: { date: { gte: toDbDate(range.from), lte: toDbDate(range.to) }, ...liveClaimWhere(now) },
      select: { date: true, kind: true },
    }),
  ]);

  const states = new Map<IsoDate, PublicDayState>();
  for (let date = range.from; compareDates(date, range.to) <= 0; date = addDays(date, 1)) {
    states.set(date, compareDates(date, today) < 0 ? "past" : "available");
  }
  for (const block of blocks) {
    const end = fromUtc(block.endDate);
    for (let date = fromUtc(block.startDate); compareDates(date, end) <= 0; date = addDays(date, 1)) {
      raise(states, date, block.scope === "BAND" ? "unavailable" : "limited");
    }
  }
  for (const claim of claims) raise(states, fromUtc(claim.date), claim.kind === "BOOKED" ? "booked" : "pending");
  return states;
}

/** State of a single date. */
export async function publicDayState(
  prisma: Pick<PrismaClient, "availabilityBlock" | "dateClaim">,
  date: IsoDate,
  today: IsoDate = todayInBandTimeZone(),
  now: Date = new Date(),
): Promise<PublicDayState> {
  return (await publicDayStates(prisma, { from: date, to: date }, today, now)).get(date) ?? "unavailable";
}
