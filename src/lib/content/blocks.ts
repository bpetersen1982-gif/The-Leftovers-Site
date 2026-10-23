import { z } from "zod";

/**
 * Structured page content (requirements CNT-2). Content is stored as an array of plain-text
 * blocks, never HTML, and rendered by React (which escapes everything). That makes stored
 * XSS impossible by construction while still giving Admins headings, paragraphs, and lists.
 *
 * Admins edit with a simple text format:
 *   ## Heading
 *   Paragraph text (blank line between paragraphs)
 *   - list item
 */

export const BLOCK_TEXT_MAX = 2_000;
export const MAX_BLOCKS = 200;
export const SOURCE_MAX = 20_000;

const text = z.string().min(1).max(BLOCK_TEXT_MAX);

export const blockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("heading"), text }),
  z.strictObject({ type: z.literal("paragraph"), text }),
  z.strictObject({ type: z.literal("list"), items: z.array(text).min(1).max(50) }),
]);

export const blocksSchema = z.array(blockSchema).max(MAX_BLOCKS);

export type Block = z.infer<typeof blockSchema>;

/** Strips control characters (except newline/tab handling done by the parser). */
function clean(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

/** Parses the Admin text format into blocks. Pure; callers validate the result with blocksSchema. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = clean(rawLine);
    if (line === "") {
      flushParagraph();
      flushList();
    } else if (line.startsWith("## ") || line.startsWith("# ")) {
      flushParagraph();
      flushList();
      const heading = line.replace(/^#{1,2}\s+/, "");
      if (heading) blocks.push({ type: "heading", text: heading });
    } else if (/^[-*•]\s+/.test(line)) {
      flushParagraph();
      const item = line.replace(/^[-*•]\s+/, "");
      if (item) list.push(item);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Inverse of parseBlocks, for loading stored content back into the editor. */
export function blocksToSource(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `## ${block.text}`;
        case "paragraph":
          return block.text;
        case "list":
          return block.items.map((item) => `- ${item}`).join("\n");
      }
    })
    .join("\n\n");
}

/** Reads stored JSON defensively: anything malformed renders as empty rather than crashing a page. */
export function readBlocks(value: unknown): Block[] {
  const parsed = blocksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Validates editor input end to end. */
export const blockSourceSchema = z
  .string()
  .max(SOURCE_MAX, `Content must be ${SOURCE_MAX.toLocaleString("en-US")} characters or fewer`)
  .transform((source, ctx) => {
    const parsed = blocksSchema.safeParse(parseBlocks(source));
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `Each paragraph must be under ${BLOCK_TEXT_MAX} characters, with at most ${MAX_BLOCKS} sections` });
      return z.NEVER;
    }
    return parsed.data;
  });
