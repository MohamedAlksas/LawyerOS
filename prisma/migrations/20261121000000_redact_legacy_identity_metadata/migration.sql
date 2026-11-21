-- Preserve the encrypted identifier. Clear a display suffix when the legacy
-- metadata cannot prove that the suffix omits part of the original value.
UPDATE "party_identity"
SET "lastFour" = ''
WHERE "lastFour" <> ''
  AND CASE
    WHEN "ciphertext" ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
      THEN octet_length(decode("ciphertext", 'base64')) <= octet_length("lastFour")
    ELSE true
  END;

-- Preserve event IDs, actors, times and document types. Remove legacy copies
-- of identity suffixes and replace reveal reasons with a fixed purpose.
UPDATE "audit_event"
SET "changedFields" = "changedFields" #- ARRAY['identity', 'lastFour']
WHERE "action" IN ('CREATE_PARTY', 'UPDATE_PARTY')
  AND jsonb_typeof("changedFields" -> 'identity') = 'object'
  AND ("changedFields" -> 'identity') ? 'lastFour';

UPDATE "audit_event"
SET "changedFields" = "changedFields" - 'lastFour',
    "reason" = 'Authoritative identity view'
WHERE "action" = 'REVEAL_IDENTITY'
  AND "entityType" = 'PartyIdentity'
  AND (("changedFields" ? 'lastFour') OR "reason" IS DISTINCT FROM 'Authoritative identity view');
