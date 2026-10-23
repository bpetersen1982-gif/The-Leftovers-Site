-- CreateEnum
CREATE TYPE "AvailabilityScope" AS ENUM ('MEMBER', 'BAND');

-- CreateTable
CREATE TABLE "availability_block" (
    "id" UUID NOT NULL,
    "scope" "AvailabilityScope" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "userId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "availability_block_startDate_endDate_idx" ON "availability_block"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "availability_block_userId_idx" ON "availability_block"("userId");

-- AddForeignKey
ALTER TABLE "availability_block" ADD CONSTRAINT "availability_block_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_block" ADD CONSTRAINT "availability_block_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants enforced by the database, not just the app.
ALTER TABLE "availability_block" ADD CONSTRAINT "availability_block_range_check" CHECK ("endDate" >= "startDate");
ALTER TABLE "availability_block" ADD CONSTRAINT "availability_block_scope_user_check"
  CHECK (("scope" = 'MEMBER' AND "userId" IS NOT NULL) OR ("scope" = 'BAND' AND "userId" IS NULL));
