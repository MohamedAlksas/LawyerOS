BEGIN;

-- 1. money_account row immutability + BEFORE TRUNCATE protection across all 8 financial tables
CREATE TRIGGER trg_money_account_immutable
    BEFORE UPDATE OR DELETE ON public."money_account"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_finance_row_immutable();

CREATE OR REPLACE FUNCTION public.trg_finance_table_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'Financial table "%" cannot be truncated', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_money_account_no_truncate
    BEFORE TRUNCATE ON public."money_account"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_money_transaction_no_truncate
    BEFORE TRUNCATE ON public."money_transaction"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_money_line_no_truncate
    BEFORE TRUNCATE ON public."money_line"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_money_allocation_no_truncate
    BEFORE TRUNCATE ON public."money_allocation"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_fee_agreement_no_truncate
    BEFORE TRUNCATE ON public."fee_agreement"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_fee_charge_no_truncate
    BEFORE TRUNCATE ON public."fee_charge"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_receipt_no_truncate
    BEFORE TRUNCATE ON public."receipt"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

CREATE TRIGGER trg_receipt_sequence_no_truncate
    BEFORE TRUNCATE ON public."receipt_sequence"
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.trg_finance_table_no_truncate();

-- 2. Same-dimension & same-matter DB integrity + AFTER INSERT OR UPDATE OR DELETE line balance
ALTER TABLE public."money_line"
    ADD CONSTRAINT "money_line_dimensions_paired_check"
    CHECK (("matter_id" IS NULL) = ("client_matter_party_id" IS NULL));

CREATE OR REPLACE FUNCTION public.trg_money_account_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NEW."matter_id" IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public."matter_party"
            WHERE "id" = NEW."client_matter_party_id"
              AND "matterId" = NEW."matter_id"
        ) THEN
            RAISE EXCEPTION 'money_account client_matter_party_id (%) does not belong to matter_id (%)',
                NEW."client_matter_party_id", NEW."matter_id";
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_money_account_integrity
    BEFORE INSERT ON public."money_account"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_account_integrity();

CREATE OR REPLACE FUNCTION public.trg_money_line_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_acct RECORD;
BEGIN
    SELECT "matter_id", "client_matter_party_id"
    INTO v_acct
    FROM public."money_account"
    WHERE "id" = NEW."account_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'money_line references unknown money_account (account_id=%)', NEW."account_id";
    END IF;

    IF NEW."matter_id" IS DISTINCT FROM v_acct."matter_id"
       OR NEW."client_matter_party_id" IS DISTINCT FROM v_acct."client_matter_party_id" THEN
        RAISE EXCEPTION 'money_line dimensions (matter_id=%, client_matter_party_id=%) must match money_account (account_id=%)',
            NEW."matter_id", NEW."client_matter_party_id", NEW."account_id";
    END IF;

    IF NEW."matter_id" IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public."matter_party"
            WHERE "id" = NEW."client_matter_party_id"
              AND "matterId" = NEW."matter_id"
        ) THEN
            RAISE EXCEPTION 'money_line client_matter_party_id (%) does not belong to matter_id (%)',
                NEW."client_matter_party_id", NEW."matter_id";
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_money_line_integrity
    BEFORE INSERT ON public."money_line"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_line_integrity();

CREATE OR REPLACE FUNCTION public.trg_fee_agreement_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public."matter_party"
        WHERE "id" = NEW."client_matter_party_id"
          AND "matterId" = NEW."matter_id"
    ) THEN
        RAISE EXCEPTION 'fee_agreement client_matter_party_id (%) does not belong to matter_id (%)',
            NEW."client_matter_party_id", NEW."matter_id";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fee_agreement_integrity
    BEFORE INSERT OR UPDATE ON public."fee_agreement"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fee_agreement_integrity();

