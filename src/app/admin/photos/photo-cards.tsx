"use client";

import { useId } from "react";
import type { PhotoStatus } from "@/generated/prisma/enums";
import type { PhotoImage } from "@/lib/photos/queries";
import { INITIAL_ACTION_STATE } from "../action-state";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { deletePhotoAction, reviewPhotosAction, savePhotoAction } from "./actions";

/** What the cards need about a photo (serializable from the server page). */
export interface CardPhoto {
  readonly id: string;
  readonly version: number;
  readonly status: PhotoStatus;
  readonly originalFilename: string;
  readonly altText: string;
  readonly caption: string;
  readonly credit: string;
  readonly failureReason: string | null;
  readonly rejectionReason: string | null;
  readonly uploaderName: string;
  readonly isMine: boolean;
  readonly image: PhotoImage | null;
}

const LIMITS = { altText: 250, caption: 500, credit: 100 } as const;

function Thumb({ photo }: { photo: CardPhoto }) {
  if (!photo.image) {
    return <div className="flex aspect-[4/3] items-center justify-center bg-charcoal text-sm text-cream/80">No preview</div>;
  }
  const small = photo.image.sources[1] ?? photo.image.sources[0];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized variant (signed or CDN URL)
    <img
      src={small?.url ?? photo.image.src}
      width={photo.image.width}
      height={photo.image.height}
      alt={photo.altText || `Preview of ${photo.originalFilename} (no description yet)`}
      loading="lazy"
      decoding="async"
      className="aspect-[4/3] w-full bg-charcoal object-contain"
      style={photo.image.blurDataUrl ? { backgroundImage: `url("${photo.image.blurDataUrl}")`, backgroundSize: "cover" } : undefined}
    />
  );
}

