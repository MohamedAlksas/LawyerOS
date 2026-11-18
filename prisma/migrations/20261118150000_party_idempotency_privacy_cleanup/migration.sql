-- Additive cleanup for historical idempotency records containing duplicate warnings or personal data (R4-02)
-- Cleanses databases already at the preceding checkpoint without mutating published migration history.

UPDATE "idempotency_record"
SET "resultPayload" = jsonb_build_object(
  'command', 'saveParty',
  'partyId', COALESCE("resultPayload"->'party'->>'id', "resultPayload"->>'partyId', "resultId"),
  'operationVersion', COALESCE(("resultPayload"->'party'->>'version')::int, ("resultPayload"->>'operationVersion')::int, ("resultPayload"->>'version')::int, 1)
)
WHERE "commandType" = 'saveParty'
  AND "resultPayload" IS NOT NULL
  AND ("resultPayload" ? 'party' OR "resultPayload" ? 'address' OR "resultPayload" ? 'notes' OR "resultPayload" ? 'duplicateWarnings');