CREATE OR REPLACE FUNCTION public.trg_fee_charge_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_line RECORD;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public."matter_party"
        WHERE "id" = NEW."client_matter_party_id"
          AND "matterId" = NEW."matter_id"
    ) THEN
        RAISE EXCEPTION 'fee_charge client_matter_party_id (%) does not belong to matter_id (%)',
            NEW."client_matter_party_id", NEW."matter_id";
    END IF;

    SELECT ml."side", ml."amount_piastres", ml."matter_id", ml."client_matter_party_id", ma."type"
    INTO v_line
    FROM public."money_line" ml
    JOIN public."money_account" ma ON ma."id" = ml."account_id"
    WHERE ml."id" = NEW."receivable_line_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fee_charge references unknown receivable_line_id (%)', NEW."receivable_line_id";
    END IF;

    IF v_line."side" <> 'DEBIT'
       OR v_line."type" <> 'FEE_RECEIVABLE'
       OR v_line."matter_id" IS DISTINCT FROM NEW."matter_id"
       OR v_line."client_matter_party_id" IS DISTINCT FROM NEW."client_matter_party_id"
       OR v_line."amount_piastres" <> NEW."amount_piastres" THEN
        RAISE EXCEPTION 'fee_charge receivable_line_id (%) must be a DEBIT line on a matching FEE_RECEIVABLE account with amount %',
            NEW."receivable_line_id", NEW."amount_piastres";
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fee_charge_integrity
    BEFORE INSERT ON public."fee_charge"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fee_charge_integrity();

DROP TRIGGER IF EXISTS trg_money_line_balanced ON public."money_line";

CREATE OR REPLACE FUNCTION public.trg_money_line_balanced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.trg_assert_posted_transaction_balanced(OLD."transaction_id");
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD."transaction_id" IS DISTINCT FROM NEW."transaction_id" THEN
            PERFORM public.trg_assert_posted_transaction_balanced(OLD."transaction_id");
        END IF;
        PERFORM public.trg_assert_posted_transaction_balanced(NEW."transaction_id");
    ELSE
        PERFORM public.trg_assert_posted_transaction_balanced(NEW."transaction_id");
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_money_line_balanced
    AFTER INSERT OR UPDATE OR DELETE ON public."money_line"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_line_balanced();

-- 3. fee_agreement 3-state CHECK + trigger hardening (APPROVED & CANCELLED)
ALTER TABLE public."fee_agreement"
    ADD CONSTRAINT "fee_agreement_status_fields_check" CHECK (
        ("status" = 'DRAFT' AND "approved_transaction_id" IS NULL AND "approved_at" IS NULL AND "approved_by_id" IS NULL AND "cancelled_at" IS NULL AND "cancelled_reason" IS NULL)
        OR ("status" = 'APPROVED' AND "approved_transaction_id" IS NOT NULL AND "approved_at" IS NOT NULL AND "approved_by_id" IS NOT NULL AND "cancelled_at" IS NULL AND "cancelled_reason" IS NULL)
        OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "approved_transaction_id" IS NULL AND "approved_at" IS NULL AND "approved_by_id" IS NULL)
    ),
    ADD CONSTRAINT "fee_agreement_version_check" CHECK ("version" >= 1),
    ADD CONSTRAINT "fee_agreement_description_not_blank_check" CHECK (btrim("description") <> '');

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
           OR NEW."description" IS DISTINCT FROM OLD."description"
           OR NEW."total_amount_piastres" IS DISTINCT FROM OLD."total_amount_piastres"
           OR NEW."currency" IS DISTINCT FROM OLD."currency"
           OR NEW."agreement_date" IS DISTINCT FROM OLD."agreement_date"
           OR NEW."charging_method" IS DISTINCT FROM OLD."charging_method"
           OR NEW."approved_transaction_id" IS DISTINCT FROM OLD."approved_transaction_id"
           OR NEW."status" IS DISTINCT FROM OLD."status"
           OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
           OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
           OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
           OR NEW."cancelled_reason" IS DISTINCT FROM OLD."cancelled_reason"
           OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
           OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" THEN
            RAISE EXCEPTION 'Approved fee_agreement fields cannot be modified (id=%)', OLD."id";
        END IF;
    ELSIF OLD."status" = 'CANCELLED' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cancelled fee_agreement records cannot be deleted (id=%)', OLD."id";
        END IF;
        IF NEW."status" IS DISTINCT FROM OLD."status"
           OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
           OR NEW."cancelled_reason" IS DISTINCT FROM OLD."cancelled_reason"
           OR NEW."approved_transaction_id" IS DISTINCT FROM OLD."approved_transaction_id"
           OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
           OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id"
           OR NEW."total_amount_piastres" IS DISTINCT FROM OLD."total_amount_piastres"
           OR NEW."matter_id" IS DISTINCT FROM OLD."matter_id"
           OR NEW."client_matter_party_id" IS DISTINCT FROM OLD."client_matter_party_id"
           OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
           OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" THEN
            RAISE EXCEPTION 'Cancelled fee_agreement fields cannot be modified (id=%)', OLD."id";
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- 4. Remaining CHECK constraints, FKs, receipt_sequence immutability, and indexes
ALTER TABLE public."money_transaction"
    ADD CONSTRAINT "money_transaction_no_self_reversal_check" CHECK ("reversal_of_id" IS DISTINCT FROM "id"),
    ADD CONSTRAINT "money_transaction_no_self_refund_check" CHECK ("refund_of_id" IS DISTINCT FROM "id"),
    ADD CONSTRAINT "money_transaction_reversal_refund_exclusive_check" CHECK (NOT ("reversal_of_id" IS NOT NULL AND "refund_of_id" IS NOT NULL)),
    ADD CONSTRAINT "money_transaction_draft_posted_fields_check" CHECK ("status" = 'POSTED' OR ("posted_by_id" IS NULL AND "posted_at" IS NULL)),
    ADD CONSTRAINT "money_transaction_description_not_blank_check" CHECK (btrim("description") <> ''),
    ADD CONSTRAINT "money_transaction_idempotency_record_id_fkey" FOREIGN KEY ("idempotency_record_id") REFERENCES public."idempotency_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public."money_line"
    ADD CONSTRAINT "money_line_no_self_original_check" CHECK ("original_line_id" IS DISTINCT FROM "id");