/** Alt text / caption / credit editor. `submitLabel` adds a "save and send on" button. */
export function DetailsForm({ photo, submitLabel }: { photo: CardPhoto; submitLabel?: string }) {
  const [state, onSubmit, pending] = useActionForm(savePhotoAction, INITIAL_ACTION_STATE);
  const prefix = useId();
  const errors = state.fieldErrors;
  const field = (name: keyof typeof LIMITS) => ({
    id: `${prefix}-${name}`,
    name,
    maxLength: LIMITS[name],
    defaultValue: photo[name],
    className: DARK_INPUT_CLASS,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="id" value={photo.id} />
      <input type="hidden" name="version" value={photo.version} />
      <div>
        <label htmlFor={`${prefix}-altText`} className={LABEL_CLASS}>
          Alt text (required)
        </label>
        <input {...field("altText")} placeholder="e.g. Jim singing under red stage lights" aria-required="true" />
        <FieldError id={`${prefix}-altText-error`} message={errors?.altText} />
      </div>
      <div>
        <label htmlFor={`${prefix}-caption`} className={LABEL_CLASS}>
          Caption
        </label>
        <input {...field("caption")} placeholder="Optional, shown under the photo" />
        <FieldError id={`${prefix}-caption-error`} message={errors?.caption} />
      </div>
      <div>
        <label htmlFor={`${prefix}-credit`} className={LABEL_CLASS}>
          Photo credit
        </label>
        <input {...field("credit")} placeholder="Who took it (optional)" />
        <FieldError id={`${prefix}-credit-error`} message={errors?.credit} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="save" disabled={pending} className={SECONDARY_BUTTON}>
          Save
        </button>
        {submitLabel && (
          <button type="submit" name="intent" value="submit" disabled={pending} className="btn-primary disabled:opacity-60">
            {submitLabel}
          </button>
        )}
      </div>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function DeleteButton({ photo, label = "Delete" }: { photo: CardPhoto; label?: string }) {
  const [state, onSubmit, pending] = useActionForm(deletePhotoAction, INITIAL_ACTION_STATE);
  return (
    <form
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${photo.originalFilename}? This can't be undone.`)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <input type="hidden" name="id" value={photo.id} />
      <input type="hidden" name="version" value={photo.version} />
      <button type="submit" disabled={pending} className="text-sm underline disabled:opacity-60">
        {label}
        <span className="sr-only"> {photo.originalFilename}</span>
      </button>
      <FormMessage ok={state.ok} message={state.ok ? null : state.message} />
    </form>
  );
}

/** One of the viewer's own drafts, rejected, or failed photos. */
export function MyPhotoCard({ photo, submitLabel }: { photo: CardPhoto; submitLabel: string }) {
  return (
    <article className="space-y-3 border border-olive/60 p-3" aria-label={photo.originalFilename}>
      <Thumb photo={photo} />
      <p className="truncate text-sm" title={photo.originalFilename}>
        {photo.originalFilename}
      </p>
      {photo.status === "FAILED" ? (
        <>
          <p role="alert" className="font-semibold text-red-text">
            {photo.failureReason ?? "This photo couldn't be processed."}
          </p>
          <DeleteButton photo={photo} label="Remove" />
        </>
      ) : (
        <>
          {photo.status === "REJECTED" && (
            <p className="text-sm">
              <span className="font-semibold text-red-text">Not approved.</span>{" "}
              {photo.rejectionReason ? `Reason: ${photo.rejectionReason}` : "Edit and send it again, or delete it."}
            </p>
          )}
          <DetailsForm photo={photo} submitLabel={submitLabel} />
          <DeleteButton photo={photo} />
        </>
      )}
    </article>
  );
}

/**
 * Admin review queue with bulk approve/reject (requirements APR-9). Rendered even when
 * empty, so the result message survives the last photo leaving the queue.
 */
export function ReviewQueue({ photos }: { photos: readonly CardPhoto[] }) {
  const [state, onSubmit, pending] = useActionForm(reviewPhotosAction, INITIAL_ACTION_STATE);
  const formId = useId();
  if (photos.length === 0) {
    return (
      <div className="space-y-2">
        <FormMessage ok={state.ok} message={state.message} />
        <p className="text-cream/90">Nothing waiting.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photo) => (
          <li key={`${photo.id}:${photo.version}`}>
            <article className="space-y-3 border border-olive/60 p-3" aria-label={`${photo.originalFilename} from ${photo.uploaderName}`}>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" name="photo" value={`${photo.id}:${photo.version}`} form={formId} className="size-5" />
                Select photo from {photo.uploaderName}
              </label>
              <Thumb photo={photo} />
              <details>
                <summary className="cursor-pointer underline">Edit details</summary>
                <div className="mt-3">
                  <DetailsForm photo={photo} />
                </div>
              </details>
            </article>
          </li>
        ))}
      </ul>
      <form id={formId} onSubmit={onSubmit} className="space-y-3 border-t border-olive/60 pt-4">
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="approve" disabled={pending} className="btn-primary disabled:opacity-60">
            Approve selected
          </button>
          <button type="submit" name="intent" value="reject" disabled={pending} className={SECONDARY_BUTTON}>
            Reject selected
          </button>
        </div>
        <div className="max-w-md">
          <label htmlFor={`${formId}-reason`} className={LABEL_CLASS}>
            Reason for rejecting (optional)
          </label>
          <input id={`${formId}-reason`} name="reason" maxLength={250} className={DARK_INPUT_CLASS} placeholder="The uploader sees this" />
        </div>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </div>
  );
}

/** A Member's own photo waiting on an Admin: view and delete only. */
export function PendingCard({ photo }: { photo: CardPhoto }) {
  return (
    <article className="space-y-2 border border-olive/60 p-3" aria-label={photo.originalFilename}>
      <Thumb photo={photo} />
      <p className="text-sm">{photo.altText}</p>
      <p className="text-sm text-cream/90">Waiting for an Admin.</p>
      {photo.isMine && <DeleteButton photo={photo} />}
    </article>
  );
}

/** A published photo; Admins can fix its details. */
export function PublishedCard({ photo, canEdit }: { photo: CardPhoto; canEdit: boolean }) {
  return (
    <article className="space-y-2 border border-olive/60 p-3" aria-label={photo.altText}>
      <Thumb photo={photo} />
      <p className="text-sm">{photo.altText}</p>
      <p className="text-xs text-cream/90">Uploaded by {photo.uploaderName}</p>
      {canEdit && (
        <details>
          <summary className="cursor-pointer text-sm underline">Edit details</summary>
          <div className="mt-3">
            <DetailsForm photo={photo} />
          </div>
        </details>
      )}
    </article>
  );
}
