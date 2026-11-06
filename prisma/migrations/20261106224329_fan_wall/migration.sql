-- CreateEnum
CREATE TYPE "FanPostStatus" AS ENUM ('AWAITING_PHOTO', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationVerdict" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "fan_post" (
    "id" UUID NOT NULL,
    "status" "FanPostStatus" NOT NULL DEFAULT 'PENDING',
    "displayName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "email" TEXT,
    "showId" UUID,
    "photoUploadTokenHash" TEXT,
    "photoUploadExpiresAt" TIMESTAMPTZ(3),
    "photoDeclaredType" TEXT,
    "photoDeclaredSize" INTEGER,
    "photoWidth" INTEGER,
    "photoHeight" INTEGER,
    "photoVariants" JSONB NOT NULL DEFAULT '[]',
    "photoBlurDataUrl" TEXT,
    "photoPublicPrefix" TEXT,
    "photoAltText" TEXT NOT NULL DEFAULT '',
    "photoFailureReason" TEXT,
    "photoConsentAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" TEXT,
    "decidedByRole" "Role",
    "decisionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fan_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decision" (
    "id" UUID NOT NULL,
    "fanPostId" UUID NOT NULL,
    "verdict" "ModerationVerdict" NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "overridesDecisionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fan_post_photoUploadTokenHash_key" ON "fan_post"("photoUploadTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "fan_post_photoPublicPrefix_key" ON "fan_post"("photoPublicPrefix");

-- CreateIndex
CREATE INDEX "fan_post_status_createdAt_idx" ON "fan_post"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "fan_post_showId_status_idx" ON "fan_post"("showId", "status");

-- CreateIndex
CREATE INDEX "fan_post_status_photoUploadExpiresAt_idx" ON "fan_post"("status", "photoUploadExpiresAt");

-- CreateIndex
CREATE INDEX "moderation_decision_createdAt_idx" ON "moderation_decision"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "moderation_decision_fanPostId_createdAt_idx" ON "moderation_decision"("fanPostId", "createdAt");

-- AddForeignKey
ALTER TABLE "fan_post" ADD CONSTRAINT "fan_post_showId_fkey" FOREIGN KEY ("showId") REFERENCES "show"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fan_post" ADD CONSTRAINT "fan_post_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decision" ADD CONSTRAINT "moderation_decision_fanPostId_fkey" FOREIGN KEY ("fanPostId") REFERENCES "fan_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decision" ADD CONSTRAINT "moderation_decision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decision" ADD CONSTRAINT "moderation_decision_overridesDecisionId_fkey" FOREIGN KEY ("overridesDecisionId") REFERENCES "moderation_decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
