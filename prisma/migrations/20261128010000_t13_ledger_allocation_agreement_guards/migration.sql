-- 1. money_allocation integrity (BEFORE INSERT) and deferred net allocation bounds (AFTER INSERT)
CREATE OR REPLACE FUNCTION public.trg_money_allocation_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_recv RECORD;
    v_settle RECORD;
    v_target RECORD;
    v_released_sum BIGINT;
BEGIN
    SELECT ml."id", ml."side", ml."matter_id", ml."client_matter_party_id", ma."type"
    INTO v_recv
    FROM public."money_line" ml
    JOIN public."money_account" ma ON ma."id" = ml."account_id"
    WHERE ml."id" = NEW."receivable_line_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'money_allocation references unknown receivable_line_id (%)', NEW."receivable_line_id";
    END IF;

    SELECT ml."id", ml."side", ml."matter_id", ml."client_matter_party_id", ma."type"
    INTO v_settle
    FROM public."money_line" ml
    JOIN public."money_account" ma ON ma."id" = ml."account_id"
    WHERE ml."id" = NEW."settlement_line_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'money_allocation references unknown settlement_line_id (%)', NEW."settlement_line_id";
    END IF;

    IF v_recv."matter_id" IS NULL
       OR v_recv."client_matter_party_id" IS NULL
       OR v_settle."matter_id" IS NULL
       OR v_settle."client_matter_party_id" IS NULL THEN
        RAISE EXCEPTION 'money_allocation lines must have non-null (matter_id, client_matter_party_id) scope';
    END IF;

    IF v_recv."matter_id" IS DISTINCT FROM v_settle."matter_id"
       OR v_recv."client_matter_party_id" IS DISTINCT FROM v_settle."client_matter_party_id" THEN
        RAISE EXCEPTION 'money_allocation receivable_line_id (%) and settlement_line_id (%) must share (matter_id, client_matter_party_id)',
            NEW."receivable_line_id", NEW."settlement_line_id";
    END IF;

    IF v_recv."type" <> 'FEE_RECEIVABLE'::"MoneyAccountType"
       OR v_recv."side" <> 'DEBIT'::"MoneyLineSide" THEN
        RAISE EXCEPTION 'money_allocation receivable_line_id (%) must be a DEBIT line on FEE_RECEIVABLE',
            NEW."receivable_line_id";
    END IF;

    IF NOT (
        (v_settle."type" = 'FEE_RECEIVABLE'::"MoneyAccountType" AND v_settle."side" = 'CREDIT'::"MoneyLineSide")
        OR (v_settle."type" = 'CLIENT_ADVANCE'::"MoneyAccountType" AND v_settle."side" = 'DEBIT'::"MoneyLineSide")
    ) THEN
        RAISE EXCEPTION 'money_allocation settlement_line_id (%) must be a CREDIT on FEE_RECEIVABLE or DEBIT on CLIENT_ADVANCE',
            NEW."settlement_line_id";
    END IF;

    IF NEW."action" = 'RELEASE'::"MoneyAllocationAction" THEN
        IF NEW."releases_allocation_id" IS NULL THEN
            RAISE EXCEPTION 'money_allocation RELEASE requires releases_allocation_id';
        END IF;

        SELECT "id", "action", "receivable_line_id", "settlement_line_id", "amount_piastres"
        INTO v_target
        FROM public."money_allocation"
        WHERE "id" = NEW."releases_allocation_id"
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'money_allocation RELEASE references unknown releases_allocation_id (%)',
                NEW."releases_allocation_id";
        END IF;

        IF v_target."action" <> 'APPLY'::"MoneyAllocationAction" THEN
            RAISE EXCEPTION 'money_allocation RELEASE target (%) must have action APPLY',
                NEW."releases_allocation_id";
        END IF;

        IF v_target."receivable_line_id" IS DISTINCT FROM NEW."receivable_line_id"
           OR v_target."settlement_line_id" IS DISTINCT FROM NEW."settlement_line_id" THEN
            RAISE EXCEPTION 'money_allocation RELEASE (%) must match target APPLY (receivable_line_id, settlement_line_id)',
                NEW."releases_allocation_id";
        END IF;

        SELECT COALESCE(SUM("amount_piastres"), 0)::BIGINT
        INTO v_released_sum
        FROM public."money_allocation"
        WHERE "action" = 'RELEASE'::"MoneyAllocationAction"
          AND "releases_allocation_id" = NEW."releases_allocation_id";

        IF v_released_sum + NEW."amount_piastres" > v_target."amount_piastres" THEN
            RAISE EXCEPTION 'money_allocation RELEASE cumulative sum (% + %) exceeds target APPLY amount (%) for allocation (%)',
                v_released_sum, NEW."amount_piastres", v_target."amount_piastres", NEW."releases_allocation_id";
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_money_allocation_integrity
    BEFORE INSERT ON public."money_allocation"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_allocation_integrity();

