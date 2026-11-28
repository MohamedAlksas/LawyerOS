BEGIN;

-- 1. Financial enums (V1; OFFICE_EXPENSE excluded by ADR 0004)
CREATE TYPE "MoneyAccountType" AS ENUM (
    'CASH_CLEARING',
    'FEE_RECEIVABLE',
    'FEE_BASIS',
    'EXPENSE_RECEIVABLE',
    'CLIENT_ADVANCE',
    'OPENING_BRIDGE'
);

CREATE TYPE "MoneyTransactionKind" AS ENUM (
    'FEE_CHARGE',
    'FEE_PAYMENT',
    'REIMBURSABLE_EXPENSE',
    'EXPENSE_REIMBURSEMENT',
    'ADVANCE_RECEIPT',
    'ADVANCE_SPEND',
    'ADVANCE_TO_FEE',
    'MIXED_RECEIPT',
    'REFUND',
    'REVERSAL',
    'OPENING_BALANCE',
    'FEE_ADJUSTMENT'
);

CREATE TYPE "MoneyTransactionStatus" AS ENUM ('DRAFT', 'POSTED');

CREATE TYPE "MoneyLineSide" AS ENUM ('DEBIT', 'CREDIT');

CREATE TYPE "MoneyAllocationAction" AS ENUM ('APPLY', 'RELEASE');

CREATE TYPE "FeeAgreementStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

CREATE TYPE "FeeChargingMethod" AS ENUM ('FIXED', 'INSTALLMENTS', 'HOURLY_ESTIMATE', 'OTHER');

CREATE TYPE "PaymentMethod" AS ENUM (
    'CASH',
    'BANK_TRANSFER',
    'INSTAPAY',
    'CHEQUE',
    'WALLET',
    'OTHER'
);

-- 2. money_account
CREATE TABLE "money_account" (
    "id" TEXT NOT NULL,
    "type" "MoneyAccountType" NOT NULL,
    "matter_id" TEXT,
    "client_matter_party_id" TEXT,
    "cash_method" "PaymentMethod",
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "money_account_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "money_account_dimensions_check" CHECK (
        ("type" = 'CASH_CLEARING' AND "cash_method" IS NOT NULL AND "matter_id" IS NULL AND "client_matter_party_id" IS NULL)
        OR ("type" IN ('FEE_RECEIVABLE', 'FEE_BASIS', 'EXPENSE_RECEIVABLE', 'CLIENT_ADVANCE') AND "matter_id" IS NOT NULL AND "client_matter_party_id" IS NOT NULL AND "cash_method" IS NULL)
        OR ("type" = 'OPENING_BRIDGE' AND "matter_id" IS NULL AND "client_matter_party_id" IS NULL AND "cash_method" IS NULL)
    ),
    CONSTRAINT "money_account_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_account_client_matter_party_id_fkey" FOREIGN KEY ("client_matter_party_id") REFERENCES "matter_party"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "money_account_matter_id_client_matter_party_id_idx"
    ON "money_account"("matter_id", "client_matter_party_id");
CREATE INDEX "money_account_type_idx"
    ON "money_account"("type");

CREATE UNIQUE INDEX "money_account_cash_clearing_key"
    ON "money_account"("type", "cash_method")
    WHERE "type" = 'CASH_CLEARING' AND "cash_method" IS NOT NULL;

CREATE UNIQUE INDEX "money_account_matter_client_key"
    ON "money_account"("type", "matter_id", "client_matter_party_id")
    WHERE "type" IN ('FEE_RECEIVABLE', 'FEE_BASIS', 'EXPENSE_RECEIVABLE', 'CLIENT_ADVANCE')
      AND "matter_id" IS NOT NULL
      AND "client_matter_party_id" IS NOT NULL;

CREATE UNIQUE INDEX "money_account_opening_bridge_key"
    ON "money_account"("type")
    WHERE "type" = 'OPENING_BRIDGE';

