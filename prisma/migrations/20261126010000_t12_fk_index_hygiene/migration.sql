BEGIN;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "upload_attempt_document_id_idx" ON "upload_attempt"("document_id");

-- DropIndex
DROP INDEX IF EXISTS "backup_file_pin_document_version_id_idx";

COMMIT;
