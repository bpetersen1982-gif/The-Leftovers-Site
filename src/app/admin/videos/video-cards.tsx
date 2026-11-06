"use client";

import { useId } from "react";
import { VideoPlayer } from "@/components/video-player";
import type { VideoStatus } from "@/generated/prisma/enums";
import type { TakedownSummary } from "@/lib/photos/queries";
import type { VideoPlayback } from "@/lib/video/queries";
import { INITIAL_ACTION_STATE } from "../action-state";
import { DARK_INPUT_CLASS, FieldError, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { TakedownForm } from "../takedown-form";
import { useActionForm } from "../use-action-form";
import { captionsAction, saveVideoAction, takedownVideoAction, videoDecisionAction } from "./actions";

export interface CardVideo {
  readonly id: string;
  readonly version: number;
  readonly status: VideoStatus;
  readonly originalFilename: string;
  readonly title: string;
  readonly description: string;
  readonly posterSeconds: number;
  readonly durationSeconds: number | null;
  readonly duration: string | null;
  readonly captionsLanguage: string | null;
  readonly failureReason: string | null;
  readonly uploaderName: string;
  readonly removalRequestedByName: string | null;
  readonly removalReason: string | null;
  readonly playback: VideoPlayback | null;
}

function Preview({ video }: { video: CardVideo }) {
  if (!video.playback) return <div className="flex aspect-video items-center justify-center bg-charcoal text-sm text-cream/80">No preview yet</div>;
  return <VideoPlayer title={video.title || video.originalFilename} posterUrl={video.playback.posterUrl} iframeUrl={video.playback.iframeUrl} />;
}

export function DetailsForm({ video, canPublish }: { video: CardVideo; canPublish: boolean }) {
  const [state, onSubmit, pending] = useActionForm(saveVideoAction, INITIAL_ACTION_STATE);
  const prefix = useId();
  const errors = state.fieldErrors;
  const described = (name: string) => ({
    id: `${prefix}-${name}`,
    name,
    className: DARK_INPUT_CLASS,
    "aria-invalid": Boolean(errors?.[name]),
    "aria-describedby": errors?.[name] ? `${prefix}-${name}-error` : undefined,
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="id" value={video.id} />
      <input type="hidden" name="version" value={video.version} />
      <div>
        <label htmlFor={`${prefix}-title`} className={LABEL_CLASS}>
          Title{canPublish ? " (required to publish)" : ""}
        </label>
        <input {...described("title")} maxLength={120} defaultValue={video.title} placeholder="e.g. Mr. Brightside, Zoo Bar Oct 2026" />
        <FieldError id={`${prefix}-title-error`} message={errors?.title} />
      </div>
      <div>
        <label htmlFor={`${prefix}-description`} className={LABEL_CLASS}>
          Description (optional)
        </label>
        <textarea {...described("description")} rows={2} maxLength={2000} defaultValue={video.description} />
        <FieldError id={`${prefix}-description-error`} message={errors?.description} />
      </div>
      <div>
        <label htmlFor={`${prefix}-posterSeconds`} className={LABEL_CLASS}>
          Poster frame (seconds in)
        </label>
        <input
          {...described("posterSeconds")}
          type="number"
          min={0}
          max={video.durationSeconds ? Math.floor(video.durationSeconds) : undefined}
          step={1}
          defaultValue={Math.round(video.posterSeconds)}
          className={`${DARK_INPUT_CLASS} max-w-32`}
        />
        <FieldError id={`${prefix}-posterSeconds-error`} message={errors?.posterSeconds} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="save" disabled={pending} className={SECONDARY_BUTTON}>
          Save
        </button>
        {canPublish && (
          <button type="submit" name="intent" value="publish" disabled={pending} className="btn-primary disabled:opacity-60">
            Save and publish
          </button>
        )}
      </div>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

function CaptionsForm({ video }: { video: CardVideo }) {
  const [state, onSubmit, pending] = useActionForm(captionsAction, INITIAL_ACTION_STATE);
  const inputId = useId();
  return (
    <details>
      <summary className="cursor-pointer text-sm underline">Captions {video.captionsLanguage ? "(added)" : ""}</summary>
      <form onSubmit={onSubmit} className="mt-3 space-y-2">
        <input type="hidden" name="id" value={video.id} />
        <input type="hidden" name="version" value={video.version} />
        <label htmlFor={inputId} className={LABEL_CLASS}>
          WebVTT file (.vtt)
        </label>
        <input id={inputId} name="captions" type="file" accept=".vtt,text/vtt" className="block text-sm" />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="upload" disabled={pending} className={SECONDARY_BUTTON}>
            Upload captions
          </button>
          {video.captionsLanguage && (
            <button type="submit" name="intent" value="remove" disabled={pending} className="text-sm underline">
              Remove captions
            </button>
          )}
        </div>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </details>
  );
}

function DecisionButton({ video, intent, label, confirmText, primary = false }: { video: CardVideo; intent: "restore" | "delete"; label: string; confirmText?: string; primary?: boolean }) {
  const [state, onSubmit, pending] = useActionForm(videoDecisionAction, INITIAL_ACTION_STATE);
  return (
    <form
      onSubmit={(event) => {
        if (confirmText && !window.confirm(confirmText)) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <input type="hidden" name="id" value={video.id} />
      <input type="hidden" name="version" value={video.version} />
      <button type="submit" name="intent" value={intent} disabled={pending} className={primary ? "btn-primary disabled:opacity-60" : SECONDARY_BUTTON}>
        {label}
      </button>
      <FormMessage ok={state.ok} message={state.ok ? null : state.message} />
    </form>
  );
}

function RemoveForm({ video, isAdmin }: { video: CardVideo; isAdmin: boolean }) {
  const [state, onSubmit, pending] = useActionForm(videoDecisionAction, INITIAL_ACTION_STATE);
  const reasonId = useId();
  return (
    <details>
      <summary className="cursor-pointer text-sm underline">Take off the site</summary>
      <form
        onSubmit={(event) => {
          if (!window.confirm("Take this video off the public site now?")) {
            event.preventDefault();
            return;
          }
          onSubmit(event);
        }}
        className="mt-3 space-y-2"
      >
        <input type="hidden" name="id" value={video.id} />
        <input type="hidden" name="version" value={video.version} />
        <label htmlFor={reasonId} className={LABEL_CLASS}>
          Why? (optional)
        </label>
        <input id={reasonId} name="reason" maxLength={250} className={DARK_INPUT_CLASS} />
        <button type="submit" name="intent" value="remove" disabled={pending} className={SECONDARY_BUTTON}>
          {isAdmin ? "Remove from site" : "Ask to remove"}
        </button>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </details>
  );
}

const DELETE_CONFIRM = "Delete this video for good, here and on Cloudflare Stream? This can't be undone.";

export function InProgressCard({ video }: { video: CardVideo }) {
  return (
    <article className="space-y-2 border border-olive/60 p-3" aria-label={video.originalFilename}>
      <p className="truncate font-semibold">{video.originalFilename}</p>
      {video.status === "FAILED" ? (
        <>
          <p role="alert" className="font-semibold text-red-text">
            {video.failureReason ?? "This video couldn't be processed."}
          </p>
          <DecisionButton video={video} intent="delete" label="Remove" />
        </>
      ) : (
        <>
          <p className="text-sm">{video.status === "UPLOADING" ? "Waiting for the upload to finish…" : "Stream is processing it. This page updates by itself."}</p>
          <DecisionButton video={video} intent="delete" label="Cancel and delete" confirmText={DELETE_CONFIRM} />
        </>
      )}
    </article>
  );
}

export function ReadyCard({ video }: { video: CardVideo }) {
  return (
    <article className="space-y-3 border border-olive/60 p-3" aria-label={video.originalFilename}>
      <Preview video={video} />
      <p className="truncate text-sm" title={video.originalFilename}>
        {video.originalFilename} {video.duration ? `· ${video.duration}` : ""}
      </p>
      <DetailsForm video={video} canPublish />
      <CaptionsForm video={video} />
      <DecisionButton video={video} intent="delete" label="Delete" confirmText={DELETE_CONFIRM} />
    </article>
  );
}

export function PublishedCard({ video, isAdmin, today }: { video: CardVideo; isAdmin: boolean; today: string }) {
  return (
    <article className="space-y-3 border border-olive/60 p-3" aria-label={video.title}>
      <Preview video={video} />
      <p className="font-semibold">{video.title}</p>
      {isAdmin && (
        <>
          <details>
            <summary className="cursor-pointer text-sm underline">Edit details</summary>
            <div className="mt-3">
              <DetailsForm video={video} canPublish={false} />
            </div>
          </details>
          <CaptionsForm video={video} />
        </>
      )}
      <RemoveForm video={video} isAdmin={isAdmin} />
      {isAdmin && <TakedownForm id={video.id} version={video.version} today={today} action={takedownVideoAction} noun="video" />}
    </article>
  );
}

export function RemovedCard({ video, isAdmin, today }: { video: CardVideo; isAdmin: boolean; today: string }) {
  return (
    <article className="space-y-3 border border-olive/60 p-3" aria-label={`Removed: ${video.title}`}>
      <Preview video={video} />
      <p className="font-semibold">{video.title}</p>
      <p className="text-xs text-cream/90">
        Removed by {video.removalRequestedByName ?? "a former band member"}
        {video.removalReason ? `: ${video.removalReason}` : ""}
      </p>
      {isAdmin ? (
        <>
          <div className="flex flex-wrap gap-2">
            <DecisionButton video={video} intent="delete" label="Delete permanently" confirmText={DELETE_CONFIRM} primary />
            <DecisionButton video={video} intent="restore" label="Put back on site" />
          </div>
          <TakedownForm id={video.id} version={video.version} today={today} action={takedownVideoAction} noun="video" />
        </>
      ) : (
        <p className="text-sm">Hidden from the public. An Admin will delete it or put it back.</p>
      )}
    </article>
  );
}

export function TakenDownCard({ video, notice }: { video: CardVideo; notice: TakedownSummary | null }) {
  return (
    <article className="space-y-2 border border-red-text/60 p-3" aria-label={`Taken down: ${video.title}`}>
      <Preview video={video} />
      <p className="font-semibold">{video.title}</p>
      {notice && (
        <p className="text-xs">
          Notice from {notice.senderName} ({notice.senderEmail}), received {notice.receivedOn}: {notice.workClaimed}. Taken down by {notice.actedByName}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <DecisionButton video={video} intent="delete" label="Delete permanently" confirmText={DELETE_CONFIRM} primary />
        <DecisionButton video={video} intent="restore" label="Put back on site" />
      </div>
    </article>
  );
}
