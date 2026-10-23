import { describe, expect, it } from "vitest";
import { type EligibilityInput, dayCategoryOf, evaluateEligibility, formatCents, rateKey } from "@/lib/booking/eligibility";
import { haversineMiles, milesBetweenZips, parseZctaCsv } from "@/lib/booking/zip-distance";

const base: EligibilityInput = {
  date: "2027-06-12", // Saturday
  today: "2027-05-01",
  eventType: "WEDDING",
  sets: 3,
  distanceMiles: 20,
  dateIsOpen: true,
  rules: { minSets: 1, maxSets: 4, minNoticeDays: 7, travelRadiusMiles: 60 },
  rates: new Map([[rateKey("WEDDING", "FRI_SAT"), 50_000]]),
  specialDates: new Set(),
};

describe("day categories", () => {
  it("splits Fri–Sat from Sun–Thu and honors special dates", () => {
    expect(dayCategoryOf("2027-06-11", new Set())).toBe("FRI_SAT"); // Friday
    expect(dayCategoryOf("2027-06-12", new Set())).toBe("FRI_SAT"); // Saturday
    expect(dayCategoryOf("2027-06-13", new Set())).toBe("SUN_THU"); // Sunday
    expect(dayCategoryOf("2027-06-10", new Set())).toBe("SUN_THU"); // Thursday
    expect(dayCategoryOf("2027-12-31", new Set(["2027-12-31"]))).toBe("SPECIAL");
  });
});

describe("eligibility", () => {
  it("quotes sets × rate when every rule passes", () => {
    expect(evaluateEligibility(base)).toEqual({ eligible: true, dayCategory: "FRI_SAT", ratePerSetCents: 50_000, totalCents: 150_000 });
  });

  it("requires a rate for that exact event type and day category", () => {
    expect(evaluateEligibility({ ...base, date: "2027-06-13" })).toMatchObject({ eligible: false, reasons: ["NO_RATE"] });
    expect(evaluateEligibility({ ...base, eventType: "BAR_CLUB" })).toMatchObject({ eligible: false, reasons: ["NO_RATE"] });
  });

  it("never quotes 'Other' events, even if a rate exists", () => {
    const rates = new Map([[rateKey("OTHER", "FRI_SAT"), 1]]);
    expect(evaluateEligibility({ ...base, eventType: "OTHER", rates })).toMatchObject({ eligible: false, reasons: ["NO_RATE"] });
  });

  it("enforces minimum notice at the boundary", () => {
    expect(evaluateEligibility({ ...base, today: "2027-06-05" }).eligible).toBe(true); // exactly 7 days
    expect(evaluateEligibility({ ...base, today: "2027-06-06" })).toMatchObject({ eligible: false, reasons: ["TOO_SOON"] });
    expect(evaluateEligibility({ ...base, today: "2027-06-13" })).toMatchObject({ eligible: false, reasons: ["TOO_SOON"] });
  });

  it("enforces the travel radius and treats unknown ZIPs as ineligible", () => {
    expect(evaluateEligibility({ ...base, distanceMiles: 60 }).eligible).toBe(true);
    expect(evaluateEligibility({ ...base, distanceMiles: 60.1 })).toMatchObject({ eligible: false, reasons: ["TOO_FAR"] });
    expect(evaluateEligibility({ ...base, distanceMiles: null })).toMatchObject({ eligible: false, reasons: ["LOCATION_UNKNOWN"] });
  });

  it("requires the date to be open and sets within range", () => {
    expect(evaluateEligibility({ ...base, dateIsOpen: false })).toMatchObject({ eligible: false, reasons: ["DATE_NOT_OPEN"] });
    expect(evaluateEligibility({ ...base, sets: 5 })).toMatchObject({ eligible: false, reasons: ["SETS_OUT_OF_RANGE"] });
    expect(evaluateEligibility({ ...base, sets: 0 })).toMatchObject({ eligible: false, reasons: ["SETS_OUT_OF_RANGE"] });
    expect(evaluateEligibility({ ...base, sets: 2.5 })).toMatchObject({ eligible: false, reasons: ["SETS_OUT_OF_RANGE"] });
  });

  it("reports every failing rule", () => {
    const result = evaluateEligibility({ ...base, distanceMiles: 200, dateIsOpen: false, today: "2027-06-10" });
    expect(result).toMatchObject({ eligible: false, reasons: ["TOO_SOON", "TOO_FAR", "DATE_NOT_OPEN"] });
  });

  it("formats whole dollars", () => {
    expect(formatCents(150_000)).toBe("$1,500");
  });
});

describe("ZIP distances", () => {
  it("parses the CSV format and skips junk rows", () => {
    const map = parseZctaCsv("zip,lat,lng\n68508,40.81,-96.70\nbad,1,2\n68434,40.9,-97.1\n");
    expect([...map.keys()]).toEqual(["68508", "68434"]);
  });

  it("matches the spot checks in data/zcta/README.md", async () => {
    expect(await milesBetweenZips("68508", "68434")).toBeCloseTo(22.7, 0);
    expect(await milesBetweenZips("68508", "68601")).toBeCloseTo(57, 0);
    expect(await milesBetweenZips("68508", "68801")).toBeCloseTo(84, 0);
    expect(await milesBetweenZips("68508", "00000")).toBeNull();
    expect(await milesBetweenZips("68508", "abc")).toBeNull();
  });

  it("computes zero distance for the same point", () => {
    expect(haversineMiles({ lat: 40.8, lng: -96.7 }, { lat: 40.8, lng: -96.7 })).toBe(0);
  });
});
