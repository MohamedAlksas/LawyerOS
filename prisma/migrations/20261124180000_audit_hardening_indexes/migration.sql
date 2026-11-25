BEGIN;

CREATE INDEX IF NOT EXISTS "job_run_job_type_status_updated_at_idx"
    ON "job_run"("job_type", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "reminder_delivery_recipient_user_id_status_delivered_at_idx"
    ON "reminder_delivery"("recipient_user_id", "status", "delivered_at");

COMMIT;
