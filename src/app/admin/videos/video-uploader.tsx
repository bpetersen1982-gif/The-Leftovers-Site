"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { finishVideoUploadAction, startVideoUploadAction } from "./actions";

/**
 * Admin video upload (requirements MED-6): straight from the browser to Cloudflare Stream
 * over tus, so big files survive flaky connections (it resumes, and retries on errors).
 * One file at a time; the server re-validates name and size before issuing the URL.
 */

const CHUNK_BYTES = 50 * 1024 * 1024; // Stream wants chunks that are multiples of 256 KiB, 5 MB+.
const RETRY_DELAYS_MS = [0, 3_000, 10_000, 30_000, 60_000];

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading"; readonly name: string; readonly percent: number }
  | { readonly kind: "finishing"; readonly name: string }
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export function VideoUploader({ maxGigabytes }: { maxGigabytes: number }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const uploadRef = useRef<Upload | null>(null);
  const busy = state.kind === "uploading" || state.kind === "finishing";

  // Leaving the page mid-upload loses progress; ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function start(file: File) {
    if (file.size > maxGigabytes * 1024 ** 3) return setState({ kind: "error", message: `That file is over ${maxGigabytes} GB.` });
    setState({ kind: "uploading", name: file.name, percent: 0 });
    const started = await startVideoUploadAction({ filename: file.name, size: file.size });
    if (!started.ok) return setState({ kind: "error", message: started.message });

    const upload = new Upload(file, {
      uploadUrl: started.uploadUrl,
      chunkSize: CHUNK_BYTES,
      retryDelays: RETRY_DELAYS_MS,
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => setState({ kind: "uploading", name: file.name, percent: total ? Math.floor((sent / total) * 100) : 0 }),
      onError: () => {
        uploadRef.current = null;
        setState({ kind: "error", message: "The upload stopped and couldn't resume. Check your connection and try again." });
      },
      onSuccess: () => {
        uploadRef.current = null;
        setState({ kind: "finishing", name: file.name });
        void finishVideoUploadAction(started.videoId).then((result) => {
          setState(result.ok ? { kind: "done", message: result.message } : { kind: "error", message: result.message });
          router.refresh();
        });
      },
    });
    uploadRef.current = upload;
    upload.start();
  }

  return (
    <section aria-labelledby="video-upload-heading" className="space-y-3">
      <h2 id="video-upload-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
        Add a video
      </h2>
      <label className={`btn-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cream ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
        Choose a video
        <input
          type="file"
          accept="video/*,.mov,.mp4,.m4v,.mkv,.webm"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void start(file);
          }}
        />
      </label>
      <p className="text-sm text-cream/90">
        Up to {maxGigabytes} GB. Large files keep going if the connection drops, as long as this page stays open. Short highlight clips are
        safer than full songs (copyright).
      </p>
      <div role="status" aria-live="polite" className="text-sm">
        {state.kind === "uploading" && (
          <span className="flex flex-wrap items-center gap-3">
            <span className="truncate">{state.name}</span>
            <progress max={100} value={state.percent} aria-label={`Uploading ${state.name}`} className="w-40" />
            <span>{state.percent}%</span>
            <button
              type="button"
              className="underline"
              onClick={() => {
                void uploadRef.current?.abort(true);
                uploadRef.current = null;
                setState({ kind: "error", message: "Upload cancelled." });
              }}
            >
              Cancel
            </button>
          </span>
        )}
        {state.kind === "finishing" && <span>Upload finished. Checking with Stream…</span>}
        {state.kind === "done" && <span className="font-semibold">{state.message}</span>}
        {state.kind === "error" && <span className="font-semibold text-red-text">{state.message}</span>}
      </div>
    </section>
  );
}

/** Reloads the page data every 15 seconds while something is still processing. */
export function RefreshWhileProcessing({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}
