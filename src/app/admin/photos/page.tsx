import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { type BandPhoto, getBandPhotoBoard } from "@/lib/photos/queries";
import { objectStorage } from "@/lib/storage";
import { type CardPhoto, MyPhotoCard, PendingCard, PublishedCard, RemovedCard, ReviewQueue } from "./photo-cards";
import { PhotoUploader } from "./uploader";

export const metadata: Metadata = { title: "Photos" };

function toCard(photo: BandPhoto): CardPhoto {
  return {
    id: photo.id,
    version: photo.version,
    status: photo.status,
    originalFilename: photo.originalFilename,
    altText: photo.altText,
    caption: photo.caption,
    credit: photo.credit,
    failureReason: photo.failureReason,
    rejectionReason: photo.rejectionReason,
    removalReason: photo.removalReason,
    removalRequestedByName: photo.removalRequestedByName,
    uploaderName: photo.uploaderName,
    isMine: photo.isMine,
    image: photo.image,
  };
}

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

export default async function AdminPhotosPage() {
  const viewer = await requirePermission("photos:upload");
  const storage = objectStorage();
  if (!storage) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Photos</h1>
        <p>Photo storage isn&apos;t configured on this server yet (R2 settings are missing).</p>
      </div>
    );
  }
  const board = await getBandPhotoBoard(db(), storage, viewer);
  const isReviewer = can(viewer.role, "photos:review");
  const canDelete = can(viewer.role, "photos:delete");
  const publishesDirectly = can(viewer.role, "photos:publishDirectly");
  const submitLabel = publishesDirectly ? "Save and publish" : "Save and send for review";

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Photos</h1>
        <Link href="/photos" className="underline">
          View public page
        </Link>
      </div>

      <PhotoUploader publishesDirectly={publishesDirectly} />

      <section aria-labelledby="mine-heading" className="space-y-4">
        <h2 id="mine-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Your unpublished photos ({board.mine.length})
        </h2>
        {board.mine.length === 0 ? (
          <p className="text-cream/90">Nothing waiting on you. New uploads show up here so you can describe them.</p>
        ) : (
          <>
            <p className="text-cream/90">
              Only the band can see these. Add alt text (a short description for people using screen readers), then{" "}
              {publishesDirectly ? "publish." : "send them to an Admin."}
            </p>
            <ul className={GRID}>
              {board.mine.map((photo) => (
                <li key={`${photo.id}:${photo.version}`}>
                  <MyPhotoCard photo={toCard(photo)} submitLabel={submitLabel} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section id="review" aria-labelledby="review-heading" className="space-y-4">
        <h2 id="review-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          {isReviewer ? "Waiting for review" : "Waiting for an Admin"} ({board.pending.length})
        </h2>
        {isReviewer ? (
          <ReviewQueue photos={board.pending.map(toCard)} />
        ) : board.pending.length === 0 ? (
          <p className="text-cream/90">Nothing waiting.</p>
        ) : (
          <ul className={GRID}>
            {board.pending.map((photo) => (
              <li key={`${photo.id}:${photo.version}`}>
                <PendingCard photo={toCard(photo)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="published-heading" className="space-y-4">
        <h2 id="published-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
          Published ({board.publishedTotal})
        </h2>
        {board.published.length === 0 ? (
          <p className="text-cream/90">No photos on the public site yet.</p>
        ) : (
          <>
            {board.publishedTotal > board.published.length && (
              <p className="text-sm text-cream/90">Showing the newest {board.published.length}.</p>
            )}
            <ul className={GRID}>
              {board.published.map((photo) => (
                <li key={`${photo.id}:${photo.version}`}>
                  <PublishedCard photo={toCard(photo)} isAdmin={canDelete} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {board.removed.length > 0 && (
        <section id="removed" aria-labelledby="removed-heading" className="space-y-4">
          <h2 id="removed-heading" className="font-heading text-xl font-bold tracking-wider uppercase">
            Removed from site ({board.removed.length})
          </h2>
          <p className="text-cream/90">
            {canDelete
              ? "These are hidden from the public. Delete them for good, or put them back."
              : "These are hidden from the public until an Admin deletes them or puts them back."}
          </p>
          <ul className={GRID}>
            {board.removed.map((photo) => (
              <li key={`${photo.id}:${photo.version}`}>
                <RemovedCard photo={toCard(photo)} isAdmin={canDelete} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
