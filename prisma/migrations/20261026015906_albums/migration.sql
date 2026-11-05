-- CreateTable
CREATE TABLE "album" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "eventDate" DATE,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "coverPhotoId" UUID,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "album_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_item" (
    "albumId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_item_pkey" PRIMARY KEY ("albumId","photoId")
);

-- CreateIndex
CREATE UNIQUE INDEX "album_slug_key" ON "album"("slug");

-- CreateIndex
CREATE INDEX "album_isPublic_eventDate_idx" ON "album"("isPublic", "eventDate" DESC);

-- CreateIndex
CREATE INDEX "album_item_albumId_sortOrder_idx" ON "album_item"("albumId", "sortOrder");

-- CreateIndex
CREATE INDEX "album_item_photoId_idx" ON "album_item"("photoId");

-- AddForeignKey
ALTER TABLE "album" ADD CONSTRAINT "album_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album" ADD CONSTRAINT "album_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_item" ADD CONSTRAINT "album_item_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_item" ADD CONSTRAINT "album_item_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
