-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'PUBLISHED', 'DELETION_REQUESTED', 'TAKEN_DOWN', 'FAILED');

-- CreateTable
CREATE TABLE "video" (
    "id" UUID NOT NULL,
    "streamUid" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOADING',
    "uploaderId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "uploadExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "playbackOrigin" TEXT,
    "failureReason" TEXT,
    "streamPublic" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "posterSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "captionsLanguage" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "removalRequestedAt" TIMESTAMPTZ(3),
    "removalRequestedById" TEXT,
    "removalRequestedByRole" "Role",
    "removalReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_streamUid_key" ON "video"("streamUid");

-- CreateIndex
CREATE INDEX "video_status_publishedAt_idx" ON "video"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "video_status_updatedAt_idx" ON "video"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "video" ADD CONSTRAINT "video_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video" ADD CONSTRAINT "video_removalRequestedById_fkey" FOREIGN KEY ("removalRequestedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
