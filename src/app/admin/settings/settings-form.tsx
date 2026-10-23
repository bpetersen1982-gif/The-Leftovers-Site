"use client";

import { useActionForm } from "../use-action-form";

import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_KEYS } from "@/lib/content/settings";
import { type SaveState, saveSettingsAction } from "../content-actions";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS } from "../form-ui";

interface Initial {
  readonly bookingEmail: string;
  readonly generalEmail: string;
  readonly copyrightEmail: string;
  readonly social: Partial<Record<string, string>>;
  readonly version: number;
}

const EMAIL_FIELDS = [
  { name: "bookingEmail", label: "Booking email", help: "Shown on the home page, header, and contact page." },
  { name: "generalEmail", label: "General email", help: "Shown on the contact page." },
  { name: "copyrightEmail", label: "Copyright email", help: "Shown on the copyright page for takedown notices." },
] as const;

export function SettingsForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionForm<SaveState>(saveSettingsAction, {
    ok: false,
    message: null,
    version: initial.version,
  });
  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <form onSubmit={formAction} className="max-w-xl space-y-8">
      <input type="hidden" name="version" value={state.version ?? initial.version} />

      <fieldset className="space-y-4">
        <legend className="font-heading text-xl font-bold tracking-wider uppercase">Contact emails</legend>
        {EMAIL_FIELDS.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className={LABEL_CLASS}>
              {field.label}
            </label>
            <input id={field.name} name={field.name} type="email" required maxLength={254} defaultValue={initial[field.name]}
              aria-invalid={Boolean(error(field.name))} aria-describedby={`${field.name}-help${error(field.name) ? ` ${field.name}-error` : ""}`}
              className={DARK_INPUT_CLASS} />
            <p id={`${field.name}-help`} className="mt-1 text-sm text-cream/90">{field.help}</p>
            <FieldError id={`${field.name}-error`} message={error(field.name)} />
          </div>
        ))}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-heading text-xl font-bold tracking-wider uppercase">Social links</legend>
        <p className="text-sm text-cream/90">Full https links. Leave blank to hide a platform.</p>
        {SOCIAL_PLATFORM_KEYS.map((platform) => {
          const name = `social.${platform}`;
          return (
            <div key={platform}>
              <label htmlFor={name} className={LABEL_CLASS}>
                {SOCIAL_PLATFORMS[platform].label}
              </label>
              <input id={name} name={name} type="url" inputMode="url" maxLength={300} defaultValue={initial.social[platform] ?? ""}
                placeholder={`https://${SOCIAL_PLATFORMS[platform].hosts[0]}/…`}
                aria-invalid={Boolean(error(name))} aria-describedby={error(name) ? `${name}-error` : undefined}
                className={DARK_INPUT_CLASS} />
              <FieldError id={`${name}-error`} message={error(name)} />
            </div>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Saving…" : "Save settings"}
        </button>
        <FormMessage ok={state.ok} message={state.message} />
      </div>
    </form>
  );
}