-- 3. money_transaction
CREATE TABLE "money_transaction" (
    "id" TEXT NOT NULL,
    "kind" "MoneyTransactionKind" NOT NULL,
    "status" "MoneyTransactionStatus" NOT NULL DEFAULT 'POSTED',
    "transaction_date" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "total_amount_piastres" BIGINT NOT NULL,
    "payment_method" "PaymentMethod",
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "matter_id" TEXT,
    "payer_party_id" TEXT,
    "payee_party_id" TEXT,
    "idempotency_record_id" TEXT,
    "posted_by_id" TEXT,
    "posted_at" TIMESTAMPTZ(3),
    "reversal_of_id" TEXT,
    "refund_of_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "money_transaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "money_transaction_total_amount_piastres_check" CHECK ("total_amount_piastres" > 0),
    CONSTRAINT "money_transaction_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "money_transaction_posted_fields_check" CHECK (
        "status" = 'DRAFT' OR ("posted_by_id" IS NOT NULL AND "posted_at" IS NOT NULL)
    ),
    CONSTRAINT "money_transaction_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_transaction_payer_party_id_fkey" FOREIGN KEY ("payer_party_id") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_transaction_payee_party_id_fkey" FOREIGN KEY ("payee_party_id") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_transaction_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "money_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_transaction_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "money_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "money_transaction_idempotency_record_id_key" ON "money_transaction"("idempotency_record_id");
CREATE UNIQUE INDEX "money_transaction_reversal_of_id_key" ON "money_transaction"("reversal_of_id");
CREATE INDEX "money_transaction_matter_id_transaction_date_idx" ON "money_transaction"("matter_id", "transaction_date");
CREATE INDEX "money_transaction_kind_status_transaction_date_idx" ON "money_transaction"("kind", "status", "transaction_date");
CREATE INDEX "money_transaction_payer_party_id_idx" ON "money_transaction"("payer_party_id");
CREATE INDEX "money_transaction_payee_party_id_idx" ON "money_transaction"("payee_party_id");
CREATE INDEX "money_transaction_refund_of_id_idx" ON "money_transaction"("refund_of_id");

-- 4. money_line
CREATE TABLE "money_line" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "side" "MoneyLineSide" NOT NULL,
    "amount_piastres" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "matter_id" TEXT,
    "client_matter_party_id" TEXT,
    "original_line_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "money_line_amount_piastres_check" CHECK ("amount_piastres" > 0),
    CONSTRAINT "money_line_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "money_line_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "money_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "money_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_line_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_line_client_matter_party_id_fkey" FOREIGN KEY ("client_matter_party_id") REFERENCES "matter_party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_line_original_line_id_fkey" FOREIGN KEY ("original_line_id") REFERENCES "money_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "money_line_account_id_transaction_id_idx" ON "money_line"("account_id", "transaction_id");
CREATE INDEX "money_line_transaction_id_idx" ON "money_line"("transaction_id");
CREATE INDEX "money_line_matter_id_client_matter_party_id_idx" ON "money_line"("matter_id", "client_matter_party_id");
CREATE INDEX "money_line_original_line_id_idx" ON "money_line"("original_line_id");

