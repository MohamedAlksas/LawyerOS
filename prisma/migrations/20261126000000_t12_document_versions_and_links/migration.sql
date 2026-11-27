BEGIN;

-- 1. Additive columns (idempotent)
ALTER TABLE "power_of_attorney"
    ADD COLUMN IF NOT EXISTS "document_id" TEXT;

ALTER TABLE "hearing_result"
    ADD COLUMN IF NOT EXISTS "decision_document_id" TEXT;

ALTER TABLE "upload_attempt"
    ADD COLUMN IF NOT EXISTS "expected_document_version" INTEGER;

-- 2. Indexes (idempotent; deadline.source_document_id already exists from T09)
CREATE INDEX IF NOT EXISTS "power_of_attorney_document_id_idx"
    ON "power_of_attorney"("document_id");

CREATE INDEX IF NOT EXISTS "hearing_result_decision_document_id_idx"
    ON "hearing_result"("decision_document_id");

CREATE INDEX IF NOT EXISTS "deadline_source_document_id_idx"
    ON "deadline"("source_document_id");

CREATE INDEX IF NOT EXISTS "backup_file_pin_document_version_id_released_at_idx"
    ON "backup_file_pin"("document_version_id", "released_at");

-- 3. Check & Foreign Key Constraints (idempotent via pg_constraint guards)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'upload_attempt_expected_document_version_check'
          AND conrelid = '"upload_attempt"'::regclass
    ) THEN
        ALTER TABLE "upload_attempt"
            ADD CONSTRAINT "upload_attempt_expected_document_version_check"
            CHECK ("expected_document_version" IS NULL OR "expected_document_version" >= 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'power_of_attorney_document_id_fkey'
          AND conrelid = '"power_of_attorney"'::regclass
    ) THEN
        ALTER TABLE "power_of_attorney"
            ADD CONSTRAINT "power_of_attorney_document_id_fkey"
            FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'hearing_result_decision_document_id_fkey'
          AND conrelid = '"hearing_result"'::regclass
    ) THEN
        ALTER TABLE "hearing_result"
            ADD CONSTRAINT "hearing_result_decision_document_id_fkey"
            FOREIGN KEY ("decision_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'deadline_source_document_id_fkey'
          AND conrelid = '"deadline"'::regclass
    ) THEN
        ALTER TABLE "deadline"
            ADD CONSTRAINT "deadline_source_document_id_fkey"
            FOREIGN KEY ("source_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
