-- Phase 5 (part 2): payments, webhooks, bank transfer proofs, shipments, cash on delivery,
-- cancellation requests, order notes, returns, refunds and the seller payable ledger.

-- AlterTable
ALTER TABLE "order_events" ADD COLUMN     "actor_type" VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "from_status" "seller_order_status",
ADD COLUMN     "to_status" "seller_order_status";

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN     "accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "cancel_reason" VARCHAR(500),
ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "delivered_at" TIMESTAMPTZ(3),
ADD COLUMN     "return_window_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "shipped_at" TIMESTAMPTZ(3);

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('MOCK', 'PAYMONGO', 'MAYA_BUSINESS', 'XENDIT', 'MANUAL_BANK', 'COD');

-- CreateEnum
CREATE TYPE "payment_attempt_status" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "proof_status" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "carrier" AS ENUM ('MOCK', 'SELF', 'JNT', 'LBC', 'NINJA_VAN', 'FLASH', 'TWO_GO');

-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "shipment_direction" AS ENUM ('FORWARD', 'RETURN');

-- CreateEnum
CREATE TYPE "cod_collection_status" AS ENUM ('PENDING', 'COLLECTED', 'REMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "cancellation_request_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "note_visibility" AS ENUM ('CUSTOMER', 'SELLER', 'STAFF');

-- CreateEnum
CREATE TYPE "return_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'ESCALATED', 'RETURN_SHIPPED', 'RECEIVED', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "return_reason" AS ENUM ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'MISSING_PARTS', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER');

-- CreateEnum
CREATE TYPE "return_resolution" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'REJECTED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('PROCESSING', 'AWAITING_PAYOUT', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "refund_reason" AS ENUM ('CANCELLATION', 'RETURN', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'GOODWILL', 'OTHER');

-- CreateEnum
CREATE TYPE "seller_ledger_type" AS ENUM ('ORDER_EARNING', 'COMMISSION', 'SHIPPING_CREDIT', 'REFUND', 'COMMISSION_REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "method" "payment_method" NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "status" "payment_attempt_status" NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "amount_received" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "provider_reference" VARCHAR(120),
    "provider_payment_id" VARCHAR(120),
    "checkout_url" VARCHAR(1000),
    "expires_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "failure_code" VARCHAR(60),
    "failure_message" VARCHAR(500),
    "review_reason" VARCHAR(40),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "from_status" "payment_attempt_status",
    "to_status" "payment_attempt_status",
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "webhook_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(160) NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "status" "webhook_event_status" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(1000),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_payment_sessions" (
    "id" VARCHAR(60) NOT NULL,
    "payment_reference" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "payment_id" VARCHAR(60),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mock_payment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfer_proofs" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "bank_name" VARCHAR(100) NOT NULL,
    "reference_number" VARCHAR(60) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "transferred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "proof_status" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transfer_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "return_request_id" UUID,
    "direction" "shipment_direction" NOT NULL,
    "carrier" "carrier" NOT NULL,
    "carrier_name" VARCHAR(80) NOT NULL,
    "service_name" VARCHAR(80) NOT NULL,
    "tracking_number" VARCHAR(60) NOT NULL,
    "provider_shipment_id" VARCHAR(120),
    "status" "shipment_status" NOT NULL,
    "cod_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "waybill_file_id" UUID,
    "weight_grams" INTEGER NOT NULL,
    "origin" JSONB NOT NULL,
    "destination" JSONB NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "booked_by_id" UUID,
    "picked_up_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "last_event_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" "shipment_status" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "location" VARCHAR(120),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "external_event_id" VARCHAR(120),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_collections" (
    "id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "shipment_id" UUID,
    "carrier" "carrier",
    "expected_amount" DECIMAL(19,4) NOT NULL,
    "collected_amount" DECIMAL(19,4),
    "status" "cod_collection_status" NOT NULL DEFAULT 'PENDING',
    "collected_at" TIMESTAMPTZ(3),
    "remittance_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cod_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_remittances" (
    "id" UUID NOT NULL,
    "carrier" "carrier" NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "remitted_at" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "expected_amount" DECIMAL(19,4) NOT NULL,
    "discrepancy_note" VARCHAR(1000),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cod_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_requests" (
    "id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "cancellation_request_status" NOT NULL DEFAULT 'REQUESTED',
    "responded_by_id" UUID,
    "response" VARCHAR(500),
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancellation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID,
    "author_id" UUID NOT NULL,
    "author_type" VARCHAR(20) NOT NULL,
    "visibility" "note_visibility" NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "return_status" NOT NULL,
    "reason" "return_reason" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "requested_resolution" "return_resolution" NOT NULL,
    "resolution" "return_resolution",
    "refund_amount" DECIMAL(19,4),
    "requires_return_shipment" BOOLEAN NOT NULL DEFAULT true,
    "seller_response" VARCHAR(1000),
    "seller_responded_at" TIMESTAMPTZ(3),
    "seller_deadline" TIMESTAMPTZ(3) NOT NULL,
    "escalation_note" VARCHAR(1000),
    "escalated_at" TIMESTAMPTZ(3),
    "staff_decision_note" VARCHAR(1000),
    "decided_by_id" UUID,
    "received_at" TIMESTAMPTZ(3),
    "restocked" BOOLEAN,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_images" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "return_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID,
    "payment_id" UUID NOT NULL,
    "return_request_id" UUID,
    "reason" "refund_reason" NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "status" "refund_status" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "items_amount" DECIMAL(19,4) NOT NULL,
    "shipping_amount" DECIMAL(19,4) NOT NULL,
    "charges_amount" DECIMAL(19,4) NOT NULL,
    "seller_debit" DECIMAL(19,4) NOT NULL,
    "commission_reversal" DECIMAL(19,4) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "provider_refund_id" VARCHAR(120),
    "payout_reference" VARCHAR(80),
    "failure_message" VARCHAR(500),
    "note" VARCHAR(1000),
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "requested_by_id" UUID,
    "processed_by_id" UUID,
    "succeeded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_ledger_entries" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "seller_order_id" UUID,
    "refund_id" UUID,
    "type" "seller_ledger_type" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_reference_key" ON "payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_reference_key" ON "payments"("provider", "provider_reference");

-- CreateIndex
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payments_review_reason_idx" ON "payments"("review_reason");

-- CreateIndex
CREATE INDEX "payments_reviewed_by_id_idx" ON "payments"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "payments_currency_idx" ON "payments"("currency");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_created_at_idx" ON "payment_events"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_events_actor_id_idx" ON "payment_events"("actor_id");

-- CreateIndex
CREATE INDEX "payment_events_webhook_event_id_idx" ON "payment_events"("webhook_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_event_id_key" ON "webhook_events"("source", "event_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "mock_payment_sessions_payment_reference_idx" ON "mock_payment_sessions"("payment_reference");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfer_proofs_file_id_key" ON "bank_transfer_proofs"("file_id");

-- CreateIndex
CREATE INDEX "bank_transfer_proofs_payment_id_idx" ON "bank_transfer_proofs"("payment_id");

-- CreateIndex
CREATE INDEX "bank_transfer_proofs_status_created_at_idx" ON "bank_transfer_proofs"("status", "created_at");

-- CreateIndex
CREATE INDEX "bank_transfer_proofs_submitted_by_id_idx" ON "bank_transfer_proofs"("submitted_by_id");

-- CreateIndex
CREATE INDEX "bank_transfer_proofs_reviewed_by_id_idx" ON "bank_transfer_proofs"("reviewed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_waybill_file_id_key" ON "shipments"("waybill_file_id");

-- CreateIndex
CREATE INDEX "shipments_carrier_tracking_number_idx" ON "shipments"("carrier", "tracking_number");
-- A courier's tracking number identifies one parcel; numbers typed for self-arranged
-- deliveries and customer returns (SELF) can repeat across sellers.
CREATE UNIQUE INDEX "shipments_tracking_number_per_courier" ON "shipments"("carrier", "tracking_number")
    WHERE "carrier" <> 'SELF';

-- CreateIndex
CREATE INDEX "shipments_seller_order_id_idx" ON "shipments"("seller_order_id");

-- CreateIndex
CREATE INDEX "shipments_return_request_id_idx" ON "shipments"("return_request_id");

-- CreateIndex
CREATE INDEX "shipments_status_last_event_at_idx" ON "shipments"("status", "last_event_at");

-- CreateIndex
CREATE INDEX "shipments_booked_by_id_idx" ON "shipments"("booked_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_events_shipment_id_external_event_id_key" ON "shipment_events"("shipment_id", "external_event_id");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_occurred_at_idx" ON "shipment_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "shipment_events_actor_id_idx" ON "shipment_events"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "cod_collections_seller_order_id_key" ON "cod_collections"("seller_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "cod_collections_shipment_id_key" ON "cod_collections"("shipment_id");

-- CreateIndex
CREATE INDEX "cod_collections_status_carrier_idx" ON "cod_collections"("status", "carrier");

-- CreateIndex
CREATE INDEX "cod_collections_order_id_idx" ON "cod_collections"("order_id");

-- CreateIndex
CREATE INDEX "cod_collections_remittance_id_idx" ON "cod_collections"("remittance_id");

-- CreateIndex
CREATE UNIQUE INDEX "cod_remittances_carrier_reference_key" ON "cod_remittances"("carrier", "reference");

-- CreateIndex
CREATE INDEX "cod_remittances_remitted_at_idx" ON "cod_remittances"("remitted_at");

-- CreateIndex
CREATE INDEX "cod_remittances_recorded_by_id_idx" ON "cod_remittances"("recorded_by_id");

-- CreateIndex
CREATE INDEX "cancellation_requests_seller_order_id_status_idx" ON "cancellation_requests"("seller_order_id", "status");

-- CreateIndex
CREATE INDEX "cancellation_requests_requested_by_id_idx" ON "cancellation_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "cancellation_requests_responded_by_id_idx" ON "cancellation_requests"("responded_by_id");

-- CreateIndex
CREATE INDEX "order_notes_order_id_created_at_idx" ON "order_notes"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_notes_seller_order_id_idx" ON "order_notes"("seller_order_id");

-- CreateIndex
CREATE INDEX "order_notes_author_id_idx" ON "order_notes"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_number_key" ON "return_requests"("number");

-- CreateIndex
CREATE INDEX "return_requests_seller_order_id_idx" ON "return_requests"("seller_order_id");

-- CreateIndex
CREATE INDEX "return_requests_order_id_idx" ON "return_requests"("order_id");

-- CreateIndex
CREATE INDEX "return_requests_seller_id_status_created_at_idx" ON "return_requests"("seller_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "return_requests_customer_id_created_at_idx" ON "return_requests"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "return_requests_status_seller_deadline_idx" ON "return_requests"("status", "seller_deadline");

-- CreateIndex
CREATE INDEX "return_requests_decided_by_id_idx" ON "return_requests"("decided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_items_return_request_id_order_item_id_key" ON "return_items"("return_request_id", "order_item_id");

-- CreateIndex
CREATE INDEX "return_items_order_item_id_idx" ON "return_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_images_file_id_key" ON "return_images"("file_id");

-- CreateIndex
CREATE INDEX "return_images_return_request_id_idx" ON "return_images"("return_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_reference_key" ON "refunds"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_seller_order_id_idx" ON "refunds"("seller_order_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_return_request_id_idx" ON "refunds"("return_request_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE INDEX "refunds_requested_by_id_idx" ON "refunds"("requested_by_id");

-- CreateIndex
CREATE INDEX "refunds_processed_by_id_idx" ON "refunds"("processed_by_id");

-- CreateIndex
CREATE INDEX "seller_ledger_entries_seller_id_created_at_idx" ON "seller_ledger_entries"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "seller_ledger_entries_seller_order_id_idx" ON "seller_ledger_entries"("seller_order_id");

-- CreateIndex
CREATE INDEX "seller_ledger_entries_refund_id_idx" ON "seller_ledger_entries"("refund_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_proofs" ADD CONSTRAINT "bank_transfer_proofs_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_proofs" ADD CONSTRAINT "bank_transfer_proofs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_proofs" ADD CONSTRAINT "bank_transfer_proofs_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_proofs" ADD CONSTRAINT "bank_transfer_proofs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_waybill_file_id_fkey" FOREIGN KEY ("waybill_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_booked_by_id_fkey" FOREIGN KEY ("booked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "cod_remittances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_remittances" ADD CONSTRAINT "cod_remittances_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_responded_by_id_fkey" FOREIGN KEY ("responded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_images" ADD CONSTRAINT "return_images_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_images" ADD CONSTRAINT "return_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- Integrity rules (not expressible in the Prisma schema)
-- ---------------------------------------------------------------------------------------

-- Payments: positive amounts; never more refunded than received; one paid attempt per order.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_check" CHECK (
    "amount" > 0 AND "amount_received" >= 0 AND "refunded_amount" >= 0
    AND "refunded_amount" <= "amount_received"
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_check" CHECK (
    "status" <> 'PAID' OR "paid_at" IS NOT NULL
);
CREATE UNIQUE INDEX "payments_one_paid_per_order" ON "payments" ("order_id") WHERE "status" = 'PAID';

ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_attempts_check" CHECK ("attempts" >= 0);

-- One proof under review per payment at a time.
ALTER TABLE "bank_transfer_proofs" ADD CONSTRAINT "bank_transfer_proofs_amount_check" CHECK ("amount" > 0);
ALTER TABLE "bank_transfer_proofs" ADD CONSTRAINT "bank_transfer_proofs_review_check" CHECK (
    ("status" = 'SUBMITTED' AND "reviewed_at" IS NULL)
    OR ("status" = 'APPROVED' AND "reviewed_at" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "reviewed_at" IS NOT NULL AND "rejection_reason" IS NOT NULL)
);
CREATE UNIQUE INDEX "bank_transfer_proofs_one_open_per_payment" ON "bank_transfer_proofs" ("payment_id")
    WHERE "status" = 'SUBMITTED';

-- Shipments: one active delivery per seller order (replacements belong to a return request).
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_values_check" CHECK (
    "cod_amount" >= 0 AND "failed_attempts" >= 0 AND "weight_grams" >= 0
);
CREATE UNIQUE INDEX "shipments_one_active_delivery" ON "shipments" ("seller_order_id")
    WHERE "direction" = 'FORWARD' AND "return_request_id" IS NULL AND "status" <> 'CANCELLED';

-- Cash on delivery.
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_amounts_check" CHECK (
    "expected_amount" > 0 AND ("collected_amount" IS NULL OR "collected_amount" >= 0)
);
ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_state_check" CHECK (
    ("status" IN ('PENDING', 'FAILED') AND "remittance_id" IS NULL)
    OR ("status" = 'COLLECTED' AND "collected_at" IS NOT NULL AND "remittance_id" IS NULL)
    OR ("status" = 'REMITTED' AND "collected_at" IS NOT NULL AND "remittance_id" IS NOT NULL)
);
ALTER TABLE "cod_remittances" ADD CONSTRAINT "cod_remittances_amounts_check" CHECK (
    "amount" >= 0 AND "expected_amount" >= 0
    AND ("amount" = "expected_amount" OR "discrepancy_note" IS NOT NULL)
);

-- One open cancellation request per seller order.
CREATE UNIQUE INDEX "cancellation_requests_one_open" ON "cancellation_requests" ("seller_order_id")
    WHERE "status" = 'REQUESTED';

ALTER TABLE "return_items" ADD CONSTRAINT "return_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_refund_check" CHECK (
    "refund_amount" IS NULL OR "refund_amount" >= 0
);

-- Refunds add up; at most one live refund per return request and per cancelled seller order.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amounts_check" CHECK (
    "amount" > 0 AND "items_amount" >= 0 AND "shipping_amount" >= 0 AND "charges_amount" >= 0
    AND "amount" = "items_amount" + "shipping_amount" + "charges_amount"
    AND "seller_debit" >= 0 AND "commission_reversal" >= 0
);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_kind_check" CHECK ("kind" IN ('FULL', 'PARTIAL'));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_method_check" CHECK ("method" IN ('ORIGINAL', 'MANUAL'));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_succeeded_check" CHECK (
    "status" <> 'SUCCEEDED' OR "succeeded_at" IS NOT NULL
);
CREATE UNIQUE INDEX "refunds_one_per_return" ON "refunds" ("return_request_id")
    WHERE "return_request_id" IS NOT NULL AND "status" <> 'FAILED';
CREATE UNIQUE INDEX "refunds_one_per_cancellation" ON "refunds" ("seller_order_id")
    WHERE "reason" = 'CANCELLATION' AND "status" <> 'FAILED';

-- Seller payables: earnings, commission and shipping credit are posted once per seller order.
CREATE UNIQUE INDEX "seller_ledger_entries_once_per_order" ON "seller_ledger_entries" ("seller_order_id", "type")
    WHERE "refund_id" IS NULL AND "type" IN ('ORDER_EARNING', 'COMMISSION', 'SHIPPING_CREDIT');
CREATE UNIQUE INDEX "seller_ledger_entries_once_per_refund" ON "seller_ledger_entries" ("refund_id", "type")
    WHERE "refund_id" IS NOT NULL;

-- The seller ledger and the payment history are append-only, like the audit log.
CREATE FUNCTION "append_only_prevent_mutation"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "seller_ledger_entries_append_only"
    BEFORE UPDATE OR DELETE ON "seller_ledger_entries"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "seller_ledger_entries_no_truncate"
    BEFORE TRUNCATE ON "seller_ledger_entries"
    FOR EACH STATEMENT EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "payment_events_append_only"
    BEFORE UPDATE OR DELETE ON "payment_events"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "payment_events_no_truncate"
    BEFORE TRUNCATE ON "payment_events"
    FOR EACH STATEMENT EXECUTE FUNCTION "append_only_prevent_mutation"();

-- Orders: Phase 5 adds COMPLETED, partial payment (cash on delivery remitted per seller order)
-- and refund states to what an order's status and payment status may combine into.
ALTER TABLE "orders" DROP CONSTRAINT "orders_state_check";
ALTER TABLE "orders" DROP CONSTRAINT "orders_cod_check";
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_state_check" CHECK (
        ("status" = 'AWAITING_PAYMENT' AND "payment_status" = 'PENDING' AND "payment_due_at" IS NOT NULL AND "cancelled_at" IS NULL)
        OR ("status" IN ('PLACED', 'COMPLETED')
            AND "payment_status" IN ('PAY_ON_DELIVERY', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND "cancelled_at" IS NULL)
        OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
    ),
    -- Only cash-on-delivery orders are paid on delivery (or partly, as remittances arrive),
    -- and they never wait for an online payment.
    ADD CONSTRAINT "orders_cod_check" CHECK (
        ("payment_method" = 'COD' OR "payment_status" NOT IN ('PAY_ON_DELIVERY', 'PARTIALLY_PAID'))
        AND ("payment_method" <> 'COD' OR "payment_status" <> 'PENDING')
    );
