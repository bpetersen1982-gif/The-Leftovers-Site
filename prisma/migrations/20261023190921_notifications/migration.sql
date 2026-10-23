-- AlterTable
ALTER TABLE "booking_request" ADD COLUMN     "reminder24SentAt" TIMESTAMPTZ(3),
ADD COLUMN     "reminder72SentAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "date_claim" ADD COLUMN     "expiryWarnedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "bookingEmailAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bookingPushAlerts" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'This device',
    "lastSuccessAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_userId_idx" ON "push_subscription"("userId");

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
