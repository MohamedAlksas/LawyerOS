-- CreateEnum
CREATE TYPE "HearingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "NextDateDisposition" AS ENUM ('KNOWN', 'NONE', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "HearingLinkRelation" AS ENUM ('ADJOURNED_TO', 'RESCHEDULED_TO');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('REMINDER_DELIVERY');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('PENDING', 'CANCELLED');

-- CreateTable
CREATE TABLE "hearing" (
    "id" TEXT NOT NULL,
    "proceeding_id" TEXT NOT NULL,
    "hearing_date" DATE NOT NULL,
    "hearing_time" TEXT,
    "court_hall" TEXT,
    "purpose" TEXT,
    "roll_number" TEXT,
    "status" "HearingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reschedule_reason" TEXT,
    "cancellation_reason" TEXT,
    "supersedes_hearing_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "hearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearing_result" (
    "id" TEXT NOT NULL,
    "hearing_id" TEXT NOT NULL,
    "decision_text" TEXT NOT NULL,
    "summary" TEXT,
    "attendance" TEXT,
    "notes" TEXT,
    "correction_reason" TEXT,
    "next_date_disposition" "NextDateDisposition" NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedes_result_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "hearing_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearing_link" (
    "id" TEXT NOT NULL,
    "from_hearing_id" TEXT NOT NULL,
    "to_hearing_id" TEXT NOT NULL,
    "relation" "HearingLinkRelation" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "hearing_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "matter_id" TEXT NOT NULL,
    "proceeding_id" TEXT,
    "hearing_id" TEXT,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "job_type" "JobType" NOT NULL DEFAULT 'REMINDER_DELIVERY',
    "source_type" TEXT NOT NULL DEFAULT 'Hearing',
    "source_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'PENDING',
    "deduplication_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hearing_proceeding_id_hearing_date_idx" ON "hearing"("proceeding_id", "hearing_date");

-- CreateIndex
CREATE INDEX "hearing_status_hearing_date_idx" ON "hearing"("status", "hearing_date");

-- CreateIndex
CREATE INDEX "hearing_hearing_date_idx" ON "hearing"("hearing_date");

-- CreateIndex
CREATE INDEX "hearing_result_hearing_id_idx" ON "hearing_result"("hearing_id");

-- CreateIndex
CREATE INDEX "hearing_result_hearing_id_revision_idx" ON "hearing_result"("hearing_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "hearing_link_from_hearing_id_to_hearing_id_relation_key" ON "hearing_link"("from_hearing_id", "to_hearing_id", "relation");

-- CreateIndex
CREATE INDEX "hearing_link_from_hearing_id_idx" ON "hearing_link"("from_hearing_id");

-- CreateIndex
CREATE INDEX "hearing_link_to_hearing_id_idx" ON "hearing_link"("to_hearing_id");

-- CreateIndex
CREATE INDEX "task_matter_id_status_idx" ON "task"("matter_id", "status");

-- CreateIndex
CREATE INDEX "task_proceeding_id_idx" ON "task"("proceeding_id");

-- CreateIndex
CREATE INDEX "task_hearing_id_idx" ON "task"("hearing_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_run_deduplication_key_key" ON "job_run"("deduplication_key");

-- CreateIndex
CREATE INDEX "job_run_source_type_source_id_status_idx" ON "job_run"("source_type", "source_id", "status");

-- CreateIndex
CREATE INDEX "job_run_status_scheduled_at_idx" ON "job_run"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "hearing" ADD CONSTRAINT "hearing_proceeding_id_fkey" FOREIGN KEY ("proceeding_id") REFERENCES "proceeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing" ADD CONSTRAINT "hearing_supersedes_hearing_id_fkey" FOREIGN KEY ("supersedes_hearing_id") REFERENCES "hearing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_result" ADD CONSTRAINT "hearing_result_hearing_id_fkey" FOREIGN KEY ("hearing_id") REFERENCES "hearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_result" ADD CONSTRAINT "hearing_result_supersedes_result_id_fkey" FOREIGN KEY ("supersedes_result_id") REFERENCES "hearing_result"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_link" ADD CONSTRAINT "hearing_link_from_hearing_id_fkey" FOREIGN KEY ("from_hearing_id") REFERENCES "hearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_link" ADD CONSTRAINT "hearing_link_to_hearing_id_fkey" FOREIGN KEY ("to_hearing_id") REFERENCES "hearing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_proceeding_id_fkey" FOREIGN KEY ("proceeding_id") REFERENCES "proceeding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_hearing_id_fkey" FOREIGN KEY ("hearing_id") REFERENCES "hearing"("id") ON DELETE SET NULL ON UPDATE CASCADE;