CREATE OR REPLACE FUNCTION public.trg_money_allocation_bounds()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_recv_amount BIGINT;
    v_settle_amount BIGINT;
    v_recv_net BIGINT;
    v_settle_net BIGINT;
BEGIN
    SELECT "amount_piastres"
    INTO v_recv_amount
    FROM public."money_line"
    WHERE "id" = NEW."receivable_line_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'money_allocation references unknown receivable_line_id (%)', NEW."receivable_line_id";
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN "action" = 'APPLY'::"MoneyAllocationAction" THEN "amount_piastres"
             ELSE -"amount_piastres"
        END
    ), 0)::BIGINT
    INTO v_recv_net
    FROM public."money_allocation"
    WHERE "receivable_line_id" = NEW."receivable_line_id";

    IF v_recv_net < 0 OR v_recv_net > v_recv_amount THEN
        RAISE EXCEPTION 'Net allocation (%) for receivable_line_id (%) is out of bounds [0, %]',
            v_recv_net, NEW."receivable_line_id", v_recv_amount;
    END IF;

    SELECT "amount_piastres"
    INTO v_settle_amount
    FROM public."money_line"
    WHERE "id" = NEW."settlement_line_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'money_allocation references unknown settlement_line_id (%)', NEW."settlement_line_id";
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN "action" = 'APPLY'::"MoneyAllocationAction" THEN "amount_piastres"
             ELSE -"amount_piastres"
        END
    ), 0)::BIGINT
    INTO v_settle_net
    FROM public."money_allocation"
    WHERE "settlement_line_id" = NEW."settlement_line_id";

    IF v_settle_net < 0 OR v_settle_net > v_settle_amount THEN
        RAISE EXCEPTION 'Net allocation (%) for settlement_line_id (%) is out of bounds [0, %]',
            v_settle_net, NEW."settlement_line_id", v_settle_amount;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_money_allocation_bounds
    AFTER INSERT ON public."money_allocation"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_allocation_bounds();

-- 2. fee_charge & fee_agreement deferred integrity
CREATE OR REPLACE FUNCTION public.trg_assert_fee_agreement_charges(p_agreement_id TEXT)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_ag RECORD;
    v_charge_count INTEGER;
    v_charge_sum BIGINT;
    v_mismatch_count INTEGER;
