-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "TakedownResolution" AS ENUM ('RESTORED', 'DELETED');

-- AlterEnum
ALTER TYPE "PhotoStatus" ADD VALUE 'TAKEN_DOWN';

-- CreateTable
CREATE TABLE "takedown_notice" (
    "id" UUID NOT NULL,
    "mediaKind" "MediaKind" NOT NULL,
    "mediaId" UUID NOT NULL,
    "mediaLabel" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "workClaimed" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "actedById" TEXT NOT NULL,
    "actedByRole" "Role" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" "TakedownResolution",
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,

    CONSTRAINT "takedown_notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "takedown_notice_mediaKind_mediaId_idx" ON "takedown_notice"("mediaKind", "mediaId");

-- CreateIndex
CREATE INDEX "takedown_notice_createdAt_idx" ON "takedown_notice"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "takedown_notice" ADD CONSTRAINT "takedown_notice_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takedown_notice" ADD CONSTRAINT "takedown_notice_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
