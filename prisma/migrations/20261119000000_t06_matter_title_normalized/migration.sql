-- AlterTable
ALTER TABLE "matter" ADD COLUMN "titleNormalized" TEXT;

-- Update existing records
UPDATE "matter" SET "titleNormalized" = "title";

-- CreateIndex
CREATE INDEX "matter_titleNormalized_idx" ON "matter"("titleNormalized");
