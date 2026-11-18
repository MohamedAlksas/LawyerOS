-- Explicit UTC conversion for all T05 party temporal columns (R2-06)
-- Enforces AT TIME ZONE 'UTC' so conversion is invariant to ambient connection TimeZone.

ALTER TABLE "party" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "party" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "party" ALTER COLUMN "archivedAt" TYPE TIMESTAMPTZ(3) USING "archivedAt" AT TIME ZONE 'UTC';

ALTER TABLE "party_identity" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "communication_note" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "communication_note" ALTER COLUMN "communicationAt" TYPE TIMESTAMPTZ(3) USING ("communicationAt" AT TIME ZONE (current_setting('TIMEZONE'))) AT TIME ZONE 'UTC';

ALTER TABLE "power_of_attorney" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "power_of_attorney" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "power_of_attorney" ALTER COLUMN "humanReviewedAt" TYPE TIMESTAMPTZ(3) USING ("humanReviewedAt" AT TIME ZONE (current_setting('TIMEZONE'))) AT TIME ZONE 'UTC';

ALTER TABLE "audit_event" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "idempotency_record" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "idempotency_record" ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(3) USING "completedAt" AT TIME ZONE 'UTC';

-- Residual STD-01 upgrade limit: sanitize historical idempotency_record.resultPayload snapshots.
-- Strips confidential address, notes, summary, and nested entity DTOs, preserving minimal operational identifiers.

UPDATE "idempotency_record"
SET "resultPayload" = jsonb_build_object(
  'command', 'saveParty',
  'partyId', COALESCE("resultPayload"->'party'->>'id', "resultPayload"->>'partyId', "resultId"),
  'operationVersion', COALESCE(("resultPayload"->'party'->>'version')::int, ("resultPayload"->>'operationVersion')::int, ("resultPayload"->>'version')::int, 1)
)
WHERE "commandType" = 'saveParty'
  AND "resultPayload" IS NOT NULL
  AND ("resultPayload" ? 'party' OR "resultPayload" ? 'address' OR "resultPayload" ? 'notes' OR "resultPayload" ? 'duplicateWarnings');

UPDATE "idempotency_record"
SET "resultPayload" = jsonb_build_object(
  'command', 'addCommunicationNote',
  'noteId', COALESCE("resultPayload"->'note'->>'id', "resultPayload"->>'noteId', "resultId"),
  'partyId', COALESCE("resultPayload"->'note'->>'partyId', "resultPayload"->>'partyId')
)
WHERE "commandType" = 'addCommunicationNote'
  AND "resultPayload" IS NOT NULL
  AND ("resultPayload" ? 'note' OR "resultPayload" ? 'summary' OR "resultPayload" ? 'notes');

UPDATE "idempotency_record"
SET "resultPayload" = jsonb_build_object(
  'command', 'savePowerOfAttorney',
  'poaId', COALESCE("resultPayload"->'poa'->>'id', "resultPayload"->>'poaId', "resultId"),
  'partyId', COALESCE("resultPayload"->'poa'->>'partyId', "resultPayload"->>'partyId'),
  'operationVersion', COALESCE(("resultPayload"->'poa'->>'version')::int, ("resultPayload"->>'operationVersion')::int, 1)
)
WHERE "commandType" = 'savePowerOfAttorney'
  AND "resultPayload" IS NOT NULL
  AND ("resultPayload" ? 'poa' OR "resultPayload" ? 'notes');