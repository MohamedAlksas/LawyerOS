BEGIN;

-- Compact receipts written by the original T08 code. The source records and
-- their identifiers remain available for authorized replay.
CREATE FUNCTION pg_temp.hearing_receipt(snapshot jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT jsonb_build_object(
    'id', snapshot -> 'id',
    'version', snapshot -> 'version',
    'status', snapshot -> 'status',
    'updatedAt', snapshot -> 'updatedAt',
    'duplicateDateWarning', COALESCE(snapshot -> 'duplicateDateWarning', 'false'::jsonb)
  )
$$;

UPDATE "idempotency_record"
SET "resultPayload" = CASE "commandType"
  WHEN 'recordHearingResult' THEN jsonb_build_object(
    'resultId', "resultId",
    'hearing', pg_temp.hearing_receipt("resultPayload" -> 'hearing'),
    'next', CASE WHEN jsonb_typeof("resultPayload" -> 'nextHearing') = 'object'
      THEN pg_temp.hearing_receipt("resultPayload" -> 'nextHearing') ELSE NULL END,
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', task -> 'id', 'hearingId', task -> 'hearingId', 'dueDate', task -> 'dueDate',
        'status', task -> 'status', 'version', task -> 'version', 'updatedAt', task -> 'updatedAt'
      ) ORDER BY position)
      FROM jsonb_array_elements("resultPayload" -> 'tasks') WITH ORDINALITY AS items(task, position)
    ), '[]'::jsonb)
  )
  WHEN 'rescheduleHearing' THEN jsonb_build_object(
    'original', pg_temp.hearing_receipt("resultPayload" -> 'originalHearing'),
    'replacement', pg_temp.hearing_receipt("resultPayload" -> 'replacementHearing')
  )
  WHEN 'correctHearingResult' THEN NULL
  ELSE pg_temp.hearing_receipt("resultPayload")
END
WHERE "resultType" IN ('Hearing', 'HearingResult')
  AND "commandType" IN ('scheduleHearing', 'recordHearingResult', 'correctHearingResult', 'rescheduleHearing', 'cancelHearing')
  AND jsonb_typeof("resultPayload") = 'object';

COMMIT;
