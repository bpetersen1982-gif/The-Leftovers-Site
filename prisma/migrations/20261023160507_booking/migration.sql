-- CreateEnum
CREATE TYPE "BookingRequestKind" AS ENUM ('WIZARD', 'DATE_CONTACT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('IN_PROGRESS', 'AWAITING_CONTACT', 'QUOTED', 'ACCEPTED', 'DECLINED_BY_PROSPECT', 'CONTACTED', 'CONFIRMED', 'DECLINED_BY_BAND', 'WITHDRAWN', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SoundProvided" AS ENUM ('YES', 'NO', 'PARTIAL', 'UNSURE');

-- CreateEnum
CREATE TYPE "Setting" AS ENUM ('INDOOR', 'OUTDOOR', 'UNSURE');

-- CreateEnum
CREATE TYPE "ClaimKind" AS ENUM ('PENDING', 'BOOKED');

-- CreateEnum
CREATE TYPE "BookingEventKind" AS ENUM ('STATUS', 'NOTE', 'CONTACTED');

-- CreateTable
CREATE TABLE "booking_request" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "BookingRequestKind" NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "eventDate" DATE,
    "startTime" TEXT,
    "endTime" TEXT,
    "sets" INTEGER,
    "eventType" "EventType",
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "street" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "zip" TEXT NOT NULL DEFAULT '',
    "attendance" INTEGER,
    "setting" "Setting",
    "soundProvided" "SoundProvided",
    "message" TEXT NOT NULL DEFAULT '',
    "distanceMiles" DOUBLE PRECISION,
    "ineligibleReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isConflict" BOOLEAN NOT NULL DEFAULT false,
    "accessTokenHash" TEXT NOT NULL,
    "responseNote" TEXT NOT NULL DEFAULT '',
    "respondedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "eventType" "EventType" NOT NULL,
    "dayCategory" "DayCategory" NOT NULL,
    "ratePerSetCents" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "supersededAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "date_claim" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ClaimKind" NOT NULL,
    "requestId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "date_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_event" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" "BookingEventKind" NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus",
    "body" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_request_reference_key" ON "booking_request"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "booking_request_accessTokenHash_key" ON "booking_request"("accessTokenHash");

-- CreateIndex
CREATE INDEX "booking_request_status_eventDate_idx" ON "booking_request"("status", "eventDate");

-- CreateIndex
CREATE INDEX "booking_request_eventDate_idx" ON "booking_request"("eventDate");

-- CreateIndex
CREATE INDEX "booking_request_email_createdAt_idx" ON "booking_request"("email", "createdAt");

-- CreateIndex
CREATE INDEX "quote_requestId_createdAt_idx" ON "quote"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "date_claim_date_key" ON "date_claim"("date");

-- CreateIndex
CREATE UNIQUE INDEX "date_claim_requestId_key" ON "date_claim"("requestId");

-- CreateIndex
CREATE INDEX "booking_event_requestId_createdAt_idx" ON "booking_event"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "booking_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "date_claim" ADD CONSTRAINT "date_claim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "booking_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_event" ADD CONSTRAINT "booking_event_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "booking_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants enforced by the database.
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_sets_range" CHECK ("sets" IS NULL OR "sets" BETWEEN 1 AND 8);
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_note_length" CHECK (char_length("responseNote") <= 250);
ALTER TABLE "booking_request" ADD CONSTRAINT "booking_request_times_format" CHECK (
  ("startTime" IS NULL OR "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND
  ("endTime" IS NULL OR "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
ALTER TABLE "quote" ADD CONSTRAINT "quote_math" CHECK ("ratePerSetCents" > 0 AND "sets" >= 1 AND "totalCents" = "ratePerSetCents" * "sets");
