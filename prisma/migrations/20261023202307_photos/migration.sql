-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "photo" (
    "id" UUID NOT NULL,
    "status" "PhotoStatus" NOT NULL DEFAULT 'UPLOADING',
    "uploaderId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "declaredType" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "originalKey" TEXT NOT NULL,
    "uploadExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "blurDataUrl" TEXT,
    "publicPrefix" TEXT,
    "altText" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "credit" TEXT NOT NULL DEFAULT '',
    "failureReason" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decidedByRole" "Role",
    "rejectionReason" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_originalKey_key" ON "photo"("originalKey");

-- CreateIndex
CREATE UNIQUE INDEX "photo_publicPrefix_key" ON "photo"("publicPrefix");

-- CreateIndex
CREATE INDEX "photo_status_publishedAt_idx" ON "photo"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "photo_status_uploadExpiresAt_idx" ON "photo"("status", "uploadExpiresAt");

-- CreateIndex
CREATE INDEX "photo_uploaderId_status_idx" ON "photo"("uploaderId", "status");

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
