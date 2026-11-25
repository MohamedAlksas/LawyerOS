BEGIN;

-- 1. Create document enums
CREATE TYPE "DocumentType" AS ENUM (
    'PLEADING',
    'MEMORANDUM',
    'CONTRACT',
    'POA_COPY',
    'JUDGMENT',
    'EVIDENCE',
    'RECEIPT_COPY',
    'CORRESPONDENCE',
    'ID_COPY',
    'OTHER'
);

CREATE TYPE "DocumentOriginalPresence" AS ENUM ('YES', 'NO', 'UNKNOWN');

CREATE TYPE "DocumentSensitivity" AS ENUM ('CONFIDENTIAL', 'RESTRICTED');

CREATE TYPE "DocumentVersionUploadStatus" AS ENUM ('UPLOADING', 'QUARANTINED', 'READY', 'REJECTED', 'FAILED');

CREATE TYPE "DocumentScanStatus" AS ENUM (
    'PENDING',
    'NOT_SCANNED_POLICY',
    'CLEAN',
    'INFECTED',
    'FAILED',
    'TIMEOUT',
    'STALE_DEFINITIONS'
);

CREATE TYPE "UploadAttemptStatus" AS ENUM (
    'INITIATED',
    'UPLOADED',
    'VALIDATING',
    'FINALIZED',
    'REJECTED',
    'FAILED',
    'EXPIRED'
);

-- 2. Create document table
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "matter_id" TEXT,
    "party_id" TEXT,
    "proceeding_id" TEXT,
    "hearing_id" TEXT,
    "title" TEXT NOT NULL,
    "title_normalized" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_date" DATE,
    "description" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "original_location" TEXT,
    "original_present" "DocumentOriginalPresence" NOT NULL DEFAULT 'UNKNOWN',
    "sensitivity" "DocumentSensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "current_version_id" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_owner_xor_check" CHECK (("matter_id" IS NOT NULL) <> ("party_id" IS NOT NULL)),
    CONSTRAINT "document_matter_scope_check" CHECK (("proceeding_id" IS NULL AND "hearing_id" IS NULL) OR "matter_id" IS NOT NULL),
    CONSTRAINT "document_title_non_empty_check" CHECK (btrim("title") <> '' AND btrim("title_normalized") <> ''),
    CONSTRAINT "document_version_positive_check" CHECK ("version" >= 1)
);

-- 3. Create document_version table
CREATE TABLE "document_version" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "declared_mime" TEXT,
    "detected_mime" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "upload_status" "DocumentVersionUploadStatus" NOT NULL,
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_policy_code" TEXT,
    "scan_policy_version" TEXT,
    "scan_checked_at" TIMESTAMPTZ(3),
    "scan_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_version_number_positive_check" CHECK ("version_number" >= 1),
    CONSTRAINT "document_version_size_bytes_range_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 26214400),
    CONSTRAINT "document_version_ready_scan_policy_check" CHECK ("upload_status" <> 'READY' OR "scan_status" IN ('NOT_SCANNED_POLICY', 'CLEAN'))
);

-- 4. Create upload_attempt table
CREATE TABLE "upload_attempt" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "target_document_version_id" TEXT,
    "idempotency_record_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "matter_id" TEXT,
    "party_id" TEXT,
    "proceeding_id" TEXT,
    "hearing_id" TEXT,
    "title" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "document_date" DATE,
    "description" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "original_location" TEXT,
    "original_present" "DocumentOriginalPresence" NOT NULL DEFAULT 'UNKNOWN',
    "sensitivity" "DocumentSensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "original_filename" TEXT NOT NULL,
    "declared_mime" TEXT NOT NULL,
    "expected_size_bytes" INTEGER NOT NULL,
    "quarantine_key" TEXT NOT NULL,
    "bytes_written" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "status" "UploadAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "failure_reason" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_attempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "upload_attempt_owner_xor_check" CHECK (("matter_id" IS NOT NULL) <> ("party_id" IS NOT NULL)),
    CONSTRAINT "upload_attempt_matter_scope_check" CHECK (("proceeding_id" IS NULL AND "hearing_id" IS NULL) OR "matter_id" IS NOT NULL),
    CONSTRAINT "upload_attempt_expected_size_range_check" CHECK ("expected_size_bytes" > 0 AND "expected_size_bytes" <= 26214400),
    CONSTRAINT "upload_attempt_bytes_written_range_check" CHECK ("bytes_written" >= 0 AND "bytes_written" <= 26214400),
    CONSTRAINT "upload_attempt_title_non_empty_check" CHECK (btrim("title") <> '')
);

