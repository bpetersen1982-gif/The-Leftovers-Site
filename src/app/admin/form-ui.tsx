/** Shared admin form styling and messages, so every editor looks and behaves the same. */

export const INPUT_CLASS = "w-full border-2 border-ink bg-white/80 px-3 py-2 text-ink";
export const DARK_INPUT_CLASS = "w-full border-2 border-cream/60 bg-charcoal px-3 py-2 text-cream";
export const LABEL_CLASS = "block font-heading font-semibold tracking-wide uppercase";
export const SECONDARY_BUTTON =
  "border border-cream/70 px-3 py-1 font-heading tracking-wider uppercase hover:bg-cream hover:text-ink disabled:opacity-60";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-semibold text-red-text">
      {message}
    </p>
  );
}

export function FormMessage({ ok, message, onPaper = false }: { ok: boolean; message: string | null; onPaper?: boolean }) {
  if (!message) return null;
  const errorColor = onPaper ? "text-red-ui" : "text-red-text";
  return (
    <p role={ok ? "status" : "alert"} className={`font-semibold ${ok ? "" : errorColor}`}>
      {message}
    </p>
  );
}

/** Help text for the plain-text content format (see src/lib/content/blocks.ts). */
export function FormattingHelp({ id }: { id: string }) {
  return (
    <p id={id} className="mt-1 text-sm">
      Start a line with <code>## </code> for a heading, <code>- </code> for a bullet. Leave a blank line between paragraphs.
    </p>
  );
}
