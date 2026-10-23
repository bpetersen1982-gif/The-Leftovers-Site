-- AlterEnum
ALTER TYPE "BookingEventKind" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "booking_request" ADD COLUMN     "agreedPriceCents" INTEGER,
ADD COLUMN     "confirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "loadInTime" TEXT;

-- AlterTable
ALTER TABLE "date_claim" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMPTZ(3);

ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_agreed_price_positive" CHECK ("agreedPriceCents" IS NULL OR "agreedPriceCents" BETWEEN 0 AND 100000000);
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_load_in_format" CHECK ("loadInTime" IS NULL OR "loadInTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
-- Only PENDING claims (holds) may expire; a booked date never silently frees up.
ALTER TABLE "date_claim" ADD CONSTRAINT "date_claim_only_pending_expires" CHECK ("expiresAt" IS NULL OR "kind" = 'PENDING');