-- 5. fee_agreement
CREATE TABLE "fee_agreement" (
    "id" TEXT NOT NULL,
    "matter_id" TEXT NOT NULL,
    "client_matter_party_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "total_amount_piastres" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "agreement_date" DATE NOT NULL,
    "charging_method" "FeeChargingMethod" NOT NULL,
    "agreement_document_id" TEXT,
    "status" "FeeAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_transaction_id" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_reason" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,

    CONSTRAINT "fee_agreement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fee_agreement_total_amount_piastres_check" CHECK ("total_amount_piastres" > 0),
    CONSTRAINT "fee_agreement_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "fee_agreement_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_agreement_client_matter_party_id_fkey" FOREIGN KEY ("client_matter_party_id") REFERENCES "matter_party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_agreement_agreement_document_id_fkey" FOREIGN KEY ("agreement_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fee_agreement_approved_transaction_id_fkey" FOREIGN KEY ("approved_transaction_id") REFERENCES "money_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fee_agreement_approved_transaction_id_key" ON "fee_agreement"("approved_transaction_id");
CREATE INDEX "fee_agreement_matter_id_status_idx" ON "fee_agreement"("matter_id", "status");
CREATE INDEX "fee_agreement_client_matter_party_id_status_idx" ON "fee_agreement"("client_matter_party_id", "status");
CREATE INDEX "fee_agreement_agreement_document_id_idx" ON "fee_agreement"("agreement_document_id");

-- 6. fee_charge
CREATE TABLE "fee_charge" (
    "id" TEXT NOT NULL,
    "fee_agreement_id" TEXT NOT NULL,
    "matter_id" TEXT NOT NULL,
    "client_matter_party_id" TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "due_date" DATE,
    "amount_piastres" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "receivable_line_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "fee_charge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fee_charge_amount_piastres_check" CHECK ("amount_piastres" > 0),
    CONSTRAINT "fee_charge_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "fee_charge_installment_number_check" CHECK ("installment_number" >= 1),
    CONSTRAINT "fee_charge_fee_agreement_id_fkey" FOREIGN KEY ("fee_agreement_id") REFERENCES "fee_agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_charge_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_charge_client_matter_party_id_fkey" FOREIGN KEY ("client_matter_party_id") REFERENCES "matter_party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_charge_receivable_line_id_fkey" FOREIGN KEY ("receivable_line_id") REFERENCES "money_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fee_charge_receivable_line_id_key" ON "fee_charge"("receivable_line_id");
CREATE UNIQUE INDEX "fee_charge_fee_agreement_id_installment_number_key" ON "fee_charge"("fee_agreement_id", "installment_number");
CREATE INDEX "fee_charge_matter_id_client_matter_party_id_idx" ON "fee_charge"("matter_id", "client_matter_party_id");
CREATE INDEX "fee_charge_due_date_idx" ON "fee_charge"("due_date");

-- 7. money_allocation
CREATE TABLE "money_allocation" (
    "id" TEXT NOT NULL,
    "settlement_line_id" TEXT NOT NULL,
    "receivable_line_id" TEXT NOT NULL,
    "amount_piastres" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "action" "MoneyAllocationAction" NOT NULL DEFAULT 'APPLY',
    "releases_allocation_id" TEXT,
    "adjustment_transaction_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "money_allocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "money_allocation_amount_piastres_check" CHECK ("amount_piastres" > 0),
    CONSTRAINT "money_allocation_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "money_allocation_action_links_check" CHECK (
        ("action" = 'APPLY' AND "releases_allocation_id" IS NULL)
        OR ("action" = 'RELEASE' AND "releases_allocation_id" IS NOT NULL AND "adjustment_transaction_id" IS NOT NULL)
    ),
    CONSTRAINT "money_allocation_settlement_line_id_fkey" FOREIGN KEY ("settlement_line_id") REFERENCES "money_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_allocation_receivable_line_id_fkey" FOREIGN KEY ("receivable_line_id") REFERENCES "money_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_allocation_releases_allocation_id_fkey" FOREIGN KEY ("releases_allocation_id") REFERENCES "money_allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "money_allocation_adjustment_transaction_id_fkey" FOREIGN KEY ("adjustment_transaction_id") REFERENCES "money_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "money_allocation_receivable_line_id_idx" ON "money_allocation"("receivable_line_id");
CREATE INDEX "money_allocation_settlement_line_id_idx" ON "money_allocation"("settlement_line_id");
CREATE INDEX "money_allocation_releases_allocation_id_idx" ON "money_allocation"("releases_allocation_id");
CREATE INDEX "money_allocation_adjustment_transaction_id_idx" ON "money_allocation"("adjustment_transaction_id");

-- 8. receipt_sequence
CREATE TABLE "receipt_sequence" (
    "year" INTEGER NOT NULL,
    "next_val" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_sequence_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "receipt_sequence_next_val_check" CHECK ("next_val" >= 1)
);

-- 9. receipt
CREATE TABLE "receipt" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "payer_name" TEXT NOT NULL,
    "amount_piastres" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" TEXT NOT NULL,
    "header_snapshot" JSONB NOT NULL,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipt_amount_piastres_check" CHECK ("amount_piastres" > 0),
    CONSTRAINT "receipt_currency_check" CHECK ("currency" = 'EGP'),
    CONSTRAINT "receipt_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "money_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "receipt_transaction_id_key" ON "receipt"("transaction_id");
CREATE UNIQUE INDEX "receipt_receipt_number_key" ON "receipt"("receipt_number");
CREATE INDEX "receipt_year_receipt_number_idx" ON "receipt"("year", "receipt_number");
CREATE INDEX "receipt_issued_at_idx" ON "receipt"("issued_at");

-- 10. Immutability & balanced-posting database invariants (search_path hardened)
CREATE OR REPLACE FUNCTION public.trg_money_transaction_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    IF OLD."status" = 'POSTED' THEN
        RAISE EXCEPTION 'Posted money_transaction records are immutable and cannot be updated or deleted (id=%)', OLD."id";
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_money_transaction_immutable
    BEFORE UPDATE OR DELETE ON public."money_transaction"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_transaction_immutable();

CREATE OR REPLACE FUNCTION public.trg_finance_row_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'Financial table "%" is append-only and immutable (id=%)', TG_TABLE_NAME, OLD."id";
END;
$$;

CREATE TRIGGER trg_money_line_immutable
    BEFORE UPDATE OR DELETE ON public."money_line"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_finance_row_immutable();

CREATE TRIGGER trg_money_allocation_immutable
    BEFORE UPDATE OR DELETE ON public."money_allocation"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_finance_row_immutable();

CREATE TRIGGER trg_fee_charge_immutable
    BEFORE UPDATE OR DELETE ON public."fee_charge"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_finance_row_immutable();

CREATE TRIGGER trg_receipt_immutable
    BEFORE UPDATE OR DELETE ON public."receipt"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_finance_row_immutable();

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
           OR NEW."approved_transaction_id" IS DISTINCT FROM OLD."approved_transaction_id" THEN
            RAISE EXCEPTION 'Financial terms of approved fee_agreement cannot be modified (id=%)', OLD."id";
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fee_agreement_approved_immutable
    BEFORE UPDATE OR DELETE ON public."fee_agreement"
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fee_agreement_approved_immutable();

CREATE OR REPLACE FUNCTION public.trg_assert_posted_transaction_balanced(p_tx_id TEXT)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_status "MoneyTransactionStatus";
    v_total BIGINT;
    v_count INTEGER;
    v_debit BIGINT;
    v_credit BIGINT;
BEGIN
    SELECT "status", "total_amount_piastres"
    INTO v_status, v_total
    FROM public."money_transaction"
    WHERE "id" = p_tx_id;

    IF NOT FOUND OR v_status <> 'POSTED' THEN
        RETURN;
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM(CASE WHEN "side" = 'DEBIT' THEN "amount_piastres" ELSE 0 END), 0)::BIGINT,
        COALESCE(SUM(CASE WHEN "side" = 'CREDIT' THEN "amount_piastres" ELSE 0 END), 0)::BIGINT
    INTO v_count, v_debit, v_credit
    FROM public."money_line"
    WHERE "transaction_id" = p_tx_id;

    IF v_count < 2 OR v_debit <= 0 OR v_credit <= 0 OR v_debit <> v_credit OR v_debit <> v_total THEN
        RAISE EXCEPTION 'Posted money_transaction "%" is unbalanced or incomplete (lines=%, debits=%, credits=%, total=%)',
            p_tx_id, v_count, v_debit, v_credit, v_total;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_money_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    PERFORM public.trg_assert_posted_transaction_balanced(NEW."id");
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_money_transaction_balanced
    AFTER INSERT OR UPDATE ON public."money_transaction"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_transaction_balanced();

CREATE OR REPLACE FUNCTION public.trg_money_line_balanced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
    PERFORM public.trg_assert_posted_transaction_balanced(NEW."transaction_id");
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_money_line_balanced
    AFTER INSERT ON public."money_line"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_money_line_balanced();

COMMIT;