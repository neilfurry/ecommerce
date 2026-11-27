-- Phase 6: commission engine, double-entry ledger, seller settlement, payouts, tax rules and
-- marketplace service invoices. See ADR 0026–0029.

-- CreateEnum
CREATE TYPE "commission_scope" AS ENUM ('DEFAULT', 'CATEGORY', 'SELLER', 'SELLER_CATEGORY', 'PRODUCT');

-- CreateEnum
CREATE TYPE "commission_type" AS ENUM ('PERCENTAGE', 'FIXED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "tax_kind" AS ENUM ('VAT', 'PERCENTAGE_TAX', 'WITHHOLDING');

-- CreateEnum
CREATE TYPE "tax_applies_to" AS ENUM ('GOODS', 'MARKETPLACE_SERVICES', 'SELLER_REMITTANCE');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "journal_status" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "bank_account_status" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "finance_document_type" AS ENUM ('SERVICE_INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "expense_status" AS ENUM ('UNPAID', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "jurisdiction" CHAR(2) NOT NULL DEFAULT 'PH',
    "kind" "tax_kind" NOT NULL,
    "applies_to" "tax_applies_to" NOT NULL,
    "seller_registration" VARCHAR(20) NOT NULL DEFAULT 'ANY',
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "base_percent" DECIMAL(7,4) NOT NULL DEFAULT 100,
    "inclusive" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(3),
    "legal_reference" VARCHAR(300),
    "created_by_id" UUID,
    "ended_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "description" VARCHAR(500),
    "seller_subledger" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_transactions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" "journal_status" NOT NULL DEFAULT 'DRAFT',
    "description" VARCHAR(300) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "source_type" VARCHAR(30),
    "source_id" UUID,
    "idempotency_key" VARCHAR(120),
    "reversal_of_id" UUID,
    "created_by_id" UUID,
    "posted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journal_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "seller_id" UUID,
    "seller_order_id" UUID,
    "kind" VARCHAR(30),
    "debit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "description" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "seller_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "orders_count" INTEGER NOT NULL,
    "gross_sales" DECIMAL(19,4) NOT NULL,
    "shipping_credits" DECIMAL(19,4) NOT NULL,
    "commission" DECIMAL(19,4) NOT NULL,
    "payment_fees" DECIMAL(19,4) NOT NULL,
    "refunds" DECIMAL(19,4) NOT NULL,
    "commission_reversals" DECIMAL(19,4) NOT NULL,
    "other_adjustments" DECIMAL(19,4) NOT NULL,
    "net_settled" DECIMAL(19,4) NOT NULL,
    "withholding_base" DECIMAL(19,4) NOT NULL,
    "withholding_tax" DECIMAL(19,4) NOT NULL,
    "withholding_snapshot" JSONB NOT NULL,
    "opening_available" DECIMAL(19,4) NOT NULL,
    "closing_available" DECIMAL(19,4) NOT NULL,
    "journal_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "order_number" VARCHAR(24) NOT NULL,
    "gross_sales" DECIMAL(19,4) NOT NULL,
    "shipping_credits" DECIMAL(19,4) NOT NULL,
    "commission" DECIMAL(19,4) NOT NULL,
    "payment_fees" DECIMAL(19,4) NOT NULL,
    "refunds" DECIMAL(19,4) NOT NULL,
    "commission_reversals" DECIMAL(19,4) NOT NULL,
    "other_adjustments" DECIMAL(19,4) NOT NULL,
    "net" DECIMAL(19,4) NOT NULL,
    "withholding_base" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_bank_accounts" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "institution_code" VARCHAR(20),
    "institution_name" VARCHAR(120) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "account_number_encrypted" VARCHAR(300) NOT NULL,
    "account_number_last4" VARCHAR(4) NOT NULL,
    "status" "bank_account_status" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "review_note" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "seller_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "method" VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
    "status" "payout_status" NOT NULL DEFAULT 'REQUESTED',
    "destination" JSONB NOT NULL,
    "transfer_reference" VARCHAR(120),
    "provider_transfer_id" VARCHAR(120),
    "transfer_fee" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "failure_reason" VARCHAR(500),
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "requested_by_id" UUID,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_events" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20),
    "actor_id" UUID,
    "note" VARCHAR(1000),
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_documents" (
    "id" UUID NOT NULL,
    "type" "finance_document_type" NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "seller_id" UUID NOT NULL,
    "settlement_id" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "subtotal" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "lines" JSONB NOT NULL,
    "tax_snapshot" JSONB NOT NULL,
    "buyer_snapshot" JSONB NOT NULL,
    "issuer_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "key" VARCHAR(20) NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "vendor_name" VARCHAR(160) NOT NULL,
    "vendor_tin" VARCHAR(14),
    "description" VARCHAR(300) NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "input_vat" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL,
    "invoice_number" VARCHAR(60),
    "incurred_on" DATE NOT NULL,
    "status" "expense_status" NOT NULL DEFAULT 'UNPAID',
    "paid_at" TIMESTAMPTZ(3),
    "payment_reference" VARCHAR(120),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_rules_jurisdiction_applies_to_effective_from_idx" ON "tax_rules"("jurisdiction", "applies_to", "effective_from");

-- CreateIndex
CREATE INDEX "tax_rules_created_by_id_idx" ON "tax_rules"("created_by_id");

-- CreateIndex
CREATE INDEX "tax_rules_ended_by_id_idx" ON "tax_rules"("ended_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_transactions_reference_key" ON "journal_transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "journal_transactions_idempotency_key_key" ON "journal_transactions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_transactions_reversal_of_id_key" ON "journal_transactions"("reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_transactions_occurred_at_idx" ON "journal_transactions"("occurred_at");

-- CreateIndex
CREATE INDEX "journal_transactions_type_occurred_at_idx" ON "journal_transactions"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "journal_transactions_source_type_source_id_idx" ON "journal_transactions"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "journal_transactions_status_idx" ON "journal_transactions"("status");

-- CreateIndex
CREATE INDEX "journal_transactions_currency_idx" ON "journal_transactions"("currency");

-- CreateIndex
CREATE INDEX "journal_transactions_created_by_id_idx" ON "journal_transactions"("created_by_id");

-- CreateIndex
CREATE INDEX "journal_transactions_posted_by_id_idx" ON "journal_transactions"("posted_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_transaction_id_line_no_key" ON "journal_entries"("transaction_id", "line_no");

-- CreateIndex
CREATE INDEX "journal_entries_account_id_created_at_idx" ON "journal_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "journal_entries_seller_id_account_id_idx" ON "journal_entries"("seller_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_entries_seller_order_id_idx" ON "journal_entries"("seller_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_reference_key" ON "settlements"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_journal_id_key" ON "settlements"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_seller_id_period_start_key" ON "settlements"("seller_id", "period_start");

-- CreateIndex
CREATE INDEX "settlements_period_start_idx" ON "settlements"("period_start");

-- CreateIndex
CREATE INDEX "settlements_created_by_id_idx" ON "settlements"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_lines_seller_order_id_key" ON "settlement_lines"("seller_order_id");

-- CreateIndex
CREATE INDEX "settlement_lines_settlement_id_idx" ON "settlement_lines"("settlement_id");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_seller_id_status_idx" ON "seller_bank_accounts"("seller_id", "status");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_status_created_at_idx" ON "seller_bank_accounts"("status", "created_at");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_reviewed_by_id_idx" ON "seller_bank_accounts"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_created_by_id_idx" ON "seller_bank_accounts"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_reference_key" ON "payouts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_transfer_id_key" ON "payouts"("provider_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotency_key_key" ON "payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "payouts_seller_id_created_at_idx" ON "payouts"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- CreateIndex
CREATE INDEX "payouts_bank_account_id_idx" ON "payouts"("bank_account_id");

-- CreateIndex
CREATE INDEX "payouts_requested_by_id_idx" ON "payouts"("requested_by_id");

-- CreateIndex
CREATE INDEX "payout_events_payout_id_created_at_idx" ON "payout_events"("payout_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_events_actor_id_idx" ON "payout_events"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "finance_documents_number_key" ON "finance_documents"("number");

-- CreateIndex
CREATE UNIQUE INDEX "finance_documents_settlement_id_type_key" ON "finance_documents"("settlement_id", "type");

-- CreateIndex
CREATE INDEX "finance_documents_seller_id_issued_at_idx" ON "finance_documents"("seller_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_reference_key" ON "expenses"("reference");

-- CreateIndex
CREATE INDEX "expenses_status_incurred_on_idx" ON "expenses"("status", "incurred_on");

-- CreateIndex
CREATE INDEX "expenses_account_id_idx" ON "expenses"("account_id");

-- CreateIndex
CREATE INDEX "expenses_created_by_id_idx" ON "expenses"("created_by_id");

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_transactions" ADD CONSTRAINT "journal_transactions_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "journal_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "seller_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_documents" ADD CONSTRAINT "finance_documents_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---- Commission rules become versioned, scoped rules ---------------------------------------
DROP INDEX "commission_rules_category_id_key";
DROP INDEX "commission_rules_one_default";
ALTER TABLE "commission_rules"
    ADD COLUMN "scope" "commission_scope" NOT NULL DEFAULT 'DEFAULT',
    ADD COLUMN "type" "commission_type" NOT NULL DEFAULT 'PERCENTAGE',
    ADD COLUMN "seller_id" UUID,
    ADD COLUMN "product_id" UUID,
    ADD COLUMN "fixed_amount" DECIMAL(19,4),
    ADD COLUMN "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "effective_to" TIMESTAMPTZ(3),
    ADD COLUMN "reason" VARCHAR(500),
    ADD COLUMN "created_by_id" UUID,
    ADD COLUMN "ended_by_id" UUID,
    ALTER COLUMN "rate_percent" SET DEFAULT 0;
UPDATE "commission_rules"
   SET "scope" = CASE WHEN "category_id" IS NULL THEN 'DEFAULT'::"commission_scope" ELSE 'CATEGORY'::"commission_scope" END,
       "effective_from" = "created_at";
ALTER TABLE "commission_rules" DROP CONSTRAINT "commission_rules_category_id_fkey";
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "commission_rules_scope_effective_from_idx" ON "commission_rules"("scope", "effective_from");
CREATE INDEX "commission_rules_category_id_idx" ON "commission_rules"("category_id");
CREATE INDEX "commission_rules_seller_id_idx" ON "commission_rules"("seller_id");
CREATE INDEX "commission_rules_product_id_idx" ON "commission_rules"("product_id");
CREATE INDEX "commission_rules_created_by_id_idx" ON "commission_rules"("created_by_id");
CREATE INDEX "commission_rules_ended_by_id_idx" ON "commission_rules"("ended_by_id");
ALTER TABLE "commission_rules"
    ADD CONSTRAINT "commission_rules_scope_check" CHECK (
        ("scope" = 'DEFAULT' AND "category_id" IS NULL AND "seller_id" IS NULL AND "product_id" IS NULL)
     OR ("scope" = 'CATEGORY' AND "category_id" IS NOT NULL AND "seller_id" IS NULL AND "product_id" IS NULL)
     OR ("scope" = 'SELLER' AND "category_id" IS NULL AND "seller_id" IS NOT NULL AND "product_id" IS NULL)
     OR ("scope" = 'SELLER_CATEGORY' AND "category_id" IS NOT NULL AND "seller_id" IS NOT NULL AND "product_id" IS NULL)
     OR ("scope" = 'PRODUCT' AND "category_id" IS NULL AND "seller_id" IS NULL AND "product_id" IS NOT NULL)),
    ADD CONSTRAINT "commission_rules_type_check" CHECK (
        ("type" = 'PERCENTAGE' AND "fixed_amount" IS NULL)
     OR ("type" = 'FIXED' AND "fixed_amount" IS NOT NULL AND "fixed_amount" >= 0 AND "rate_percent" = 0)
     OR ("type" = 'EXEMPT' AND "fixed_amount" IS NULL AND "rate_percent" = 0 AND "reason" IS NOT NULL)),
    ADD CONSTRAINT "commission_rules_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- ---- Order item snapshots: commission type and tax ------------------------------------------
ALTER TABLE "order_items"
    ADD COLUMN "commission_scope" VARCHAR(20) NOT NULL DEFAULT 'DEFAULT',
    ADD COLUMN "commission_type" VARCHAR(12) NOT NULL DEFAULT 'PERCENTAGE',
    ADD COLUMN "commission_fixed" DECIMAL(19,4),
    ADD COLUMN "tax_rule_id" UUID,
    ADD COLUMN "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT true;
-- Orders placed before Phase 6 used the single 12% VAT-inclusive checkout setting.
UPDATE "order_items" SET "tax_rate" = 12 WHERE "vat_amount" > 0;
UPDATE "order_items" i SET "commission_scope" = r."scope"::text
  FROM "commission_rules" r WHERE r."id" = i."commission_rule_id";
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_commission_rule_id_fkey";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tax_rule_id_fkey" FOREIGN KEY ("tax_rule_id") REFERENCES "tax_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "order_items_tax_rule_id_idx" ON "order_items"("tax_rule_id");

-- ---- Seller orders: the seller's own sales invoice ------------------------------------------
ALTER TABLE "seller_orders"
    ADD COLUMN "seller_invoice_number" VARCHAR(40),
    ADD COLUMN "seller_invoice_date" DATE;

-- ---- Seller tax profile ------------------------------------------------------------------------
ALTER TYPE "seller_document_type" ADD VALUE 'SWORN_DECLARATION' AFTER 'BIR_REGISTRATION';
ALTER TABLE "sellers"
    ADD COLUMN "tax_registered_name" VARCHAR(200),
    ADD COLUMN "tax_verified_at" TIMESTAMPTZ(3),
    ADD COLUMN "tax_verified_by_id" UUID,
    ADD COLUMN "withholding_exempt_until" DATE,
    ADD COLUMN "withholding_exempt_note" VARCHAR(500);
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_tax_verified_by_id_fkey" FOREIGN KEY ("tax_verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sellers_tax_verified_by_id_idx" ON "sellers"("tax_verified_by_id");

-- ---- Checks ----------------------------------------------------------------------------------
ALTER TABLE "tax_rules"
    ADD CONSTRAINT "tax_rules_rate_check" CHECK ("rate_percent" >= 0 AND "rate_percent" <= 100
        AND "base_percent" > 0 AND "base_percent" <= 100),
    ADD CONSTRAINT "tax_rules_registration_check" CHECK ("seller_registration" IN ('ANY', 'VAT_REGISTERED', 'NON_VAT')),
    ADD CONSTRAINT "tax_rules_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
ALTER TABLE "journal_entries"
    ADD CONSTRAINT "journal_entries_amount_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));
ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_period_check" CHECK ("period_end" > "period_start");
ALTER TABLE "payouts"
    ADD CONSTRAINT "payouts_amount_check" CHECK ("amount" > 0 AND "transfer_fee" >= 0),
    ADD CONSTRAINT "payouts_method_check" CHECK ("method" IN ('MANUAL', 'PAYMONGO'));
ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0 AND "input_vat" >= 0 AND "total" = "amount" + "input_vat");
ALTER TABLE "finance_documents"
    ADD CONSTRAINT "finance_documents_total_check" CHECK ("total" = "subtotal" + "tax_amount");
-- One default bank account per seller.
CREATE UNIQUE INDEX "seller_bank_accounts_one_default" ON "seller_bank_accounts"("seller_id") WHERE "is_default";

-- ---- Immutability -----------------------------------------------------------------------------
-- Versioned rules: only the end (effective_to, once) and user references may change; never deleted.
CREATE FUNCTION "versioned_rule_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    unchanged text[] := ARRAY['effective_to', 'ended_by_id', 'created_by_id', 'updated_at'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '% rows are never deleted; end the rule instead', TG_TABLE_NAME;
    END IF;
    IF (to_jsonb(NEW) - unchanged) IS DISTINCT FROM (to_jsonb(OLD) - unchanged) THEN
        RAISE EXCEPTION '% rows cannot be edited; end the rule and create a new version', TG_TABLE_NAME;
    END IF;
    IF OLD."effective_to" IS NOT NULL AND NEW."effective_to" IS DISTINCT FROM OLD."effective_to" THEN
        RAISE EXCEPTION 'An ended % row cannot be changed', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "commission_rules_versioned"
    BEFORE UPDATE OR DELETE ON "commission_rules"
    FOR EACH ROW EXECUTE FUNCTION "versioned_rule_guard"();
CREATE TRIGGER "tax_rules_versioned"
    BEFORE UPDATE OR DELETE ON "tax_rules"
    FOR EACH ROW EXECUTE FUNCTION "versioned_rule_guard"();

-- The prices, commission and tax recorded on an order item never change.
CREATE FUNCTION "order_item_snapshot_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    frozen text[] := ARRAY['unit_price', 'line_subtotal', 'seller_discount', 'platform_discount',
        'line_total', 'vat_amount', 'commission_rule_id', 'commission_scope', 'commission_type',
        'commission_rate', 'commission_fixed', 'commission_base', 'commission_amount',
        'tax_rule_id', 'tax_rate', 'tax_inclusive', 'quantity'];
    k text;
BEGIN
    FOREACH k IN ARRAY frozen LOOP
        IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
            RAISE EXCEPTION 'order_items.% is a snapshot and cannot be changed', k;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "order_items_snapshot"
    BEFORE UPDATE ON "order_items"
    FOR EACH ROW EXECUTE FUNCTION "order_item_snapshot_guard"();

-- Journals: posting requires balanced lines (total debits = total credits), at least two
-- lines and the seller on seller subledger lines. Posted journals and their lines never change.
CREATE FUNCTION "journal_transaction_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    total_debit numeric;
    total_credit numeric;
    line_count int;
    missing_seller int;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" = 'POSTED' THEN
            RAISE EXCEPTION 'Posted journal % cannot be deleted; reverse it instead', OLD."reference";
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."status" = 'POSTED' THEN
        RAISE EXCEPTION 'Posted journal % cannot be changed; reverse it instead', OLD."reference";
    END IF;
    IF NEW."status" = 'POSTED' THEN
        SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*)
          INTO total_debit, total_credit, line_count
          FROM "journal_entries" WHERE "transaction_id" = NEW."id";
        IF line_count < 2 OR total_debit <> total_credit OR total_debit = 0 THEN
            RAISE EXCEPTION 'Journal % does not balance (debits %, credits %, % lines)',
                NEW."reference", total_debit, total_credit, line_count;
        END IF;
        SELECT COUNT(*) INTO missing_seller
          FROM "journal_entries" e JOIN "ledger_accounts" a ON a."id" = e."account_id"
         WHERE e."transaction_id" = NEW."id" AND a."seller_subledger" AND e."seller_id" IS NULL;
        IF missing_seller > 0 THEN
            RAISE EXCEPTION 'Journal %: seller payable lines must name the seller', NEW."reference";
        END IF;
        NEW."posted_at" := COALESCE(NEW."posted_at", CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "journal_transactions_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "journal_transactions"
    FOR EACH ROW EXECUTE FUNCTION "journal_transaction_guard"();

CREATE FUNCTION "journal_entry_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    parent_status text;
    parent_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."transaction_id" ELSE NEW."transaction_id" END;
BEGIN
    SELECT "status"::text INTO parent_status FROM "journal_transactions" WHERE "id" = parent_id;
    IF parent_status = 'POSTED' OR (TG_OP = 'UPDATE' AND OLD."transaction_id" <> NEW."transaction_id") THEN
        RAISE EXCEPTION 'Lines of a posted journal cannot be added, changed or deleted';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "journal_entries_guard"
    BEFORE INSERT OR UPDATE OR DELETE ON "journal_entries"
    FOR EACH ROW EXECUTE FUNCTION "journal_entry_guard"();
CREATE TRIGGER "journal_transactions_no_truncate"
    BEFORE TRUNCATE ON "journal_transactions"
    FOR EACH STATEMENT EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "journal_entries_no_truncate"
    BEFORE TRUNCATE ON "journal_entries"
    FOR EACH STATEMENT EXECUTE FUNCTION "append_only_prevent_mutation"();

-- Statements, settled lines, issued documents and payout logs are append-only.
CREATE TRIGGER "settlements_append_only"
    BEFORE UPDATE OR DELETE ON "settlements"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "settlement_lines_append_only"
    BEFORE UPDATE OR DELETE ON "settlement_lines"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "finance_documents_append_only"
    BEFORE UPDATE OR DELETE ON "finance_documents"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "payout_events_append_only"
    BEFORE UPDATE OR DELETE ON "payout_events"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();

-- Financial records with a status are never deleted (they are cancelled, voided or disabled).
CREATE FUNCTION "prevent_delete"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "payouts_no_delete" BEFORE DELETE ON "payouts"
    FOR EACH ROW EXECUTE FUNCTION "prevent_delete"();
CREATE TRIGGER "expenses_no_delete" BEFORE DELETE ON "expenses"
    FOR EACH ROW EXECUTE FUNCTION "prevent_delete"();
CREATE TRIGGER "seller_bank_accounts_no_delete" BEFORE DELETE ON "seller_bank_accounts"
    FOR EACH ROW EXECUTE FUNCTION "prevent_delete"();
CREATE TRIGGER "ledger_accounts_no_delete" BEFORE DELETE ON "ledger_accounts"
    FOR EACH ROW EXECUTE FUNCTION "prevent_delete"();

-- A bank account's number and holder never change (a new account is added instead).
CREATE FUNCTION "bank_account_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."account_number_encrypted" <> OLD."account_number_encrypted"
       OR NEW."account_name" <> OLD."account_name"
       OR NEW."institution_name" <> OLD."institution_name"
       OR NEW."institution_code" IS DISTINCT FROM OLD."institution_code"
       OR NEW."seller_id" <> OLD."seller_id" THEN
        RAISE EXCEPTION 'Bank account details cannot be changed; add a new account';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "seller_bank_accounts_details"
    BEFORE UPDATE ON "seller_bank_accounts"
    FOR EACH ROW EXECUTE FUNCTION "bank_account_guard"();

-- ---- Chart of accounts --------------------------------------------------------------------------
INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "description", "seller_subledger", "system", "updated_at") VALUES
  (gen_random_uuid(), '1010', 'Cash in bank', 'ASSET', 'Operating bank account: bank transfers, COD remittances, manual payouts and refunds', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '1020', 'Payment provider balance', 'ASSET', 'Money held by the online payment provider (e.g. PayMongo wallet)', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '1100', 'COD receivable from couriers', 'ASSET', 'Cash collected on delivery, not yet remitted', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '1200', 'Input VAT', 'ASSET', 'VAT on marketplace expenses', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2010', 'Customer payments clearing', 'LIABILITY', 'Money received for orders, not yet allocated to sellers and revenue', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2110', 'Seller payables – pending', 'LIABILITY', 'Seller earnings not yet eligible for settlement', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2120', 'Seller payables – available', 'LIABILITY', 'Settled seller earnings that can be paid out', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2130', 'Seller payables – reserved', 'LIABILITY', 'Seller money held by finance', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2140', 'Seller payouts in process', 'LIABILITY', 'Requested payouts not yet paid', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2210', 'Accounts payable – vendors', 'LIABILITY', 'Unpaid marketplace expenses', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2310', 'Output VAT payable', 'LIABILITY', 'VAT on marketplace services invoiced to sellers', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2320', 'Withholding tax payable', 'LIABILITY', 'Tax withheld from seller remittances, to be remitted to the BIR', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '3010', 'Owner''s equity', 'EQUITY', NULL, false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '4010', 'Commission revenue', 'REVENUE', 'Commission charged to sellers (net of VAT)', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '4020', 'Fee recoveries from sellers', 'REVENUE', 'Payment and COD fees passed on to sellers (net of VAT)', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '4030', 'Shipping income', 'REVENUE', 'Shipping fees paid by customers for marketplace-arranged delivery', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '4040', 'Customer charges income', 'REVENUE', 'Checkout charges (e.g. handling fees)', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '4090', 'Refunds and adjustments', 'REVENUE', 'Contra revenue: the marketplace''s share of refunds, remittance differences', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5010', 'Payment processing fees', 'EXPENSE', 'Fees charged by payment providers', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5020', 'COD and courier fees', 'EXPENSE', 'Cash-on-delivery fees and remittance shortages', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5030', 'Marketplace vouchers and promotions', 'EXPENSE', 'Marketplace-funded coupons and shipping discounts', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5040', 'Payout transfer fees', 'EXPENSE', 'Fees for transfers to sellers', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5090', 'Other operating expenses', 'EXPENSE', NULL, false, true, CURRENT_TIMESTAMP);

-- ---- Tax rules (Philippines). Editable by finance: these are starting points, not hardcoded. --
INSERT INTO "tax_rules" ("id", "code", "name", "jurisdiction", "kind", "applies_to", "seller_registration", "rate_percent", "base_percent", "inclusive", "effective_from", "legal_reference", "updated_at") VALUES
  (gen_random_uuid(), 'PH-VAT-GOODS', 'VAT on goods (VAT-registered sellers)', 'PH', 'VAT', 'GOODS', 'VAT_REGISTERED', 12, 100, true, '2020-01-01T00:00:00Z', 'NIRC Sec. 106; prices shown to customers include VAT', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PH-VAT-SERVICES', 'VAT on marketplace services', 'PH', 'VAT', 'MARKETPLACE_SERVICES', 'ANY', 12, 100, true, '2020-01-01T00:00:00Z', 'NIRC Sec. 108 (assumes the marketplace operator is VAT-registered)', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PH-EWT-EMARKETPLACE', 'Withholding on remittances to online sellers', 'PH', 'WITHHOLDING', 'SELLER_REMITTANCE', 'ANY', 0.5, 100, true, '2024-07-15T00:00:00+08:00', 'BIR RR 16-2023 as amended by RR 5-2025 (½% of gross remittances; RMC 8-2024, RMC 55-2026)', CURRENT_TIMESTAMP);
