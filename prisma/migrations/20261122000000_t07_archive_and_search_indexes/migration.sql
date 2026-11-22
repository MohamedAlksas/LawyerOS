-- AlterTable
ALTER TABLE "matter" ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN "archiveReason" TEXT;

-- AlterTable
ALTER TABLE "proceeding" ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN "archiveReason" TEXT,
ADD COLUMN "numberNormalized" TEXT,
ADD COLUMN "yearNormalized" TEXT;

-- Backfill normalized proceeding docket numbers and years
UPDATE "proceeding"
SET
  "numberNormalized" = trim(translate("numberText", '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')),
  "yearNormalized" = trim(translate("yearLabel", '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
WHERE "numberText" IS NOT NULL OR "yearLabel" IS NOT NULL;

-- Backfill archivedAt for existing archived matters (if any)
UPDATE "matter"
SET "archivedAt" = "updatedAt"
WHERE "status" = 'ARCHIVED' AND "archivedAt" IS NULL;

-- CreateIndex
CREATE INDEX "matter_status_updatedAt_idx" ON "matter"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "matter_archivedAt_idx" ON "matter"("archivedAt");

-- CreateIndex
CREATE INDEX "proceeding_numberNormalized_yearLabel_idx" ON "proceeding"("numberNormalized", "yearLabel");

-- CreateIndex
CREATE INDEX "proceeding_courtId_numberNormalized_idx" ON "proceeding"("courtId", "numberNormalized");

-- CreateIndex
CREATE INDEX "proceeding_archivedAt_idx" ON "proceeding"("archivedAt");
