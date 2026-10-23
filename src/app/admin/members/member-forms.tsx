"use client";

import { useActionForm } from "../use-action-form";
import { useEffect, useRef } from "react";
import { INITIAL_ACTION_STATE } from "../action-state";
import { type SaveState, createMemberAction, deleteMemberAction, moveMemberAction, updateMemberAction } from "../content-actions";
import { DARK_INPUT_CLASS, FieldError, FormMessage, FormattingHelp, INPUT_CLASS, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";

interface MemberDraft {
  readonly id: string;
  readonly name: string;
  readonly instrument: string;
  readonly bio: string;
  readonly isVisible: boolean;
  readonly version: number;
}

function MemberFields({
  idPrefix,
  defaults,
  errors,
  dark,
}: {
  idPrefix: string;
  defaults?: Partial<MemberDraft>;
  errors?: Partial<Record<string, string>>;
  dark: boolean;
}) {
  const input = dark ? DARK_INPUT_CLASS : INPUT_CLASS;
  const field = (name: string) => ({
    id: `${idPrefix}-${name}`,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${idPrefix}-${name}-error` : undefined,
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={LABEL_CLASS}>
          Name
        </label>
        <input name="name" required maxLength={80} defaultValue={defaults?.name} className={input} {...field("name")} />
        <FieldError id={`${idPrefix}-name-error`} message={errors?.name} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-instrument`} className={LABEL_CLASS}>
          Instrument
        </label>
        <input name="instrument" maxLength={60} defaultValue={defaults?.instrument} placeholder="e.g. Guitar & vocals" className={input} {...field("instrument")} />
        <FieldError id={`${idPrefix}-instrument-error`} message={errors?.instrument} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-bio`} className={LABEL_CLASS}>
          Bio
        </label>
        <textarea name="bio" rows={5} maxLength={20_000} defaultValue={defaults?.bio} className={input} {...field("bio")}
          aria-describedby={`${idPrefix}-bio-help${errors?.bio ? ` ${idPrefix}-bio-error` : ""}`} />
        <FormattingHelp id={`${idPrefix}-bio-help`} />
        <FieldError id={`${idPrefix}-bio-error`} message={errors?.bio} />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isVisible" defaultChecked={defaults?.isVisible ?? true} />
        Show on the public Members page
      </label>
    </div>
  );
}

export function AddMemberForm() {
  const [state, formAction, pending] = useActionForm(createMemberAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} onSubmit={formAction} className="mt-4 space-y-4">
      <MemberFields idPrefix="new-member" errors={state.fieldErrors} dark={false} />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? "Adding…" : "Add member"}
        </button>
        <FormMessage ok={state.ok} message={state.message} onPaper />
      </div>
    </form>
  );
}

export function MemberEditor({ member, isFirst, isLast }: { member: MemberDraft; isFirst: boolean; isLast: boolean }) {
  const [state, formAction, pending] = useActionForm<SaveState>(updateMemberAction, {
    ok: false,
    message: null,
    version: member.version,
  });
  const [moveState, moveAction, movePending] = useActionForm(moveMemberAction, INITIAL_ACTION_STATE);
  const [deleteState, deleteAction, deletePending] = useActionForm(deleteMemberAction, INITIAL_ACTION_STATE);
  const idPrefix = `member-${member.id}`;

  return (
    <article aria-labelledby={`${idPrefix}-title`} className="border border-olive/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${idPrefix}-title`} className="font-heading text-xl tracking-wider uppercase">
          {member.name}
          {!member.isVisible && <span className="ml-2 text-sm text-cream/90">(hidden)</span>}
        </h2>
        <form onSubmit={moveAction} className="flex gap-2">
          <input type="hidden" name="id" value={member.id} />
          <button type="submit" name="direction" value="up" disabled={isFirst || movePending} aria-label={`Move ${member.name} up`} className={SECONDARY_BUTTON}>
            ↑
          </button>
          <button type="submit" name="direction" value="down" disabled={isLast || movePending} aria-label={`Move ${member.name} down`} className={SECONDARY_BUTTON}>
            ↓
          </button>
        </form>
      </div>
      <FormMessage ok={moveState.ok} message={moveState.message} />

      <form onSubmit={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={member.id} />
        <input type="hidden" name="version" value={state.version ?? member.version} />
        <MemberFields idPrefix={idPrefix} defaults={member} errors={state.fieldErrors} dark />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60" aria-label={`Save ${member.name}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>

      <form onSubmit={deleteAction} className="mt-4 flex flex-wrap items-center gap-3 border-t border-olive/40 pt-3 text-sm">
        <input type="hidden" name="id" value={member.id} />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirm" value="yes" required />
          Confirm
        </label>
        <button type="submit" disabled={deletePending} aria-label={`Delete ${member.name}`} className={SECONDARY_BUTTON}>
          {deletePending ? "Deleting…" : "Delete from lineup"}
        </button>
        <FormMessage ok={deleteState.ok} message={deleteState.message} />
      </form>
    </article>
  );
}