BEGIN
    SELECT "id", "status", "matter_id", "client_matter_party_id", "total_amount_piastres", "approved_transaction_id"
    INTO v_ag
    FROM public."fee_agreement"
    WHERE "id" = p_agreement_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_ag."status" <> 'APPROVED'::"FeeAgreementStatus" THEN
        IF EXISTS (
            SELECT 1
            FROM public."fee_charge"
            WHERE "fee_agreement_id" = p_agreement_id
        ) THEN
            RAISE EXCEPTION 'fee_charge rows are only allowed for APPROVED fee_agreement (fee_agreement_id=%, status=%)',
                p_agreement_id, v_ag."status";
        END IF;
        RETURN;
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM(fc."amount_piastres"), 0)::BIGINT,
        COUNT(*) FILTER (
            WHERE fc."matter_id" IS DISTINCT FROM v_ag."matter_id"
               OR fc."client_matter_party_id" IS DISTINCT FROM v_ag."client_matter_party_id"
               OR ml."transaction_id" IS DISTINCT FROM v_ag."approved_transaction_id"
        )::INTEGER
    INTO v_charge_count, v_charge_sum, v_mismatch_count
    FROM public."fee_charge" fc
    JOIN public."money_line" ml ON ml."id" = fc."receivable_line_id"
    WHERE fc."fee_agreement_id" = p_agreement_id;

    IF v_mismatch_count > 0 THEN
        RAISE EXCEPTION 'fee_charge rows for fee_agreement (%) must match agreement (matter_id, client_matter_party_id) and approved_transaction_id',
            p_agreement_id;
    END IF;

    IF v_charge_count = 0 OR v_charge_sum <> v_ag."total_amount_piastres" THEN
        RAISE EXCEPTION 'Approved fee_agreement (%) requires SUM(fee_charge.amount_piastres) = total_amount_piastres (count=%, sum=%, total=%)',
            p_agreement_id, v_charge_count, v_charge_sum, v_ag."total_amount_piastres";
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fee_charge_agreement_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.trg_assert_fee_agreement_charges(OLD."fee_agreement_id");
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD."fee_agreement_id" IS DISTINCT FROM NEW."fee_agreement_id" THEN
            PERFORM public.trg_assert_fee_agreement_charges(OLD."fee_agreement_id");
        END IF;
        PERFORM public.trg_assert_fee_agreement_charges(NEW."fee_agreement_id");
    ELSE
        PERFORM public.trg_assert_fee_agreement_charges(NEW."fee_agreement_id");
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_fee_charge_agreement_integrity
    AFTER INSERT OR UPDATE OR DELETE ON public."fee_charge"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fee_charge_agreement_integrity();

CREATE OR REPLACE FUNCTION public.trg_fee_agreement_charges_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    PERFORM public.trg_assert_fee_agreement_charges(NEW."id");
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_fee_agreement_charges_integrity
    AFTER INSERT OR UPDATE ON public."fee_agreement"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fee_agreement_charges_integrity();

-- 3. money_transaction & receipt guards
ALTER TABLE public."money_transaction"
    ADD CONSTRAINT "money_transaction_reversal_kind_check"
        CHECK (("kind" = 'REVERSAL') = ("reversal_of_id" IS NOT NULL)),
    ADD CONSTRAINT "money_transaction_refund_kind_check"
        CHECK ("kind" = 'REFUND' OR "refund_of_id" IS NULL);

CREATE OR REPLACE FUNCTION public.trg_money_transaction_reversal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_orig RECORD;
BEGIN
    IF NEW."reversal_of_id" IS NOT NULL THEN
        SELECT "kind", "status"
        INTO v_orig
        FROM public."money_transaction"
        WHERE "id" = NEW."reversal_of_id";

        IF NOT FOUND THEN
            RAISE EXCEPTION 'money_transaction reversal_of_id (%) does not exist', NEW."reversal_of_id";
        END IF;

        IF v_orig."kind" = 'REVERSAL'::"MoneyTransactionKind" THEN
            RAISE EXCEPTION 'Cannot reverse a REVERSAL money_transaction (reversal_of_id=%)', NEW."reversal_of_id";
        END IF;

        IF v_orig."status" <> 'POSTED'::"MoneyTransactionStatus" THEN
            RAISE EXCEPTION 'Cannot reverse a non-POSTED money_transaction (reversal_of_id=%, status=%)',
                NEW."reversal_of_id", v_orig."status";
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_money_transaction_reversal_guard
    BEFORE INSERT OR UPDATE OF "reversal_of_id" ON public."money_transaction"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_transaction_reversal_guard();

