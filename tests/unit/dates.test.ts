import { describe, expect, it } from "vitest";
import { availabilityInputSchema } from "@/lib/availability/service";
import {
  addDays,
  addMonths,
  calendarHorizon,
  calendarMonths,
  datesInMonth,
  daysBetween,
  formatDateRange,
  isIsoDate,
  monthGrid,
  todayInBandTimeZone,
} from "@/lib/dates";

describe("calendar dates", () => {
  it("uses the band's timezone for today", () => {
    // 03:30 UTC on Oct 23 is still Oct 22 in Lincoln (CDT, UTC-5).
    expect(todayInBandTimeZone(new Date("2026-10-23T03:30:00Z"))).toBe("2026-10-22");
    expect(todayInBandTimeZone(new Date("2026-10-23T05:30:00Z"))).toBe("2026-10-23");
  });

  it("does day and month math without DST drift", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02"); // DST ends Nov 1, 2026
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15"); // DST starts Mar 14, 2027
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("validates real dates only", () => {
    expect(isIsoDate("2027-02-28")).toBe(true);
    for (const bad of ["2027-02-30", "2027-13-01", "27-01-01", "2027-1-1", ""]) expect(isIsoDate(bad)).toBe(false);
  });

  it("covers 18 months ahead", () => {
    expect(calendarHorizon("2026-10-23")).toBe("2028-04-22");
    const months = calendarMonths("2026-10-23");
    expect(months[0]).toBe("2026-10");
    expect(months.at(-1)).toBe("2028-04");
    expect(months).toHaveLength(19);
  });

  it("builds Sunday-first month grids", () => {
    const grid = monthGrid("2027-05"); // May 1, 2027 is a Saturday
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2027-05-01"]);
    expect(grid.flat().filter(Boolean)).toEqual(datesInMonth("2027-05"));
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it("formats ranges", () => {
    expect(formatDateRange("2027-06-12", "2027-06-12")).toBe("Sat, Jun 12, 2027");
    expect(formatDateRange("2027-06-12", "2027-06-14")).toBe("Sat, Jun 12, 2027 – Mon, Jun 14, 2027");
  });
});

describe("availability input", () => {
  const schema = availabilityInputSchema("2026-10-23");
  const base = { scope: "MEMBER", userId: "u1", startDate: "2026-11-01", endDate: "2026-11-03", note: "" };

  it("accepts a valid range, including starting today", () => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, startDate: "2026-10-23", endDate: "2026-10-23" }).success).toBe(true);
  });

  it("rejects backwards, past, too-long, and invalid ranges", () => {
    expect(schema.safeParse({ ...base, endDate: "2026-10-31" }).success).toBe(false);
    expect(schema.safeParse({ ...base, startDate: "2026-10-22" }).success).toBe(false);
    expect(schema.safeParse({ ...base, endDate: "2027-12-01" }).success).toBe(false);
    expect(schema.safeParse({ ...base, startDate: "2026-02-30" }).success).toBe(false);
    expect(schema.safeParse({ ...base, note: "x".repeat(201) }).success).toBe(false);
  });

  it("requires a member for MEMBER scope and rejects unknown fields", () => {
    expect(schema.safeParse({ ...base, userId: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...base, scope: "BAND", userId: undefined }).success).toBe(true);
    expect(schema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});
