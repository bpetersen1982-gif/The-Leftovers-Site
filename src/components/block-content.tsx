import type { Block } from "@/lib/content/blocks";

/**
 * Renders stored content blocks. Text goes through React, which escapes it, so content
 * can never inject markup. `tone` picks colors for dark pages vs. cream paper panels.
 */
export function BlockContent({ blocks, tone = "dark" }: { blocks: readonly Block[]; tone?: "dark" | "paper" }) {
  const heading = tone === "dark" ? "text-cream" : "text-ink";
  return (
    <div className="space-y-4 leading-relaxed">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <h2 key={index} className={`pt-2 font-heading text-2xl font-bold tracking-wider uppercase ${heading}`}>
                {block.text}
              </h2>
            );
          case "paragraph":
            return <p key={index}>{block.text}</p>;
          case "list":
            return (
              <ul key={index} className="list-disc space-y-1 pl-6">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            );
        }
      })}
    </div>
  );
}
