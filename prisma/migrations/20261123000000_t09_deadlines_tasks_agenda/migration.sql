BEGIN;

-- 1. Extend TaskStatus enum (OPEN, IN_PROGRESS, DONE, CANCELLED)
DROP INDEX IF EXISTS "task_matter_id_status_idx";

CREATE TYPE "TaskStatus_new" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

ALTER TABLE "task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "task" ALTER COLUMN "status" TYPE "TaskStatus_new" USING ("status"::text::"TaskStatus_new");
ALTER TABLE "task" ALTER COLUMN "status" SET DEFAULT 'OPEN'::"TaskStatus_new";

DROP TYPE "TaskStatus";
ALTER TYPE "TaskStatus_new" RENAME TO "TaskStatus";

-- 2. Create DeadlineStatus enum
CREATE TYPE "DeadlineStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- 3. Create deadline table
CREATE TABLE "deadline" (
    "id" TEXT NOT NULL,
    "matter_id" TEXT NOT NULL,
    "proceeding_id" TEXT,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "due_time" TEXT,
    "source" TEXT,
    "basis_notes" TEXT,
    "source_document_id" TEXT,
    "status" "DeadlineStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" TEXT,
    "confirmed_by_name" TEXT,
    "date_change_reason" TEXT,
    "completion_description" TEXT,
    "completed_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" TEXT,
    "cancellation_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "deadline_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deadline_due_time_requires_due_date_check" CHECK ("due_time" IS NULL OR "due_date" IS NOT NULL),
    CONSTRAINT "deadline_confirmed_fields_check" CHECK (
        "status" <> 'CONFIRMED' OR (
            "due_date" IS NOT NULL
            AND "source" IS NOT NULL
            AND btrim("source") <> ''
            AND "basis_notes" IS NOT NULL
            AND btrim("basis_notes") <> ''
            AND "confirmed_at" IS NOT NULL
            AND "confirmed_by_id" IS NOT NULL
        )
    ),
    CONSTRAINT "deadline_completed_fields_check" CHECK (
        "status" <> 'COMPLETED' OR (
            "completion_description" IS NOT NULL
            AND btrim("completion_description") <> ''
            AND "completed_date" IS NOT NULL
            AND "completed_at" IS NOT NULL
        )
    )
);

-- 4. Alter task table (nullable matter_id, standalone/deadline fields, time guard)
ALTER TABLE "task"
    ALTER COLUMN "matter_id" DROP NOT NULL,
    ADD COLUMN "deadline_id" TEXT,
    ADD COLUMN "details" TEXT,
    ADD COLUMN "due_time" TEXT,
    ADD COLUMN "completed_at" TIMESTAMPTZ(3),
    ADD COLUMN "completed_by_id" TEXT;

ALTER TABLE "task"
    ADD CONSTRAINT "task_due_time_requires_due_date_check"
    CHECK ("due_time" IS NULL OR "due_date" IS NOT NULL);

-- 5. Indexes and foreign keys
CREATE INDEX "task_matter_id_status_idx" ON "task"("matter_id", "status");
CREATE INDEX "task_status_due_date_idx" ON "task"("status", "due_date");
CREATE INDEX "task_deadline_id_idx" ON "task"("deadline_id");

CREATE INDEX "deadline_status_due_date_idx" ON "deadline"("status", "due_date");
CREATE INDEX "deadline_matter_id_status_idx" ON "deadline"("matter_id", "status");
CREATE INDEX "deadline_proceeding_id_status_idx" ON "deadline"("proceeding_id", "status");

ALTER TABLE "deadline" ADD CONSTRAINT "deadline_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_proceeding_id_fkey" FOREIGN KEY ("proceeding_id") REFERENCES "proceeding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "deadline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;