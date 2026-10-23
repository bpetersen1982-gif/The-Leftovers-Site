import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/enums";
import {
  AvailabilityError,
  createAvailabilityBlock,
  deleteAvailabilityBlock,
  listUpcomingBlocks,
  publicDayStates,
} from "@/lib/availability/service";
import { createTestClient, resetDatabase } from "../support/test-db";

const prisma = createTestClient();
const TODAY = "2026-10-23";

async function makeUser(role: Role, name: string) {
  const user = await prisma.user.create({ data: { id: randomUUID(), email: `${randomUUID()}@example.test`, name, role } });
  return { id: user.id, role: user.role };
}

const block = (overrides: Record<string, unknown> = {}) => ({
  scope: "MEMBER" as const,
  startDate: "2026-11-06",
  endDate: "2026-11-07",
  note: "Cousin's wedding",
  ...overrides,
});

async function expectCode(promise: Promise<unknown>, code: AvailabilityError["code"]) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof AvailabilityError && error.code === code);
}

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("permissions", () => {
  it("members manage only their own dates; only Admins can mark others or the whole band", async () => {
    const admin = await makeUser("ADMIN", "Erik");
    const jake = await makeUser("MEMBER", "Jake");
    const mike = await makeUser("MEMBER", "Mike");

    const own = await createAvailabilityBlock(prisma, { actor: jake, block: block({ userId: jake.id }) });
    await expectCode(createAvailabilityBlock(prisma, { actor: jake, block: block({ userId: mike.id }) }), "FORBIDDEN");
    await expectCode(createAvailabilityBlock(prisma, { actor: jake, block: block({ scope: "BAND" }) }), "FORBIDDEN");
    const forMike = await createAvailabilityBlock(prisma, { actor: admin, block: block({ userId: mike.id }) });
    await createAvailabilityBlock(prisma, { actor: admin, block: block({ scope: "BAND" }) });

    await expectCode(deleteAvailabilityBlock(prisma, { actor: jake, id: forMike }), "FORBIDDEN");
    await deleteAvailabilityBlock(prisma, { actor: jake, id: own });
    await deleteAvailabilityBlock(prisma, { actor: admin, id: forMike });
    expect(await prisma.availabilityBlock.count()).toBe(1);
  });

  it("refuses dates for removed users", async () => {
    const admin = await makeUser("ADMIN", "Erik");
    const gone = await makeUser("MEMBER", "Gone");
    await prisma.user.update({ where: { id: gone.id }, data: { deactivatedAt: new Date() } });
    await expectCode(createAvailabilityBlock(prisma, { actor: admin, block: block({ userId: gone.id }) }), "NOT_FOUND");
  });
});

describe("database constraints", () => {
  it("rejects backwards ranges and scope/owner mismatches even if the app is bypassed", async () => {
    const admin = await makeUser("ADMIN", "Erik");
    const base = { createdById: admin.id, note: "" };
    await expect(
      prisma.availabilityBlock.create({
        data: { ...base, scope: "MEMBER", userId: admin.id, startDate: new Date("2026-11-07"), endDate: new Date("2026-11-06") },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.availabilityBlock.create({
        data: { ...base, scope: "BAND", userId: admin.id, startDate: new Date("2026-11-07"), endDate: new Date("2026-11-07") },
      }),
    ).rejects.toThrow();
  });
});

describe("internal list", () => {
  it("shows names to the band, notes only to the owner and Admins", async () => {
    const admin = await makeUser("ADMIN", "Erik");
    const jake = await makeUser("MEMBER", "Jake");
    const mike = await makeUser("MEMBER", "Mike");
    await createAvailabilityBlock(prisma, { actor: jake, block: block({ userId: jake.id }) });

    const asMike = await listUpcomingBlocks(prisma, mike, TODAY);
    expect(asMike[0]).toMatchObject({ userName: "Jake", note: null, canDelete: false });
    expect((await listUpcomingBlocks(prisma, jake, TODAY))[0]).toMatchObject({ note: "Cousin's wedding", canDelete: true });
    expect((await listUpcomingBlocks(prisma, admin, TODAY))[0]).toMatchObject({ note: "Cousin's wedding", canDelete: true });
  });

  it("drops entries that have ended", async () => {
    const jake = await makeUser("MEMBER", "Jake");
    await createAvailabilityBlock(prisma, { actor: jake, block: block({ userId: jake.id }) });
    expect(await listUpcomingBlocks(prisma, jake, "2026-11-08")).toEqual([]);
  });
});

describe("public day states", () => {
  it("member out = limited, band off = unavailable (wins), past = past, else available", async () => {
    const admin = await makeUser("ADMIN", "Erik");
    const jake = await makeUser("MEMBER", "Jake");
    await createAvailabilityBlock(prisma, { actor: jake, block: block({ userId: jake.id, startDate: "2026-11-06", endDate: "2026-11-08" }) });
    await createAvailabilityBlock(prisma, { actor: admin, block: block({ scope: "BAND", startDate: "2026-11-08", endDate: "2026-11-08" }) });

    const states = await publicDayStates(prisma, { from: "2026-10-22", to: "2026-11-09" }, TODAY);
    expect(states.get("2026-10-22")).toBe("past");
    expect(states.get("2026-10-23")).toBe("available");
    expect(states.get("2026-11-06")).toBe("limited");
    expect(states.get("2026-11-07")).toBe("limited");
    expect(states.get("2026-11-08")).toBe("unavailable");
    expect(states.get("2026-11-09")).toBe("available");
  });

  it("includes blocks that only partly overlap the requested range", async () => {
    const jake = await makeUser("MEMBER", "Jake");
    await createAvailabilityBlock(prisma, { actor: jake, block: block({ userId: jake.id, startDate: "2026-10-30", endDate: "2026-11-02" }) });
    const states = await publicDayStates(prisma, { from: "2026-11-01", to: "2026-11-30" }, TODAY);
    expect(states.get("2026-11-01")).toBe("limited");
    expect(states.get("2026-11-03")).toBe("available");
  });
});
