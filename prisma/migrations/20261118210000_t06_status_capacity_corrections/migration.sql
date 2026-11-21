-- Migration 8: Status Enum Alignment and Extensible Legal Capacity Text
-- Align MatterStatus and ProceedingStatus with DATA_MODEL.md and add capacityText to ProceedingParty

-- 1. Align MatterStatus: replace SUSPENDED with ON_HOLD, add ARCHIVED
DROP INDEX IF EXISTS "matter_status_idx";

CREATE TYPE "MatterStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'ARCHIVED');

ALTER TABLE "matter" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "matter" ALTER COLUMN "status" TYPE "MatterStatus_new" USING (
  CASE "status"::text
    WHEN 'SUSPENDED' THEN 'ON_HOLD'::"MatterStatus_new"
    ELSE "status"::text::"MatterStatus_new"
  END
);

ALTER TABLE "matter" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"MatterStatus_new";

DROP TYPE "MatterStatus";

ALTER TYPE "MatterStatus_new" RENAME TO "MatterStatus";

CREATE INDEX "matter_status_idx" ON "matter"("status");

-- 2. Align ProceedingStatus: replace JUDGMENT_ISSUED/SUSPENDED with AWAITING_JUDGMENT and DECIDED
CREATE TYPE "ProceedingStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'AWAITING_JUDGMENT', 'DECIDED', 'CLOSED');

ALTER TABLE "proceeding" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "proceeding" ALTER COLUMN "status" TYPE "ProceedingStatus_new" USING (
  CASE "status"::text
    WHEN 'JUDGMENT_ISSUED' THEN 'DECIDED'::"ProceedingStatus_new"
    WHEN 'SUSPENDED' THEN 'AWAITING_JUDGMENT'::"ProceedingStatus_new"
    ELSE "status"::text::"ProceedingStatus_new"
  END
);

ALTER TABLE "proceeding" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"ProceedingStatus_new";

DROP TYPE "ProceedingStatus";

ALTER TYPE "ProceedingStatus_new" RENAME TO "ProceedingStatus";

-- 3. Add bounded capacityText to ProceedingParty and make legalCapacity optional
ALTER TABLE "proceeding_party" ADD COLUMN "capacityText" VARCHAR(100);

UPDATE "proceeding_party" SET "capacityText" = CAST("legalCapacity" AS TEXT) WHERE "capacityText" IS NULL;

ALTER TABLE "proceeding_party" ALTER COLUMN "capacityText" SET NOT NULL;

ALTER TABLE "proceeding_party" ALTER COLUMN "legalCapacity" DROP NOT NULL;