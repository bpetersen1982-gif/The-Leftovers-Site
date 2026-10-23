import { describe, expect, it } from "vitest";
import { blockSourceSchema, blocksToSource, parseBlocks, readBlocks } from "@/lib/content/blocks";
import { memberInputSchema } from "@/lib/content/members";
import { PAGES, PAGE_SLUGS } from "@/lib/content/pages";
import { readSocialLinks, siteSettingsInputSchema, socialLinkSchema } from "@/lib/content/settings";
import { blocksSchema } from "@/lib/content/blocks";

describe("content blocks", () => {
  it("parses headings, paragraphs, and lists", () => {
    const blocks = parseBlocks("## Who we are\n\nWe play loud.\nReally loud.\n\n- Bars\n- Weddings\n\nThe end.");
    expect(blocks).toEqual([
      { type: "heading", text: "Who we are" },
      { type: "paragraph", text: "We play loud. Really loud." },
      { type: "list", items: ["Bars", "Weddings"] },
      { type: "paragraph", text: "The end." },
    ]);
  });

  it("round-trips through the editor format", () => {
    const source = "## Heading\n\nParagraph one.\n\n- a\n- b";
    expect(blocksToSource(parseBlocks(source))).toBe(source);
  });

  it("keeps HTML as literal text (React escapes it on render)", () => {
    expect(parseBlocks("<script>alert(1)</script>")).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });

  it("strips control characters and handles empty input", () => {
    expect(parseBlocks("a\u0000b\r\n\r\n")).toEqual([{ type: "paragraph", text: "ab" }]);
    expect(parseBlocks("   \n\n")).toEqual([]);
  });

  it("rejects oversized content", () => {
    expect(blockSourceSchema.safeParse("x".repeat(20_001)).success).toBe(false);
    expect(blockSourceSchema.safeParse("x".repeat(2_001)).success).toBe(false);
    expect(blockSourceSchema.safeParse("fine").success).toBe(true);
  });

  it("reads malformed stored JSON as empty instead of crashing", () => {
    expect(readBlocks([{ type: "html", html: "<b>x</b>" }])).toEqual([]);
    expect(readBlocks("nope")).toEqual([]);
  });

  it("ships valid default copy for every page", () => {
    for (const slug of PAGE_SLUGS) expect(blocksSchema.safeParse(PAGES[slug].defaultContent).success).toBe(true);
  });
});

describe("social links", () => {
  it("only allows https links on the platform's own domain", () => {
    expect(socialLinkSchema.safeParse({ platform: "instagram", url: "https://www.instagram.com/theleftovers" }).success).toBe(true);
    expect(socialLinkSchema.safeParse({ platform: "instagram", url: "http://instagram.com/x" }).success).toBe(false);
    expect(socialLinkSchema.safeParse({ platform: "instagram", url: "https://evil.example/instagram.com" }).success).toBe(false);
    expect(socialLinkSchema.safeParse({ platform: "instagram", url: "javascript:alert(1)" }).success).toBe(false);
    expect(socialLinkSchema.safeParse({ platform: "myspace", url: "https://myspace.com/x" }).success).toBe(false);
  });

  it("drops invalid stored links", () => {
    expect(readSocialLinks([{ platform: "facebook", url: "https://facebook.com/x" }, { platform: "x", url: "ftp://x" }, 3])).toEqual([
      { platform: "facebook", url: "https://facebook.com/x" },
    ]);
  });

  it("validates the settings form strictly", () => {
    const valid = { bookingEmail: "booking@x.test", generalEmail: "hi@x.test", copyrightEmail: "c@x.test", socialLinks: [], version: "3" };
    expect(siteSettingsInputSchema.parse(valid).version).toBe(3);
    expect(siteSettingsInputSchema.safeParse({ ...valid, bookingEmail: "nope" }).success).toBe(false);
    expect(siteSettingsInputSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });
});

describe("band member input", () => {
  it("accepts a name with an empty instrument and bio", () => {
    expect(memberInputSchema.parse({ name: "Jake Meyers", instrument: "", bio: "", isVisible: true }).bio).toEqual([]);
  });

  it("rejects markup in names and instruments", () => {
    expect(memberInputSchema.safeParse({ name: "<b>Jake</b>", instrument: "", bio: "", isVisible: true }).success).toBe(false);
    expect(memberInputSchema.safeParse({ name: "Jake", instrument: "<i>bass</i>", bio: "", isVisible: true }).success).toBe(false);
    expect(memberInputSchema.safeParse({ name: "Jake", instrument: "Guitar & vocals", bio: "", isVisible: true }).success).toBe(true);
  });
});
