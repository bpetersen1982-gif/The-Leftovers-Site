import type { ReactNode } from "react";

/** Public form styling (cream paper panel). Errors use the darker red that passes AA on cream. */
export const PUBLIC_INPUT = "w-full border-2 border-ink bg-white/85 px-3 py-2 text-ink";
export const PUBLIC_LABEL = "block font-heading font-semibold tracking-wide uppercase";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={PUBLIC_LABEL}>
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-red-ui">
          {error}
        </p>
      )}
    </div>
  );
}

/** aria props for an input inside <Field>. */
export function fieldAria(id: string, error?: string, hint?: boolean) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return { id, "aria-invalid": Boolean(error), "aria-describedby": describedBy || undefined };
}

/** Hidden from people and assistive tech; bots fill it in (spam honeypot). */
export function Honeypot({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  return (
    <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
      <label htmlFor="website">Website</label>
      <input
        id="website"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        {...(onChange ? { value: value ?? "", onChange: (event) => onChange(event.target.value) } : {})}
      />
    </div>
  );
}
