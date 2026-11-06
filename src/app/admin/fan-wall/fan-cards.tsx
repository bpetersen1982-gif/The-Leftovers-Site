"use client";

import { useId } from "react";
import type { ModerationPost } from "@/lib/fan/queries";
import { INITIAL_ACTION_STATE } from "../action-state";
import { DARK_INPUT_CLASS, FormMessage, LABEL_CLASS, SECONDARY_BUTTON } from "../form-ui";
import { useActionForm } from "../use-action-form";
import { decideFanPostsAction, deleteFanPostAction, fanAltTextAction } from "./actions";

const STAMP = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });

function PostBody({ post }: { post: ModerationPost }) {
  const small = post.photo?.image?.sources[1] ?? post.photo?.image?.sources[0];
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold">{post.displayName}</span> · {STAMP.format(post.createdAt)}
        {post.showLabel ? ` · at ${post.showLabel}` : ""}
      </p>
      {post.email && (
        <p className="text-sm">
          <a href={`mailto:${post.email}`} className="underline">
            {post.email}
          </a>{" "}
          <span className="text-cream/80">(band only)</span>
        </p>
      )}
      <p className="whitespace-pre-line">{post.message}</p>
      {post.photo && small && (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized variant (signed or CDN URL)
        <img src={small.url} width={small.width} height={small.height} alt={post.photo.altText || "Fan photo (no description yet)"} loading="lazy" className="max-h-72 w-auto bg-charcoal" />
      )}
      {post.photoFailureReason && <p className="text-sm text-cream/80">They tried to add a photo, but it couldn&apos;t be used: {post.photoFailureReason}</p>}
    </div>
  );
}

function AltTextForm({ post }: { post: ModerationPost }) {
  const [state, onSubmit, pending] = useActionForm(fanAltTextAction, INITIAL_ACTION_STATE);
  const id = useId();
  if (!post.photo || !post.canChange) return null;
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={post.id} />
      <input type="hidden" name="version" value={post.version} />
      <div className="min-w-56 flex-1">
        <label htmlFor={id} className={LABEL_CLASS}>
          Photo description{post.photo.altText ? "" : " (needed to approve)"}
        </label>
        <input id={id} name="altText" maxLength={250} defaultValue={post.photo.altText} className={DARK_INPUT_CLASS} />
      </div>
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        Save
      </button>
      <FormMessage ok={state.ok} message={state.ok ? null : state.message} />
    </form>
  );
}

/** Pending posts with bulk approve/reject and an optional reason (APR-9). */
export function FanQueue({ posts }: { posts: readonly ModerationPost[] }) {
  const [state, onSubmit, pending] = useActionForm(decideFanPostsAction, INITIAL_ACTION_STATE);
  const formId = useId();
  if (posts.length === 0) {
    return (
      <div className="space-y-2">
        <FormMessage ok={state.ok} message={state.message} />
        <p className="text-cream/90">Nothing waiting.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {posts.map((post) => (
          <li key={`${post.id}:${post.version}`}>
            <article className="space-y-3 border border-olive/60 p-4" aria-label={`Post from ${post.displayName}`}>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" name="post" value={`${post.id}:${post.version}`} form={formId} className="size-5" />
                Select post from {post.displayName}
              </label>
              <PostBody post={post} />
              <AltTextForm post={post} />
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
            Reason (optional, band only)
          </label>
          <input id={`${formId}-reason`} name="reason" maxLength={250} className={DARK_INPUT_CLASS} />
        </div>
        <FormMessage ok={state.ok} message={state.message} />
      </form>
    </div>
  );
}

/** A decided post: who decided, and the option to change it (APR-4, APR-5). */
export function DecidedCard({ post, canDelete }: { post: ModerationPost; canDelete: boolean }) {
  const [state, onSubmit, pending] = useActionForm(decideFanPostsAction, INITIAL_ACTION_STATE);
  const [deleteState, onDelete, deleting] = useActionForm(deleteFanPostAction, INITIAL_ACTION_STATE);
  const reasonId = useId();
  const flipTo = post.status === "APPROVED" ? "reject" : "approve";
  const flipLabel = `${post.isOverride ? "Override: " : ""}${flipTo === "approve" ? "Approve" : "Reject"}`;
  return (
    <article className="space-y-3 border border-olive/60 p-4" aria-label={`${post.status === "APPROVED" ? "Approved" : "Rejected"} post from ${post.displayName}`}>
      <p className="font-heading text-sm tracking-wider uppercase">
        <span className={post.status === "APPROVED" ? "" : "text-red-text"}>{post.status === "APPROVED" ? "Approved" : "Rejected"}</span> by {post.decidedByName}
        {post.decidedByRole ? ` (${post.decidedByRole === "ADMIN" ? "Admin" : "Band Member"})` : ""}
        {post.decidedAt ? ` · ${STAMP.format(post.decidedAt)}` : ""}
      </p>
      {post.decisionReason && <p className="text-sm">Reason: {post.decisionReason}</p>}
      <PostBody post={post} />
      <AltTextForm post={post} />
      {post.canChange ? (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="post" value={`${post.id}:${post.version}`} />
          <div className="min-w-56 flex-1">
            <label htmlFor={reasonId} className={LABEL_CLASS}>
              Reason (optional)
            </label>
            <input id={reasonId} name="reason" maxLength={250} className={DARK_INPUT_CLASS} />
          </div>
          <button type="submit" name="intent" value={flipTo} disabled={pending} className={SECONDARY_BUTTON}>
            {flipLabel}
            <span className="sr-only"> post from {post.displayName}</span>
          </button>
        </form>
      ) : (
        <p className="text-sm text-cream/90">An Admin made this call, so only an Admin can change it.</p>
      )}
      <FormMessage ok={state.ok} message={state.message} />
      {canDelete && (
        <form
          onSubmit={(event) => {
            if (!window.confirm(`Delete this post from ${post.displayName} for good? This removes their message, email, and photo.`)) {
              event.preventDefault();
              return;
            }
            onDelete(event);
          }}
        >
          <input type="hidden" name="id" value={post.id} />
          <input type="hidden" name="version" value={post.version} />
          <button type="submit" disabled={deleting} className="text-sm underline">
            Delete permanently<span className="sr-only"> post from {post.displayName}</span>
          </button>
          <FormMessage ok={deleteState.ok} message={deleteState.ok ? null : deleteState.message} />
        </form>
      )}
    </article>
  );
}
