-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('BAR_CLUB', 'FESTIVAL', 'WEDDING', 'GRADUATION', 'PRIVATE_PARTY', 'CORPORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "DayCategory" AS ENUM ('SUN_THU', 'FRI_SAT', 'SPECIAL');

-- CreateTable
CREATE TABLE "pricing_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minSets" INTEGER NOT NULL DEFAULT 1,
    "maxSets" INTEGER NOT NULL DEFAULT 4,
    "quoteValidityHours" INTEGER NOT NULL DEFAULT 72,
    "minNoticeDays" INTEGER NOT NULL DEFAULT 7,
    "travelRadiusMiles" INTEGER NOT NULL DEFAULT 60,
    "originZip" TEXT NOT NULL DEFAULT '68508',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_rule" (
    "id" UUID NOT NULL,
    "eventType" "EventType" NOT NULL,
    "dayCategory" "DayCategory" NOT NULL,
    "ratePerSetCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_date" (
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_date_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_rule_eventType_dayCategory_key" ON "rate_rule"("eventType", "dayCategory");

-- Invariants enforced by the database.
ALTER TABLE "rate_rule" ADD CONSTRAINT "rate_rule_positive" CHECK ("ratePerSetCents" > 0 AND "ratePerSetCents" <= 10000000);
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_singleton" CHECK ("id" = 1);
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_ranges" CHECK (
  "minSets" >= 1 AND "maxSets" >= "minSets" AND "maxSets" <= 8
  AND "quoteValidityHours" BETWEEN 1 AND 720
  AND "minNoticeDays" BETWEEN 0 AND 365
  AND "travelRadiusMiles" BETWEEN 1 AND 500
  AND "originZip" ~ '^[0-9]{5}$'
);

-- Seed the singleton with the agreed defaults. No rates: every request uses the contact
-- path until an Admin enters prices.
INSERT INTO "pricing_settings" ("id", "updatedAt") VALUES (1, NOW()) ON CONFLICT ("id") DO NOTHING;
