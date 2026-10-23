"use client";

import { useActionForm } from "../../use-action-form";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BlockContent } from "@/components/block-content";
import { parseBlocks } from "@/lib/content/blocks";
import type { PageSlug } from "@/lib/content/pages";
import { type SaveState, savePageAction } from "../../content-actions";
import { DARK_INPUT_CLASS, FormMessage, FormattingHelp, LABEL_CLASS } from "../../form-ui";

export function PageEditor({
  slug,
  initialSource,
  initialVersion,
  publicPath,
}: {
  slug: PageSlug;
  initialSource: string;
  initialVersion: number;
  publicPath: string;
}) {
  const [state, formAction, pending] = useActionForm<SaveState>(savePageAction, {
    ok: false,
    message: null,
    version: initialVersion,
  });
  const [source, setSource] = useState(initialSource);
  const preview = useMemo(() => parseBlocks(source), [source]);
  const version = state.version ?? initialVersion;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={formAction} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="version" value={version} />
        <label htmlFor="content" className={LABEL_CLASS}>
          Page text
        </label>
        <textarea
          id="content"
          name="content"
          rows={18}
          maxLength={20_000}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-describedby="content-help"
          className={`${DARK_INPUT_CLASS} font-mono text-sm`}
        />
        <FormattingHelp id="content-help" />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
          <Link href={publicPath} className="underline">
            View page
          </Link>
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      </form>
      <section aria-labelledby="preview-heading">
        <h2 id="preview-heading" className={LABEL_CLASS}>
          Preview
        </h2>
        <div className="mt-2 border border-olive/60 px-4 py-4">
          {preview.length ? <BlockContent blocks={preview} /> : <p className="italic">Empty: this section won&apos;t show.</p>}
        </div>
      </section>
    </div>
  );
}