-- 5. Create backup_file_pin table
CREATE TABLE "backup_file_pin" (
    "id" TEXT NOT NULL,
    "backup_id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "pinned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "backup_file_pin_pkey" PRIMARY KEY ("id")
);

-- 6. Unique constraints and indexes
CREATE UNIQUE INDEX "document_current_version_id_key" ON "document"("current_version_id");
CREATE INDEX "document_matter_id_created_at_idx" ON "document"("matter_id", "created_at");
CREATE INDEX "document_party_id_created_at_idx" ON "document"("party_id", "created_at");
CREATE INDEX "document_proceeding_id_idx" ON "document"("proceeding_id");
CREATE INDEX "document_hearing_id_idx" ON "document"("hearing_id");
CREATE INDEX "document_archived_at_idx" ON "document"("archived_at");
CREATE INDEX "document_title_normalized_idx" ON "document"("title_normalized");

CREATE UNIQUE INDEX "document_version_object_key_key" ON "document_version"("object_key");
CREATE UNIQUE INDEX "document_version_document_id_version_number_key" ON "document_version"("document_id", "version_number");
CREATE INDEX "document_version_sha256_idx" ON "document_version"("sha256");
CREATE INDEX "document_version_upload_status_created_at_idx" ON "document_version"("upload_status", "created_at");

CREATE UNIQUE INDEX "upload_attempt_target_document_version_id_key" ON "upload_attempt"("target_document_version_id");
CREATE UNIQUE INDEX "upload_attempt_idempotency_record_id_key" ON "upload_attempt"("idempotency_record_id");
CREATE UNIQUE INDEX "upload_attempt_quarantine_key_key" ON "upload_attempt"("quarantine_key");
CREATE INDEX "upload_attempt_status_expires_at_idx" ON "upload_attempt"("status", "expires_at");
CREATE INDEX "upload_attempt_actor_id_created_at_idx" ON "upload_attempt"("actor_id", "created_at");

CREATE UNIQUE INDEX "backup_file_pin_backup_id_document_version_id_key" ON "backup_file_pin"("backup_id", "document_version_id");
CREATE INDEX "backup_file_pin_document_version_id_idx" ON "backup_file_pin"("document_version_id");

-- 7. Foreign keys
ALTER TABLE "document"
    ADD CONSTRAINT "document_matter_id_fkey"
    FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document"
    ADD CONSTRAINT "document_party_id_fkey"
    FOREIGN KEY ("party_id") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document"
    ADD CONSTRAINT "document_proceeding_id_fkey"
    FOREIGN KEY ("proceeding_id") REFERENCES "proceeding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document"
    ADD CONSTRAINT "document_hearing_id_fkey"
    FOREIGN KEY ("hearing_id") REFERENCES "hearing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document"
    ADD CONSTRAINT "document_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "document_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_version"
    ADD CONSTRAINT "document_version_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "upload_attempt"
    ADD CONSTRAINT "upload_attempt_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "upload_attempt"
    ADD CONSTRAINT "upload_attempt_target_document_version_id_fkey"
    FOREIGN KEY ("target_document_version_id") REFERENCES "document_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "backup_file_pin"
    ADD CONSTRAINT "backup_file_pin_document_version_id_fkey"
    FOREIGN KEY ("document_version_id") REFERENCES "document_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
