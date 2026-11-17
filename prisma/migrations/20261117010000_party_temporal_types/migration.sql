-- AlterTable
ALTER TABLE "communication_note" ALTER COLUMN "communicationAt" TYPE TIMESTAMPTZ(3);
ALTER TABLE "communication_note" ALTER COLUMN "followUpDate" TYPE DATE;

-- AlterTable
ALTER TABLE "power_of_attorney" ALTER COLUMN "issueDate" TYPE DATE;
ALTER TABLE "power_of_attorney" ALTER COLUMN "humanReviewedAt" TYPE TIMESTAMPTZ(3);

