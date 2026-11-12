-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- CreateTable
CREATE TABLE "subscriber" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "confirmTokenHash" TEXT,
    "confirmTokenExpiresAt" TIMESTAMPTZ(3),
    "unsubscribeTokenHash" TEXT NOT NULL,
    "lastConfirmationSentAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_email_key" ON "subscriber"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_confirmTokenHash_key" ON "subscriber"("confirmTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_unsubscribeTokenHash_key" ON "subscriber"("unsubscribeTokenHash");

-- CreateIndex
CREATE INDEX "subscriber_status_confirmedAt_idx" ON "subscriber"("status", "confirmedAt" DESC);

-- CreateIndex
CREATE INDEX "subscriber_status_createdAt_idx" ON "subscriber"("status", "createdAt");
