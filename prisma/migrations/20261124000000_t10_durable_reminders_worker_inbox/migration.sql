BEGIN;

-- 1. Extend JobRunStatus enum safely inside transaction
DROP INDEX IF EXISTS "job_run_status_scheduled_at_idx";
DROP INDEX IF EXISTS "job_run_source_type_source_id_status_idx";

CREATE TYPE "JobRunStatus_new" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "job_run" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "job_run" ALTER COLUMN "status" TYPE "JobRunStatus_new" USING ("status"::text::"JobRunStatus_new");
ALTER TABLE "job_run" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"JobRunStatus_new";

DROP TYPE "JobRunStatus";
ALTER TYPE "JobRunStatus_new" RENAME TO "JobRunStatus";

-- 2. Extend job_run for durable leases, retries, backoff, and source versioning
ALTER TABLE "job_run"
    ADD COLUMN "source_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "payload_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "available_at" TIMESTAMPTZ(3),
    ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3),
    ADD COLUMN "lease_until" TIMESTAMPTZ(3),
    ADD COLUMN "locked_by" TEXT,
    ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN "completed_at" TIMESTAMPTZ(3),
    ADD COLUMN "last_error" TEXT;

-- Backfill available_at from scheduled_at for pre-existing T08/T09 rows
UPDATE "job_run" SET "available_at" = "scheduled_at" WHERE "available_at" IS NULL;

ALTER TABLE "job_run"
    ALTER COLUMN "available_at" SET NOT NULL,
    ALTER COLUMN "available_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "job_run"
    ADD CONSTRAINT "job_run_attempt_count_non_negative_check" CHECK ("attempt_count" >= 0),
    ADD CONSTRAINT "job_run_max_attempts_positive_check" CHECK ("max_attempts" >= 1),
    ADD CONSTRAINT "job_run_source_version_positive_check" CHECK ("source_version" >= 1),
    ADD CONSTRAINT "job_run_payload_version_positive_check" CHECK ("payload_version" >= 1);

CREATE INDEX "job_run_source_type_source_id_status_idx" ON "job_run"("source_type", "source_id", "status");
CREATE INDEX "job_run_status_scheduled_at_idx" ON "job_run"("status", "scheduled_at");
CREATE INDEX "job_run_status_available_at_lease_until_idx" ON "job_run"("status", "available_at", "lease_until");

-- 3. Reminder enums
CREATE TYPE "ReminderEventType" AS ENUM ('HEARING', 'DEADLINE', 'TASK');
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP');
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- 4. ReminderRule configuration table
CREATE TABLE "reminder_rule" (
    "id" TEXT NOT NULL,
    "event_type" "ReminderEventType" NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "reminder_time" TEXT NOT NULL DEFAULT '09:00',
    "channel" "ReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reminder_rule_day_offset_range_check" CHECK ("day_offset" >= 0 AND "day_offset" <= 365),
    CONSTRAINT "reminder_rule_time_format_check" CHECK ("reminder_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE UNIQUE INDEX "reminder_rule_event_type_day_offset_channel_key" ON "reminder_rule"("event_type", "day_offset", "channel");
CREATE INDEX "reminder_rule_event_type_enabled_idx" ON "reminder_rule"("event_type", "enabled");

-- Seed default reminder policies (7, 3, 1 days at 09:00 Africa/Cairo for hearings & deadlines; 1 day for tasks)
INSERT INTO "reminder_rule" ("id", "event_type", "day_offset", "reminder_time", "channel", "enabled", "version", "updated_at")
VALUES
    ('00000000-0000-4000-8000-000000000101', 'HEARING', 7, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000102', 'HEARING', 3, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000103', 'HEARING', 1, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000201', 'DEADLINE', 7, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000202', 'DEADLINE', 3, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000203', 'DEADLINE', 1, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000301', 'TASK', 1, '09:00', 'IN_APP', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("event_type", "day_offset", "channel") DO NOTHING;

-- 5. ReminderDelivery in-app inbox table
CREATE TABLE "reminder_delivery" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "rule_id" TEXT,
    "rule_key" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "recipient_user_id" TEXT NOT NULL,
    "status" "ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "matter_id" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "job_run_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_delivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reminder_delivery_source_rule_channel_recipient_key"
    ON "reminder_delivery"("source_type", "source_id", "source_version", "rule_key", "channel", "recipient_user_id");
CREATE INDEX "reminder_delivery_recipient_user_id_status_scheduled_at_idx"
    ON "reminder_delivery"("recipient_user_id", "status", "scheduled_at");
CREATE INDEX "reminder_delivery_status_scheduled_at_idx"
    ON "reminder_delivery"("status", "scheduled_at");
CREATE INDEX "reminder_delivery_matter_id_idx"
    ON "reminder_delivery"("matter_id");

ALTER TABLE "reminder_delivery"
    ADD CONSTRAINT "reminder_delivery_rule_id_fkey"
    FOREIGN KEY ("rule_id") REFERENCES "reminder_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reminder_delivery"
    ADD CONSTRAINT "reminder_delivery_job_run_id_fkey"
    FOREIGN KEY ("job_run_id") REFERENCES "job_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reminder_delivery"
    ADD CONSTRAINT "reminder_delivery_matter_id_fkey"
    FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. WorkerHeartbeat operational status table
CREATE TABLE "worker_heartbeat" (
    "id" TEXT NOT NULL DEFAULT 'reminder-worker',
    "worker_id" TEXT NOT NULL,
    "last_poll_at" TIMESTAMPTZ(3) NOT NULL,
    "last_success_at" TIMESTAMPTZ(3),
    "last_error_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "restore_mode" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_heartbeat_pkey" PRIMARY KEY ("id")
);

COMMIT;