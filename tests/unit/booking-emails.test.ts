import { describe, expect, it } from "vitest";
import { bandEmail, bandPushPayload, formatTime } from "@/lib/booking/notifications";
import { subscriptionSchema, vapidConfig } from "@/lib/push";
import { CONFIRM_TEMPLATE, DECLINE_TEMPLATE } from "@/lib/booking/prospect-emails";
import { bookingFromAddress } from "@/lib/mail/mailer";
import { performanceMinutes, phoneSchema, setsMismatch, suggestedSets, timeSchema, whenSchema } from "@/lib/booking/validation";

const summary = {
  requestId: "req-1",
  reference: "LO-ABC234",
  isConflict: true,
  date: "2026-11-14",
  startTime: "20:00",
  endTime: "00:00",
  sets: 4,
  eventTypeLabel: "Bar / club",
  contactName: "Pat <b>Venue</b>",
  email: "pat@example.test",
  phone: "(402) 555-0123",
  organization: "The Zoo Bar",
  place: "Lincoln, NE",
  distanceMiles: 0.3,
  message: "",
  responseNote: "",
  totalCents: 160_000,
};

describe("band notification emails", () => {
  it("flags conflicts in the subject and links to the request", () => {
    const email = bandEmail("NEW_REQUEST", summary, { email: "erik@example.test", role: "ADMIN" }, "https://theleftoversband.com");
    expect(email.subject).toBe("[CONFLICT] New booking request: Saturday, November 14, 2026 · Bar / club · 4 sets");
    expect(email.text).toContain("https://theleftoversband.com/admin/bookings/req-1");
    expect(email.text).toContain("8:00 PM–12:00 AM");
  });

  it("shows the price to Admins only", () => {
    const admin = bandEmail("QUOTE_ACCEPTED", summary, { email: "a@example.test", role: "ADMIN" }, "https://x.test");
    const member = bandEmail("QUOTE_ACCEPTED", summary, { email: "m@example.test", role: "MEMBER" }, "https://x.test");
    expect(admin.text).toContain("$1,600");
    expect(member.text).not.toContain("$1,600");
    expect(member.html).not.toContain("1,600");
    expect(member.text).toContain("(402) 555-0123"); // Members do see contact info.
  });

  it("escapes prospect-supplied text in HTML", () => {
    const email = bandEmail("NEW_REQUEST", summary, { email: "a@example.test", role: "ADMIN" }, "https://x.test");
    expect(email.html).not.toContain("<b>Venue</b>");
    expect(email.html).toContain("&lt;b&gt;Venue&lt;/b&gt;");
  });
});

describe("booking form helpers", () => {
  it("handles performances that cross midnight", () => {
    expect(performanceMinutes("20:00", "00:00")).toBe(240);
    expect(performanceMinutes("21:00", "01:30")).toBe(270);
    expect(performanceMinutes("14:00", "16:00")).toBe(120);
  });

  it("suggests about one set per hour and warns on mismatches", () => {
    expect(suggestedSets("20:00", "00:00", 4)).toBe(4);
    expect(suggestedSets("20:00", "00:30", 4)).toBe(4);
    expect(suggestedSets("18:00", "02:00", 4)).toBe(4); // capped at max
    expect(suggestedSets("20:00", "20:45", 4)).toBe(1);
    expect(setsMismatch("20:00", "21:00", 4)).toBe(true);
    expect(setsMismatch("20:00", "00:30", 4)).toBe(false);
  });

  it("formats times", () => {
    expect(formatTime("20:00")).toBe("8:00 PM");
    expect(formatTime("00:15")).toBe("12:15 AM");
  });

  it("validates times, phones, and the when step", () => {
    expect(timeSchema.safeParse("20:15").success).toBe(true);
    expect(timeSchema.safeParse("20:10").success).toBe(false);
    expect(phoneSchema.parse("402.555.0123")).toBe("(402) 555-0123");
    expect(phoneSchema.parse("+1 402 555 0123")).toBe("(402) 555-0123");
    expect(phoneSchema.safeParse("555-0123").success).toBe(false);
    const schema = whenSchema("2026-10-23", { minSets: 1, maxSets: 4 });
    const base = { flexible: false, eventDate: "2026-11-14", startTime: "20:00", endTime: "00:00", sets: "4", eventType: "WEDDING" };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, eventDate: "2026-10-22" }).success).toBe(false);
    expect(schema.safeParse({ ...base, eventDate: "2028-05-01" }).success).toBe(false);
    expect(schema.safeParse({ ...base, sets: "5" }).success).toBe(false);
    expect(schema.safeParse({ ...base, endTime: "20:00" }).success).toBe(false);
    expect(schema.safeParse({ ...base, flexible: true, eventDate: "" }).success).toBe(true);
    expect(schema.safeParse({ ...base, eventType: "RAVE" }).success).toBe(false);
  });
});

describe("prospect emails", () => {
  it("sends booking mail from booking@ on the verified sending domain", () => {
    expect(bookingFromAddress("The Leftovers <no-reply@mail.theleftoversband.com>")).toBe("The Leftovers Booking <booking@mail.theleftoversband.com>");
    expect(bookingFromAddress("no-reply@example.test")).toBe("The Leftovers Booking <booking@example.test>");
    expect(() => bookingFromAddress("nobody")).toThrow();
  });

  it("builds editable decline and confirmation drafts", () => {
    expect(DECLINE_TEMPLATE("Saturday, November 14, 2026")).toContain("for Saturday, November 14, 2026");
    const confirm = CONFIRM_TEMPLATE({ date: "Sat", time: "8:00 PM–12:00 AM", loadIn: null, sets: 4, price: "$1,500" });
    expect(confirm).toContain("Agreed price: $1,500");
    expect(confirm).not.toContain("Load-in");
  });
});

describe("phone push alerts", () => {
  it("never puts names, phones, emails, or prices on the lock screen", () => {
    const payload = bandPushPayload("QUOTE_ACCEPTED", summary);
    const text = JSON.stringify(payload);
    expect(payload).toEqual({
      title: "CONFLICT · Quote accepted: confirm this gig",
      body: "Sat, Nov 14, 2026 · Bar / club · 4 sets",
      url: "/admin/bookings/req-1",
      tag: "booking-req-1",
    });
    for (const secret of ["Pat", "402", "pat@example.test", "1,600", "Zoo Bar"]) expect(text).not.toContain(secret);
  });

  it("push is optional: no VAPID keys means no push config", () => {
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "mailto:x@example.test" })).toEqual({
      publicKey: "p",
      privateKey: "k",
      subject: "mailto:x@example.test",
    });
  });

  it("only accepts https push endpoints", () => {
    const base = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "a", auth: "b" } };
    expect(subscriptionSchema.safeParse(base).success).toBe(true);
    expect(subscriptionSchema.safeParse({ ...base, endpoint: "http://evil.example/x" }).success).toBe(false);
  });
});
