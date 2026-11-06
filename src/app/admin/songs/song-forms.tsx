"use client";

import { useEffect, useId, useRef } from "react";
import { INITIAL_ACTION_STATE } from "../action-state";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { createSongAction, importSongsAction, updateSongAction } from "./actions";

export interface EditableSong {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly artist: string;
  readonly year: number | null;
  readonly note: string;
  readonly isVisible: boolean;
}

function Fields({ song, errors }: { song?: EditableSong; errors?: Partial<Record<string, string>> }) {
  const prefix = useId();
  const field = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    className: DARK_INPUT_CLASS,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr]">
      <div>
        <label htmlFor={`${prefix}-title`} className={LABEL_CLASS}>
          Song
        </label>
        <input {...field("title")} required maxLength={120} defaultValue={song?.title} />
        <FieldError id={`${prefix}-title-error`} message={errors?.title} />
      </div>
      <div>
        <label htmlFor={`${prefix}-artist`} className={LABEL_CLASS}>
          Artist
        </label>
        <input {...field("artist")} required maxLength={120} defaultValue={song?.artist} />
        <FieldError id={`${prefix}-artist-error`} message={errors?.artist} />
      </div>
      <div>
        <label htmlFor={`${prefix}-year`} className={LABEL_CLASS}>
          Year
        </label>
        <input {...field("year")} inputMode="numeric" maxLength={4} defaultValue={song?.year ?? ""} placeholder="1997" />
        <FieldError id={`${prefix}-year-error`} message={errors?.year} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${prefix}-note`} className={LABEL_CLASS}>
          Note (optional, public)
        </label>
        <input {...field("note")} maxLength={200} defaultValue={song?.note} placeholder="e.g. Popular first dance" />
        <FieldError id={`${prefix}-note-error`} message={errors?.note} />
      </div>
      <label className="flex items-center gap-2 self-end pb-2">
        <input type="checkbox" name="isVisible" defaultChecked={song?.isVisible ?? true} className="size-5" />
        Show publicly
      </label>
    </div>
  );
}

export function AddSongForm() {
  const [state, onSubmit, pending] = useActionForm(createSongAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  // Clear for the next song after a successful add; on errors the typed values stay.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      formRef.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    }
  }, [state]);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <Fields errors={state.fieldErrors} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        Add song
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function SongRow({ song }: { song: EditableSong }) {
  const [state, onSubmit, pending] = useActionForm(updateSongAction, INITIAL_ACTION_STATE);
  return (
    <details className="border-b border-olive/50 py-2">
      <summary className="cursor-pointer">
        <span className="font-semibold">{song.title}</span> · {song.artist}
        {song.year ? ` (${song.year})` : ""}
        {!song.isVisible && <span className="ml-2 text-xs font-bold tracking-wider uppercase">Hidden</span>}
      </summary>
      <form
        onSubmit={(event) => {
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          if (submitter instanceof HTMLButtonElement && submitter.value === "delete" && !window.confirm(`Delete "${song.title}" from the song list?`)) {
            event.preventDefault();
            return;
          }
          onSubmit(event);
        }}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="id" value={song.id} />
        <input type="hidden" name="version" value={song.version} />
        <Fields song={song} errors={state.fieldErrors} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="save" disabled={pending} className={SECONDARY_BUTTON}>
            Save
          </button>
          <button type="submit" name="intent" value="delete" disabled={pending} className="text-sm underline">
            Delete
          </button>
        </div>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </details>
  );
}

export function ImportSongsForm() {
  const [state, onSubmit, pending] = useActionForm(importSongsAction, INITIAL_ACTION_STATE);
  const id = useId();
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label htmlFor={id} className={LABEL_CLASS}>
        Paste a list
      </label>
      <p id={`${id}-help`} className="text-sm text-cream/90">
        One song per line, like <code>Third Eye Blind - Semi-Charmed Life (1997)</code>, or copy the Artist, Title, and Year columns
        straight out of a spreadsheet. Songs already on the list are skipped.
      </p>
      <textarea id={id} name="list" rows={8} aria-describedby={`${id}-help`} className={`${DARK_INPUT_CLASS} font-mono text-sm`} />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        Import
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
