-- AlterEnum
ALTER TYPE "PhotoStatus" ADD VALUE 'DELETION_REQUESTED';

-- AlterTable
ALTER TABLE "photo" ADD COLUMN     "removalReason" TEXT,
ADD COLUMN     "removalRequestedAt" TIMESTAMPTZ(3),
ADD COLUMN     "removalRequestedById" TEXT,
ADD COLUMN     "removalRequestedByRole" "Role";

-- AddForeignKey
ALTER TABLE "photo" ADD CONSTRAINT "photo_removalRequestedById_fkey" FOREIGN KEY ("removalRequestedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