ALTER TABLE public."money_allocation"
    ADD CONSTRAINT "money_allocation_distinct_lines_check" CHECK ("settlement_line_id" <> "receivable_line_id"),
    ADD CONSTRAINT "money_allocation_no_self_release_check" CHECK ("releases_allocation_id" IS DISTINCT FROM "id"),
    ADD CONSTRAINT "money_allocation_apply_no_adjustment_check" CHECK ("action" = 'RELEASE' OR "adjustment_transaction_id" IS NULL);

ALTER TABLE public."fee_charge"
    ADD CONSTRAINT "fee_charge_description_not_blank_check" CHECK (btrim("description") <> '');

ALTER TABLE public."receipt_sequence"
    ADD CONSTRAINT "receipt_sequence_year_check" CHECK ("year" BETWEEN 2000 AND 9999);

CREATE OR REPLACE FUNCTION public.trg_receipt_sequence_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'receipt_sequence records cannot be deleted (year=%)', OLD."year";
    END IF;
    IF NEW."year" IS DISTINCT FROM OLD."year" THEN
        RAISE EXCEPTION 'receipt_sequence year cannot be modified (year=%)', OLD."year";
    END IF;
    IF NEW."next_val" < OLD."next_val" THEN
        RAISE EXCEPTION 'receipt_sequence next_val cannot decrease (year=%, old=%, new=%)', OLD."year", OLD."next_val", NEW."next_val";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receipt_sequence_immutable
    BEFORE UPDATE OR DELETE ON public."receipt_sequence"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_receipt_sequence_immutable();

ALTER TABLE public."receipt"
    ADD CONSTRAINT "receipt_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
    ADD CONSTRAINT "receipt_payer_name_not_blank_check" CHECK (btrim("payer_name") <> ''),
    ADD CONSTRAINT "receipt_number_format_check" CHECK ("receipt_number" ~ '^RCP-[0-9]{4}-[0-9]{4,}$');

CREATE INDEX "money_account_client_matter_party_id_idx"
    ON public."money_account"("client_matter_party_id");

CREATE INDEX "money_line_client_matter_party_id_idx"
    ON public."money_line"("client_matter_party_id");

CREATE INDEX "fee_charge_client_matter_party_id_idx"
    ON public."fee_charge"("client_matter_party_id");

CREATE INDEX "money_transaction_status_transaction_date_created_at_idx"
    ON public."money_transaction"("status", "transaction_date" DESC, "created_at" DESC);

CREATE INDEX "fee_agreement_created_at_idx"
    ON public."fee_agreement"("created_at" DESC);

CREATE INDEX "fee_agreement_status_created_at_idx"
    ON public."fee_agreement"("status", "created_at" DESC);

COMMIT;