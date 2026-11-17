-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "IdentificationType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'COMMERCIAL_REG', 'TAX_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('PHONE', 'IN_PERSON', 'WHATSAPP', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "PoAType" AS ENUM ('GENERAL', 'SPECIAL', 'LITIGATION', 'COMMERCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PoAReviewStatus" AS ENUM ('UNREVIEWED', 'VALID', 'EXPIRED', 'REVOKED', 'DEFECTIVE');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "party" (
    "id" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "primaryPhone" TEXT,
    "primaryPhoneNormalized" TEXT,
    "additionalPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_identity" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "identificationType" "IdentificationType" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastFour" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "party_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_note" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "matterId" TEXT,
    "communicationAt" TIMESTAMP(3) NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "summary" TEXT NOT NULL,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "communication_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "power_of_attorney" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "poaNumberText" TEXT NOT NULL,
    "poaYearLabel" TEXT NOT NULL,
    "notarizationOffice" TEXT NOT NULL,
    "poaType" "PoAType" NOT NULL,
    "issueDate" TIMESTAMP(3),
    "humanReviewStatus" "PoAReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "humanReviewedAt" TIMESTAMP(3),
    "humanReviewedById" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "power_of_attorney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changedFields" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "resultType" TEXT,
    "resultId" TEXT,
    "resultPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "party_nameNormalized_idx" ON "party"("nameNormalized");

-- CreateIndex
CREATE INDEX "party_primaryPhoneNormalized_idx" ON "party"("primaryPhoneNormalized");

-- CreateIndex
CREATE INDEX "party_archivedAt_idx" ON "party"("archivedAt");

-- CreateIndex
CREATE INDEX "party_identity_partyId_idx" ON "party_identity"("partyId");

-- CreateIndex
CREATE INDEX "communication_note_partyId_communicationAt_idx" ON "communication_note"("partyId", "communicationAt");

-- CreateIndex
CREATE INDEX "power_of_attorney_partyId_idx" ON "power_of_attorney"("partyId");

-- CreateIndex
CREATE INDEX "power_of_attorney_poaNumberText_poaYearLabel_idx" ON "power_of_attorney"("poaNumberText", "poaYearLabel");

-- CreateIndex
CREATE INDEX "audit_event_entityType_entityId_createdAt_idx" ON "audit_event"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_event_userId_createdAt_idx" ON "audit_event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_record_createdAt_idx" ON "idempotency_record"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_actorId_commandType_key_key" ON "idempotency_record"("actorId", "commandType", "key");

-- AddForeignKey
ALTER TABLE "party_identity" ADD CONSTRAINT "party_identity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_note" ADD CONSTRAINT "communication_note_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "power_of_attorney" ADD CONSTRAINT "power_of_attorney_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

