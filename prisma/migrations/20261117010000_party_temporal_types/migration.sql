-- Ensure UTC semantics for session during migration
SET TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "communication_note" ALTER COLUMN "communicationAt" TYPE TIMESTAMPTZ(3) USING "communicationAt" AT TIME ZONE 'UTC';
ALTER TABLE "communication_note" ALTER COLUMN "followUpDate" TYPE DATE;

-- AlterTable
ALTER TABLE "power_of_attorney" ALTER COLUMN "issueDate" TYPE DATE;
ALTER TABLE "power_of_attorney" ALTER COLUMN "humanReviewedAt" TYPE TIMESTAMPTZ(3) USING "humanReviewedAt" AT TIME ZONE 'UTC';
