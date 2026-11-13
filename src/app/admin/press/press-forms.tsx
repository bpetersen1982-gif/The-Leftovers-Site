"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { INITIAL_ACTION_STATE } from "../action-state";
import { FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { completePressUploadAction, deletePressFileAction, savePressPhotosAction, savePressVideosAction, startPressUploadAction } from "./actions";

function put(url: string, headers: Record<string, string>, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(String(request.status))));
    request.onerror = () => reject(new Error("network"));
    request.send(file);
  });
}

/** Upload / replace / remove one press file (logo, rider, stage plot). */
export function PressFileSlot({
  kind,
  label,
  accept,
  current,
}: {
  kind: "LOGO" | "RIDER" | "STAGE_PLOT";
  label: string;
  accept: string;
  current: { url: string; size: string; uploaded: string } | null;
}) {
  const router = useRouter();
  const inputId = useId();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [deleteState, onDelete, deleting] = useActionForm(deletePressFileAction, INITIAL_ACTION_STATE);

  async function upload(file: File) {
    setStatus(null);
    setProgress(0);
    const contentType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    const started = await startPressUploadAction({ kind, filename: file.name, contentType, size: file.size });
    if (!started.ok) {
      setProgress(null);
      return setStatus({ ok: false, message: started.message });
    }
    try {
      await put(started.url, started.headers, file, setProgress);
    } catch {
      setProgress(null);
      return setStatus({ ok: false, message: "The upload didn't go through. Check your connection and try again." });
    }
    const done = await completePressUploadAction({ kind, uploadId: started.uploadId });
    setProgress(null);
    setStatus(done);
    router.refresh();
  }

  return (
    <div className="space-y-2 border border-olive/60 p-4">
      <p className={LABEL_CLASS}>{label}</p>
      {current ? (
        <p className="text-sm">
          <a href={current.url} className="underline">
            Current file
          </a>{" "}
          · {current.size} · uploaded {current.uploaded}
        </p>
      ) : (
        <p className="text-sm text-cream/90">Nothing uploaded yet.</p>
      )}
      <label htmlFor={inputId} className={`${SECONDARY_BUTTON} inline-block cursor-pointer`}>
        {current ? "Replace" : "Upload"}
        <span className="sr-only"> {label}</span>
      </label>
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={progress !== null}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      {progress !== null && <progress max={100} value={progress} aria-label={`Uploading ${label}`} className="block w-48" />}
      <p role="status" aria-live="polite" className={`text-sm font-semibold ${status && !status.ok ? "text-red-text" : ""}`}>
        {status?.message ?? ""}
      </p>
      {current && (
        <form
          onSubmit={(event) => {
            if (!window.confirm(`Remove the ${label.toLowerCase()} from the press kit?`)) {
              event.preventDefault();
              return;
            }
            onDelete(event);
          }}
        >
          <input type="hidden" name="kind" value={kind} />
          <button type="submit" disabled={deleting} className="text-sm underline">
            Remove<span className="sr-only"> {label}</span>
          </button>
          <FormMessage ok={deleteState.ok} message={deleteState.ok ? null : deleteState.message} />
        </form>
      )}
    </div>
  );
}

interface PickItem {
  readonly id: string;
  readonly label: string;
  readonly thumbUrl: string | null;
  readonly selected: boolean;
}

function Picker({ items, field, max, action, saveLabel }: { items: readonly PickItem[]; field: string; max: number; action: typeof savePressPhotosAction; saveLabel: string }) {
  const [state, onSubmit, pending] = useActionForm(action, INITIAL_ACTION_STATE);
  const [count, setCount] = useState(items.filter((item) => item.selected).length);
  return (
    <form
      onSubmit={onSubmit}
      onChange={(event) => setCount(event.currentTarget.querySelectorAll(`input[name="${field}"]:checked`).length)}
      className="space-y-3"
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <li key={item.id}>
            <label className="block cursor-pointer space-y-1 has-[:checked]:outline-2 has-[:checked]:outline-red-text">
              {item.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- pre-sized thumbnail
                <img src={item.thumbUrl} alt="" loading="lazy" className="aspect-[4/3] w-full bg-charcoal object-cover" />
              ) : (
                <span className="block aspect-[4/3] w-full bg-charcoal" />
              )}
              <span className="flex items-center gap-1 text-xs">
                <input type="checkbox" name={field} value={item.id} defaultChecked={item.selected} className="size-4" />
                <span className="truncate">{item.label}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className={`text-sm ${count > max ? "font-semibold text-red-text" : "text-cream/90"}`}>
        {count} of up to {max} selected
      </p>
      <button type="submit" disabled={pending || count > max} className="btn-primary disabled:opacity-60">
        {saveLabel}
      </button>
      <FormMessage ok={state.ok} message={state.message} />
    </form>
  );
}

export function PressPhotoPicker({ items, max }: { items: readonly PickItem[]; max: number }) {
  return <Picker items={items} field="photoId" max={max} action={savePressPhotosAction} saveLabel="Save press photos" />;
}

export function PressVideoPicker({ items, max }: { items: readonly PickItem[]; max: number }) {
  return <Picker items={items} field="videoId" max={max} action={savePressVideosAction} saveLabel="Save video highlights" />;
}
