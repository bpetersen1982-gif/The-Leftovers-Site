-- CreateEnum
CREATE TYPE "ShowStatus" AS ENUM ('SCHEDULED', 'SOLD_OUT', 'CANCELLED');

-- AlterTable
ALTER TABLE "album" ADD COLUMN     "showId" UUID;

-- AlterTable
ALTER TABLE "video" ADD COLUMN     "showId" UUID;

-- CreateTable
CREATE TABLE "show" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "venueName" TEXT NOT NULL,
    "street" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NE',
    "ticketUrl" TEXT,
    "priceText" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ShowStatus" NOT NULL DEFAULT 'SCHEDULED',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "bookingRequestId" UUID,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "show_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "show_slug_key" ON "show"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "show_bookingRequestId_key" ON "show"("bookingRequestId");

-- CreateIndex
CREATE INDEX "show_isPublic_date_idx" ON "show"("isPublic", "date");

-- CreateIndex
CREATE INDEX "show_date_idx" ON "show"("date");

-- AddForeignKey
ALTER TABLE "album" ADD CONSTRAINT "album_showId_fkey" FOREIGN KEY ("showId") REFERENCES "show"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video" ADD CONSTRAINT "video_showId_fkey" FOREIGN KEY ("showId") REFERENCES "show"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show" ADD CONSTRAINT "show_bookingRequestId_fkey" FOREIGN KEY ("bookingRequestId") REFERENCES "booking_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show" ADD CONSTRAINT "show_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
