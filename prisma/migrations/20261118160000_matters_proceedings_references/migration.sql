-- CreateEnum
CREATE TYPE "MatterKind" AS ENUM ('LITIGATION', 'CONSULTATION', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "MatterStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MatterPartyRole" AS ENUM ('CLIENT', 'OPPONENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProceedingInstance" AS ENUM ('FIRST_INSTANCE', 'APPEAL', 'CASSATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ProceedingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'JUDGMENT_ISSUED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProceedingLegalCapacity" AS ENUM ('PLAINTIFF', 'DEFENDANT', 'APPELLANT', 'APPELLEE', 'INTERVENOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferenceItemType" AS ENUM ('COURT', 'PRACTICE_AREA', 'STORAGE_LOCATION');

-- CreateTable
CREATE TABLE "practice_area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "practice_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "storage_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "court" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "circuitTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "officeName" TEXT NOT NULL,
    "lawyerName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "office_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_code_sequence" (
    "year" INTEGER NOT NULL,
    "nextVal" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "file_code_sequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "matter" (
    "id" TEXT NOT NULL,
    "fileCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "MatterKind" NOT NULL,
    "status" "MatterStatus" NOT NULL DEFAULT 'DRAFT',
    "practiceAreaId" TEXT,
    "openingDate" DATE,
    "closingDate" DATE,
    "summary" TEXT,
    "notes" TEXT,
    "paperLocationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "matter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_party" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "role" "MatterPartyRole" NOT NULL,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "billingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "matter_party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proceeding" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "instance" "ProceedingInstance" NOT NULL,
    "parentProceedingId" TEXT,
    "registerType" TEXT,
    "circuit" TEXT,
    "numberText" TEXT,
    "yearLabel" TEXT,
    "filingDate" DATE,
    "claimAmount" TEXT,
    "status" "ProceedingStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "proceeding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proceeding_party" (
    "id" TEXT NOT NULL,
    "proceedingId" TEXT NOT NULL,
    "matterPartyId" TEXT NOT NULL,
    "legalCapacity" "ProceedingLegalCapacity" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "proceeding_party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matter_authorization" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "powerOfAttorneyId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "matter_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "matter_fileCode_key" ON "matter"("fileCode");

-- CreateIndex
CREATE INDEX "matter_status_idx" ON "matter"("status");

-- CreateIndex
CREATE INDEX "matter_kind_idx" ON "matter"("kind");

-- CreateIndex
CREATE INDEX "matter_practiceAreaId_idx" ON "matter"("practiceAreaId");

-- CreateIndex
CREATE INDEX "matter_paperLocationId_idx" ON "matter"("paperLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "matter_party_matterId_partyId_role_key" ON "matter_party"("matterId", "partyId", "role");

-- CreateIndex
CREATE INDEX "matter_party_partyId_idx" ON "matter_party"("partyId");

-- CreateIndex
CREATE INDEX "matter_party_matterId_idx" ON "matter_party"("matterId");

-- CreateIndex (Partial unique index for primary contact invariant)
CREATE UNIQUE INDEX "idx_matter_party_primary" ON "matter_party"("matterId") WHERE "isPrimaryContact" = true;

-- CreateIndex
CREATE INDEX "proceeding_matterId_idx" ON "proceeding"("matterId");

-- CreateIndex
CREATE INDEX "proceeding_courtId_idx" ON "proceeding"("courtId");

-- CreateIndex
CREATE INDEX "proceeding_parentProceedingId_idx" ON "proceeding"("parentProceedingId");

-- CreateIndex
CREATE INDEX "proceeding_numberText_yearLabel_idx" ON "proceeding"("numberText", "yearLabel");

-- CreateIndex
CREATE UNIQUE INDEX "proceeding_party_proceedingId_matterPartyId_key" ON "proceeding_party"("proceedingId", "matterPartyId");

-- CreateIndex
CREATE INDEX "proceeding_party_matterPartyId_idx" ON "proceeding_party"("matterPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "matter_authorization_matterId_powerOfAttorneyId_key" ON "matter_authorization"("matterId", "powerOfAttorneyId");

-- CreateIndex
CREATE INDEX "matter_authorization_powerOfAttorneyId_idx" ON "matter_authorization"("powerOfAttorneyId");

-- CreateIndex
CREATE INDEX "court_isActive_name_idx" ON "court"("isActive", "name");

-- CreateIndex
CREATE INDEX "practice_area_isActive_name_idx" ON "practice_area"("isActive", "name");

-- CreateIndex
CREATE INDEX "storage_location_isActive_name_idx" ON "storage_location"("isActive", "name");

-- AddForeignKey
ALTER TABLE "matter" ADD CONSTRAINT "matter_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter" ADD CONSTRAINT "matter_paperLocationId_fkey" FOREIGN KEY ("paperLocationId") REFERENCES "storage_location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_party" ADD CONSTRAINT "matter_party_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_party" ADD CONSTRAINT "matter_party_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceeding" ADD CONSTRAINT "proceeding_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceeding" ADD CONSTRAINT "proceeding_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceeding" ADD CONSTRAINT "proceeding_parentProceedingId_fkey" FOREIGN KEY ("parentProceedingId") REFERENCES "proceeding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceeding_party" ADD CONSTRAINT "proceeding_party_proceedingId_fkey" FOREIGN KEY ("proceedingId") REFERENCES "proceeding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceeding_party" ADD CONSTRAINT "proceeding_party_matterPartyId_fkey" FOREIGN KEY ("matterPartyId") REFERENCES "matter_party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_authorization" ADD CONSTRAINT "matter_authorization_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_authorization" ADD CONSTRAINT "matter_authorization_powerOfAttorneyId_fkey" FOREIGN KEY ("powerOfAttorneyId") REFERENCES "power_of_attorney"("id") ON DELETE CASCADE ON UPDATE CASCADE;
