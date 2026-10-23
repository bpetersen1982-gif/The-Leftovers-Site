"use client";

import { type DragEvent, useCallback, useRef, useState } from "react";
import { finishPhotoUploadAction, startPhotoUploadAction } from "./actions";

/**
 * Multi-file photo uploader (requirements MED-1): pick or drag photos, each goes straight
 * to storage with a signed URL (progress shown per file), then the server processes it
 * into a private draft. Built for phones after a show: big tap target, HEIC accepted,
 * uploads run a few at a time so a weak connection isn't swamped.
 *
 * Client checks here are for fast feedback only; the server re-validates everything.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};
const ACCEPTED_TYPES = new Set(Object.values(TYPE_BY_EXTENSION));
const ACCEPT_ATTRIBUTE = [...ACCEPTED_TYPES, ".heic", ".heif"].join(",");

type ItemState =
  | { readonly kind: "queued" }
  | { readonly kind: "uploading"; readonly percent: number }
  | { readonly kind: "processing" }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly message: string };

interface Item {
  readonly key: string;
  readonly name: string;
  readonly state: ItemState;
}

/** Browsers sometimes report HEIC (and other types) as "", so fall back to the extension. */
function contentTypeOf(file: File): string | null {
  if (ACCEPTED_TYPES.has(file.type)) return file.type;
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase();
  return (extension && TYPE_BY_EXTENSION[extension]) || null;
}

function putWithProgress(url: string, headers: Readonly<Record<string, string>>, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status})`)));
    request.onerror = () => reject(new Error("Network error"));
    request.ontimeout = () => reject(new Error("Timed out"));
    request.send(file);
  });
}

function statusText(state: ItemState): string {
  switch (state.kind) {
    case "queued":
      return "Waiting";
    case "uploading":
      return `Uploading ${state.percent}%`;
    case "processing":
      return "Processing";
    case "done":
      return "Ready below";
    case "error":
      return state.message;
  }
}

export function PhotoUploader({ publishesDirectly }: { publishesDirectly: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const counter = useRef(0);

  const update = useCallback((key: string, state: ItemState) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, state } : item)));
  }, []);

  const uploadOne = useCallback(
    async (key: string, file: File) => {
      const contentType = contentTypeOf(file);
      if (!contentType) return update(key, { kind: "error", message: "Not a JPEG, PNG, WebP, or HEIC photo." });
      if (file.size > MAX_BYTES) return update(key, { kind: "error", message: "Over 25 MB." });
      if (file.size === 0) return update(key, { kind: "error", message: "Empty file." });

      update(key, { kind: "uploading", percent: 0 });
      const started = await startPhotoUploadAction({ filename: file.name, contentType, size: file.size });
      if (!started.ok) return update(key, { kind: "error", message: started.message });
      try {
        await putWithProgress(started.url, started.headers, file, (percent) => update(key, { kind: "uploading", percent }));
      } catch {
        return update(key, { kind: "error", message: "The upload didn't go through. Check your connection and try again." });
      }
      update(key, { kind: "processing" });
      const finished = await finishPhotoUploadAction(started.photoId);
      update(key, finished.ok ? { kind: "done" } : { kind: "error", message: finished.message });
    },
    [update],
  );

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0) return;
      const queued = files.map((file) => {
        counter.current += 1;
        return { key: `${counter.current}`, name: file.name, file };
      });
      setItems((current) => [...current, ...queued.map(({ key, name }) => ({ key, name, state: { kind: "queued" } as const }))]);
      // A small pool of workers pulls from the queue, PARALLEL_UPLOADS at a time.
      let next = 0;
      const worker = async () => {
        while (next < queued.length) {
          const entry = queued[next];
          next += 1;
          if (entry) {
            try {
              await uploadOne(entry.key, entry.file);
            } catch {
              update(entry.key, { kind: "error", message: "Something went wrong. Try this photo again." });
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, queued.length) }, worker));
    },
    [update, uploadOne],
  );

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const active = items.filter((item) => item.state.kind !== "done" && item.state.kind !== "error").length;
  const failed = items.filter((item) => item.state.kind === "error").length;
  const finished = items.filter((item) => item.state.kind === "done").length;

  return (
    <section aria-labelledby="upload-heading" className="space-y-4">
      <h2 id="upload-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
        Add photos
      </h2>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed px-4 py-8 text-center ${dragging ? "border-red-text bg-cream/10" : "border-cream/60"}`}
      >
        <label className="btn-primary cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cream">
          Choose photos
          <input
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addFiles(files);
            }}
          />
        </label>
        <p className="mt-3 text-sm text-cream/90">
          Or drag them here. JPEG, PNG, WebP, or iPhone HEIC, up to 25 MB each. Location and camera details are removed.
          {publishesDirectly ? " Your photos go live when you publish them." : " An Admin approves photos before they go live."}
        </p>
      </div>

      <p role="status" aria-live="polite" className="text-sm">
        {items.length === 0
          ? ""
          : active > 0
            ? `Uploading ${active} of ${items.length}…`
            : `${finished} uploaded${failed > 0 ? `, ${failed} didn't work` : ""}. Add descriptions below.`}
      </p>

      {items.length > 0 && (
        <ul className="space-y-2" aria-label="Uploads">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate" title={item.name}>
                {item.name}
              </span>
              {item.state.kind === "uploading" && (
                <progress max={100} value={item.state.percent} aria-label={`Uploading ${item.name}`} className="w-32" />
              )}
              <span className={item.state.kind === "error" ? "font-semibold text-red-text" : ""}>{statusText(item.state)}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && active === 0 && (
        <button type="button" onClick={() => setItems([])} className="text-sm underline">
          Clear this list
        </button>
      )}
    </section>
  );
}
