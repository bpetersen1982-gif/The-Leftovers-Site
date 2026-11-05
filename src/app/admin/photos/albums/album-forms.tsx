"use client";

import { useId } from "react";
import type { PhotoImage } from "@/lib/photos/queries";
import { INITIAL_ACTION_STATE } from "../../action-state";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../../form-ui";
import { useActionForm } from "../../use-action-form";
import { addAlbumPhotosAction, albumPhotoAction, createAlbumAction, deleteAlbumAction, updateAlbumAction } from "./actions";

export interface AlbumDetails {
  readonly title: string;
  readonly description: string;
  readonly eventDate: string | null;
  readonly isPublic: boolean;
}

export interface AlbumPhotoCard {
  readonly id: string;
  readonly altText: string;
  readonly isPublic: boolean;
  readonly image: PhotoImage | null;
}

function Fields({ defaults, errors }: { defaults?: AlbumDetails; errors?: Partial<Record<string, string>> }) {
  const prefix = useId();
  const described = (name: string) => ({
    id: `${prefix}-${name}`,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${prefix}-title`} className={LABEL_CLASS}>
          Title
        </label>
        <input name="title" required maxLength={80} defaultValue={defaults?.title} placeholder="e.g. Zoo Bar, October 2026" className={DARK_INPUT_CLASS} {...described("title")} />
        <FieldError id={`${prefix}-title-error`} message={errors?.title} />
      </div>
      <div>
        <label htmlFor={`${prefix}-eventDate`} className={LABEL_CLASS}>
          Show date (optional)
        </label>
        <input type="date" name="eventDate" defaultValue={defaults?.eventDate ?? ""} className={DARK_INPUT_CLASS} {...described("eventDate")} />
        <FieldError id={`${prefix}-eventDate-error`} message={errors?.eventDate} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${prefix}-description`} className={LABEL_CLASS}>
          Description (optional)
        </label>
        <textarea name="description" rows={3} maxLength={1000} defaultValue={defaults?.description} className={DARK_INPUT_CLASS} {...described("description")} />
        <FieldError id={`${prefix}-description-error`} message={errors?.description} />
      </div>
      <label className="flex items-center gap-2 sm:col-span-2">
        <input type="checkbox" name="isPublic" defaultChecked={defaults?.isPublic ?? false} className="size-5" />
        Show on the public Photos page
      </label>
    </div>
  );
}

export function CreateAlbumForm() {
  const [state, onSubmit, pending] = useActionForm(createAlbumAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Fields errors={state.fieldErrors} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        Create album
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function EditAlbumForm({ albumId, version, details }: { albumId: string; version: number; details: AlbumDetails }) {
  const [state, onSubmit, pending] = useActionForm(updateAlbumAction, INITIAL_ACTION_STATE);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="albumId" value={albumId} />
      <input type="hidden" name="version" value={version} />
      <Fields defaults={details} errors={state.fieldErrors} />
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        Save album
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function DeleteAlbumForm({ albumId, version, title }: { albumId: string; version: number; title: string }) {
  const [state, onSubmit, pending] = useActionForm(deleteAlbumAction, INITIAL_ACTION_STATE);
  return (
    <form
      onSubmit={(event) => {
        if (!window.confirm(`Delete the album "${title}"? Its photos stay on the site.`)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <input type="hidden" name="albumId" value={albumId} />
      <input type="hidden" name="version" value={version} />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        Delete album
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

function Thumb({ photo }: { photo: AlbumPhotoCard }) {
  const small = photo.image?.sources[0];
  if (!photo.image || !small) return <div className="aspect-square w-full bg-charcoal" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized variant
    <img
      src={small.url}
      width={small.width}
      height={small.height}
      alt={photo.altText}
      loading="lazy"
      decoding="async"
      className="aspect-square w-full bg-charcoal object-cover"
    />
  );
}

/** The album's photos, in order, with move / cover / remove controls. */
export function AlbumPhotoList({
  albumId,
  version,
  photos,
  coverPhotoId,
}: {
  albumId: string;
  version: number;
  photos: readonly AlbumPhotoCard[];
  coverPhotoId: string | null;
}) {
  const [state, onSubmit, pending] = useActionForm(albumPhotoAction, INITIAL_ACTION_STATE);
  // Without an explicit cover, the first public photo is used.
  const effectiveCover = coverPhotoId ?? photos.find((photo) => photo.isPublic)?.id ?? null;
  return (
    <div className="space-y-3">
      <FormMessage ok={state.ok} message={state.message} />
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, index) => (
          <li key={photo.id} className="space-y-2 border border-olive/60 p-2" aria-label={photo.altText}>
            <Thumb photo={photo} />
            <p className="truncate text-sm" title={photo.altText}>
              {index + 1}. {photo.altText}
            </p>
            {photo.id === effectiveCover && <p className="text-xs font-bold tracking-wider uppercase">Cover</p>}
            {!photo.isPublic && <p className="text-xs font-semibold text-red-text">Taken off the site: hidden here too</p>}
            <form onSubmit={onSubmit} className="flex flex-wrap gap-1 text-sm">
              <input type="hidden" name="albumId" value={albumId} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="photoId" value={photo.id} />
              <button type="submit" name="intent" value="up" disabled={pending || index === 0} aria-label={`Move ${photo.altText} earlier`} className={SECONDARY_BUTTON}>
                ←
              </button>
              <button
                type="submit"
                name="intent"
                value="down"
                disabled={pending || index === photos.length - 1}
                aria-label={`Move ${photo.altText} later`}
                className={SECONDARY_BUTTON}
              >
                →
              </button>
              {photo.id !== effectiveCover && photo.isPublic && (
                <button type="submit" name="intent" value="cover" disabled={pending} aria-label={`Make ${photo.altText} the cover`} className="underline">
                  Make cover
                </button>
              )}
              <button type="submit" name="intent" value="remove" disabled={pending} aria-label={`Remove ${photo.altText} from album`} className="underline">
                Remove
              </button>
            </form>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Published photos not yet in the album, as a checkbox grid. */
export function AddPhotosForm({ albumId, version, photos }: { albumId: string; version: number; photos: readonly AlbumPhotoCard[] }) {
  const [state, onSubmit, pending] = useActionForm(addAlbumPhotosAction, INITIAL_ACTION_STATE);
  if (photos.length === 0) return <p className="text-cream/90">Every published photo is already in this album.</p>;
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="albumId" value={albumId} />
      <input type="hidden" name="version" value={version} />
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photos.map((photo) => (
          <li key={photo.id}>
            <label className="block cursor-pointer space-y-1 has-[:checked]:outline-2 has-[:checked]:outline-red-text">
              <Thumb photo={photo} />
              <span className="flex items-center gap-1 text-xs">
                <input type="checkbox" name="photoId" value={photo.id} className="size-4" />
                <span className="truncate">{photo.altText}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
        Add selected
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}
