CREATE OR REPLACE FUNCTION public.trg_fee_agreement_approved_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF OLD."status" = 'APPROVED' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Approved fee_agreement records cannot be deleted (id=%)', OLD."id";
        END IF;
        IF NEW."matter_id" IS DISTINCT FROM OLD."matter_id"
           OR NEW."client_matter_party_id" IS DISTINCT FROM OLD."client_matter_party_id"
           OR NEW."total_amount_piastres" IS DISTINCT FROM OLD."total_amount_piastres"
           OR NEW."currency" IS DISTINCT FROM OLD."currency"
           OR NEW."agreement_date" IS DISTINCT FROM OLD."agreement_date"
           OR NEW."charging_method" IS DISTINCT FROM OLD."charging_method"
           OR NEW."approved_transaction_id" IS DISTINCT FROM OLD."approved_transaction_id"
           OR NEW."status" IS DISTINCT FROM OLD."status"
           OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
           OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id" THEN
            RAISE EXCEPTION 'Financial terms and approval status of approved fee_agreement cannot be modified (id=%)', OLD."id";
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;