CREATE OR REPLACE FUNCTION public.trg_receipt_transaction_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_tx RECORD;
BEGIN
    SELECT "status", "total_amount_piastres", "payment_method"
    INTO v_tx
    FROM public."money_transaction"
    WHERE "id" = NEW."transaction_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'receipt references unknown money_transaction (transaction_id=%)', NEW."transaction_id";
    END IF;

    IF v_tx."status" <> 'POSTED'::"MoneyTransactionStatus" THEN
        RAISE EXCEPTION 'receipt requires a POSTED money_transaction (transaction_id=%, status=%)',
            NEW."transaction_id", v_tx."status";
    END IF;

    IF v_tx."total_amount_piastres" <> NEW."amount_piastres" THEN
        RAISE EXCEPTION 'receipt amount_piastres (%) must match money_transaction total_amount_piastres (%)',
            NEW."amount_piastres", v_tx."total_amount_piastres";
    END IF;

    IF v_tx."payment_method" IS NOT NULL
       AND v_tx."payment_method" IS DISTINCT FROM NEW."payment_method" THEN
        RAISE EXCEPTION 'receipt payment_method (%) must match money_transaction payment_method (%)',
            NEW."payment_method", v_tx."payment_method";
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receipt_transaction_guard
    BEFORE INSERT ON public."receipt"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_receipt_transaction_guard();

-- 4. fee_agreement & money_line immutability polish
CREATE OR REPLACE FUNCTION public.trg_fee_agreement_approved_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF OLD."status" = 'APPROVED'::"FeeAgreementStatus" THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Approved fee_agreement records are immutable and cannot be deleted (id=%)', OLD."id";
        END IF;
        RAISE EXCEPTION 'Approved fee_agreement records are immutable and cannot be modified (id=%)', OLD."id";
    ELSIF OLD."status" = 'CANCELLED'::"FeeAgreementStatus" THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Cancelled fee_agreement records are immutable and cannot be deleted (id=%)', OLD."id";
        END IF;
        RAISE EXCEPTION 'Cancelled fee_agreement records are immutable and cannot be modified (id=%)', OLD."id";
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE public."fee_agreement"
    DROP CONSTRAINT "fee_agreement_agreement_document_id_fkey",
    ADD CONSTRAINT "fee_agreement_agreement_document_id_fkey"
        FOREIGN KEY ("agreement_document_id") REFERENCES public."document"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.trg_money_line_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_status "MoneyTransactionStatus";
BEGIN
    SELECT "status"
    INTO v_status
    FROM public."money_transaction"
    WHERE "id" = OLD."transaction_id";

    IF v_status = 'POSTED'::"MoneyTransactionStatus" THEN
        RAISE EXCEPTION 'money_line rows for POSTED money_transaction are immutable and cannot be updated or deleted (id=%, transaction_id=%)',
            OLD."id", OLD."transaction_id";
    END IF;

    IF TG_OP = 'UPDATE' AND NEW."transaction_id" IS DISTINCT FROM OLD."transaction_id" THEN
        SELECT "status"
        INTO v_status
        FROM public."money_transaction"
        WHERE "id" = NEW."transaction_id";

        IF NOT FOUND THEN
            RAISE EXCEPTION 'money_line references unknown money_transaction (transaction_id=%)', NEW."transaction_id";
        END IF;

        IF v_status = 'POSTED'::"MoneyTransactionStatus" THEN
            RAISE EXCEPTION 'Cannot move money_line into POSTED money_transaction (id=%, transaction_id=%)',
                OLD."id", NEW."transaction_id";
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_money_line_immutable ON public."money_line";

CREATE TRIGGER trg_money_line_immutable
    BEFORE UPDATE OR DELETE ON public."money_line"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_line_immutable();

DROP TRIGGER IF EXISTS trg_money_line_integrity ON public."money_line";

CREATE TRIGGER trg_money_line_integrity
    BEFORE INSERT OR UPDATE ON public."money_line"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_line_integrity();
