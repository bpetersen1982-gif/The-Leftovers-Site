-- CreateEnum
CREATE TYPE "PressFileKind" AS ENUM ('LOGO', 'RIDER', 'STAGE_PLOT');

-- AlterTable
ALTER TABLE "photo" ADD COLUMN     "isPressPhoto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "video" ADD COLUMN     "isPressHighlight" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "press_file" (
    "kind" "PressFileKind" NOT NULL,
    "publicKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "press_file_pkey" PRIMARY KEY ("kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "press_file_publicKey_key" ON "press_file"("publicKey");

-- AddForeignKey
ALTER TABLE "press_file" ADD CONSTRAINT "press_file_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
