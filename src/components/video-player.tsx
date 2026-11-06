"use client";

import { useState } from "react";

/**
 * Lazy Stream player (requirements MED-9, MED-10, PERF-1): shows only the poster image
 * until the visitor presses play, then swaps in Stream's player. Nothing autoplays on
 * page load, and no player JavaScript loads for videos nobody plays. Downloads stay off
 * (they're never enabled on Stream, so the player has no download option).
 */
export function VideoPlayer({ title, posterUrl, iframeUrl, priority = false }: { title: string; posterUrl: string; iframeUrl: string; priority?: boolean }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-charcoal">
      {playing ? (
        <iframe
          src={iframeUrl}
          title={title}
          className="absolute inset-0 size-full border-0"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 size-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream">
          {/* eslint-disable-next-line @next/next/no-img-element -- Stream thumbnail, already sized */}
          <img src={posterUrl} alt="" loading={priority ? "eager" : "lazy"} decoding="async" className="size-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center bg-ink/20 group-hover:bg-ink/10">
            <span className="flex size-16 items-center justify-center rounded-full bg-red-ui text-cream shadow-lg" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="ml-1 size-8 fill-current">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
          <span className="sr-only">Play video: {title}</span>
        </button>
      )}
    </div>
  );
}
