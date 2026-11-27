-- Phase 7: marketing, customer engagement and advanced marketplace features.
-- Coupon restrictions, campaigns (promotion engine), loyalty points ledger, referrals and
-- affiliates, review images / replies / reports, seller ratings, notifications (templates,
-- outbox, in-app inbox, deliveries, preferences, push subscriptions) and customer support.

-- AlterEnum
ALTER TYPE "file_purpose" ADD VALUE 'REVIEW_IMAGE';
ALTER TYPE "file_purpose" ADD VALUE 'SUPPORT_ATTACHMENT';

-- CreateEnum
CREATE TYPE "promotion_applies_to" AS ENUM ('ALL', 'PRODUCTS', 'CATEGORIES');

-- CreateEnum
CREATE TYPE "campaign_type" AS ENUM ('PERCENTAGE_OFF', 'FIXED_OFF', 'BUNDLE', 'BUY_X_GET_Y', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "loyalty_transaction_type" AS ENUM ('EARN', 'REDEEM', 'RESTORE', 'REVERSE', 'EXPIRE', 'ADJUST', 'REFERRAL_BONUS');

-- CreateEnum
CREATE TYPE "referral_status" AS ENUM ('PENDING', 'REWARDED', 'VOID');

-- CreateEnum
CREATE TYPE "affiliate_status" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "affiliate_conversion_status" AS ENUM ('PENDING', 'ACCRUED', 'CANCELLED', 'PAID');

-- CreateEnum
CREATE TYPE "review_report_reason" AS ENUM ('SPAM', 'OFFENSIVE', 'OFF_TOPIC', 'FAKE', 'PERSONAL_INFORMATION', 'OTHER');

-- CreateEnum
CREATE TYPE "review_report_status" AS ENUM ('OPEN', 'UPHELD', 'DISMISSED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'SMS', 'IN_APP', 'PUSH');

-- CreateEnum
CREATE TYPE "notification_event_status" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "support_ticket_category" AS ENUM ('ORDER', 'PRODUCT', 'PAYMENT', 'SHIPPING', 'RETURN_REFUND', 'ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "support_ticket_status" AS ENUM ('OPEN', 'AWAITING_SELLER', 'AWAITING_SUPPORT', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "support_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "support_author_role" AS ENUM ('CUSTOMER', 'SELLER', 'SUPPORT', 'SYSTEM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "referral_code" VARCHAR(16);

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN "applies_to" "promotion_applies_to" NOT NULL DEFAULT 'ALL',
ADD COLUMN "first_order_only" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "promotion_discount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "points_redeemed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "points_discount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "affiliate_account_id" UUID;

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN "promotion_discount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "points_discount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "points_redeemed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "campaign_id" UUID,
ADD COLUMN "promotion_discount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN "points_discount" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product_reviews" ADD COLUMN "seller_reply" VARCHAR(2000),
ADD COLUMN "seller_reply_at" TIMESTAMPTZ(3),
ADD COLUMN "seller_reply_by_id" UUID,
ADD COLUMN "open_reports" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "coupon_products" (
    "coupon_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "coupon_products_pkey" PRIMARY KEY ("coupon_id", "product_id")
);

-- CreateTable
CREATE TABLE "coupon_categories" (
    "coupon_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "coupon_categories_pkey" PRIMARY KEY ("coupon_id", "category_id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "season" VARCHAR(60),
    "scope" "coupon_scope" NOT NULL,
    "seller_id" UUID,
    "type" "campaign_type" NOT NULL,
    "value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "max_discount" DECIMAL(19,4),
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "buy_quantity" INTEGER,
    "get_quantity" INTEGER,
    "min_spend" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "applies_to" "promotion_applies_to" NOT NULL DEFAULT 'ALL',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "promotion_status" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_products" (
    "campaign_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "campaign_products_pkey" PRIMARY KEY ("campaign_id", "product_id")
);

-- CreateTable
CREATE TABLE "campaign_categories" (
    "campaign_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "campaign_categories_pkey" PRIMARY KEY ("campaign_id", "category_id")
);

-- CreateTable
CREATE TABLE "order_promotions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "campaign_type" NOT NULL,
    "scope" "coupon_scope" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "shipping_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_earned" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "loyalty_transaction_type" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "order_id" UUID,
    "seller_order_id" UUID,
    "refund_id" UUID,
    "referral_id" UUID,
    "description" VARCHAR(300) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referee_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "status" "referral_status" NOT NULL DEFAULT 'PENDING',
    "seller_order_id" UUID,
    "rewarded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "website" VARCHAR(300),
    "status" "affiliate_status" NOT NULL DEFAULT 'PENDING',
    "commission_rate" DECIMAL(5,2),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "affiliate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_clicks" (
    "id" UUID NOT NULL,
    "affiliate_account_id" UUID NOT NULL,
    "landing_path" VARCHAR(300) NOT NULL,
    "visitor_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_conversions" (
    "id" UUID NOT NULL,
    "affiliate_account_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "status" "affiliate_conversion_status" NOT NULL DEFAULT 'PENDING',
    "base_amount" DECIMAL(19,4) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "commission_amount" DECIMAL(19,4) NOT NULL,
    "reversed_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "accrued_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "payout_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "affiliate_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payouts" (
    "id" UUID NOT NULL,
    "affiliate_account_id" UUID NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "method" VARCHAR(60) NOT NULL,
    "external_reference" VARCHAR(120),
    "note" VARCHAR(500),
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_images" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "review_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" "review_report_reason" NOT NULL,
    "details" VARCHAR(500),
    "status" "review_report_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_ratings" (
    "id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_quality" SMALLINT NOT NULL,
    "shipping_speed" SMALLINT NOT NULL,
    "communication" SMALLINT NOT NULL,
    "overall" DECIMAL(3,2) NOT NULL,
    "comment" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "subject" VARCHAR(200),
    "body" VARCHAR(4000) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "user_ids" UUID[],
    "data" JSONB NOT NULL DEFAULT '{}',
    "link" VARCHAR(300),
    "status" "notification_event_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID,
    "event" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "link" VARCHAR(300),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "status" "notification_delivery_status" NOT NULL,
    "destination" VARCHAR(120),
    "provider" VARCHAR(40),
    "detail" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "channel")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" VARCHAR(500) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "user_agent" VARCHAR(300),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "seller_id" UUID,
    "order_id" UUID,
    "seller_order_id" UUID,
    "subject" VARCHAR(160) NOT NULL,
    "category" "support_ticket_category" NOT NULL,
    "status" "support_ticket_status" NOT NULL DEFAULT 'OPEN',
    "priority" "support_priority" NOT NULL DEFAULT 'NORMAL',
    "assigned_to_id" UUID,
    "support_joined_at" TIMESTAMPTZ(3),
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "author_role" "support_author_role" NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupon_products_product_id_idx" ON "coupon_products"("product_id");

-- CreateIndex
CREATE INDEX "coupon_categories_category_id_idx" ON "coupon_categories"("category_id");

-- CreateIndex
CREATE INDEX "campaigns_status_starts_at_ends_at_idx" ON "campaigns"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "campaigns_seller_id_created_at_idx" ON "campaigns"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "campaigns_created_by_id_idx" ON "campaigns"("created_by_id");

-- CreateIndex
CREATE INDEX "campaign_products_product_id_idx" ON "campaign_products"("product_id");

-- CreateIndex
CREATE INDEX "campaign_categories_category_id_idx" ON "campaign_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_promotions_seller_order_id_campaign_id_key" ON "order_promotions"("seller_order_id", "campaign_id");

-- CreateIndex
CREATE INDEX "order_promotions_order_id_idx" ON "order_promotions"("order_id");

-- CreateIndex
CREATE INDEX "order_promotions_campaign_id_idx" ON "order_promotions"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_user_id_key" ON "loyalty_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_idempotency_key_key" ON "loyalty_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "loyalty_transactions_account_id_created_at_idx" ON "loyalty_transactions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_user_id_created_at_idx" ON "loyalty_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_type_expires_at_idx" ON "loyalty_transactions"("type", "expires_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_order_id_idx" ON "loyalty_transactions"("order_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_seller_order_id_idx" ON "loyalty_transactions"("seller_order_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_refund_id_idx" ON "loyalty_transactions"("refund_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_referral_id_idx" ON "loyalty_transactions"("referral_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_created_by_id_idx" ON "loyalty_transactions"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referee_id_key" ON "referrals"("referee_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_accounts_user_id_key" ON "affiliate_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_accounts_code_key" ON "affiliate_accounts"("code");

-- CreateIndex
CREATE INDEX "affiliate_accounts_status_created_at_idx" ON "affiliate_accounts"("status", "created_at");

-- CreateIndex
CREATE INDEX "affiliate_accounts_reviewed_by_id_idx" ON "affiliate_accounts"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "affiliate_clicks_affiliate_account_id_created_at_idx" ON "affiliate_clicks"("affiliate_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_conversions_seller_order_id_key" ON "affiliate_conversions"("seller_order_id");

-- CreateIndex
CREATE INDEX "affiliate_conversions_affiliate_status_created_idx" ON "affiliate_conversions"("affiliate_account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "affiliate_conversions_order_id_idx" ON "affiliate_conversions"("order_id");

-- CreateIndex
CREATE INDEX "affiliate_conversions_payout_id_idx" ON "affiliate_conversions"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_payouts_reference_key" ON "affiliate_payouts"("reference");

-- CreateIndex
CREATE INDEX "affiliate_payouts_affiliate_account_id_paid_at_idx" ON "affiliate_payouts"("affiliate_account_id", "paid_at");

-- CreateIndex
CREATE INDEX "affiliate_payouts_created_by_id_idx" ON "affiliate_payouts"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_images_file_id_key" ON "review_images"("file_id");

-- CreateIndex
CREATE INDEX "review_images_review_id_idx" ON "review_images"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_user_id_key" ON "review_reports"("review_id", "user_id");

-- CreateIndex
CREATE INDEX "review_reports_status_created_at_idx" ON "review_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "review_reports_user_id_idx" ON "review_reports"("user_id");

-- CreateIndex
CREATE INDEX "review_reports_resolved_by_id_idx" ON "review_reports"("resolved_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_ratings_seller_order_id_key" ON "seller_ratings"("seller_order_id");

-- CreateIndex
CREATE INDEX "seller_ratings_seller_id_created_at_idx" ON "seller_ratings"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "seller_ratings_user_id_idx" ON "seller_ratings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_channel_key" ON "notification_templates"("event", "channel");

-- CreateIndex
CREATE INDEX "notification_templates_updated_by_id_idx" ON "notification_templates"("updated_by_id");

-- CreateIndex
CREATE INDEX "notification_events_status_created_at_idx" ON "notification_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_events_event_created_at_idx" ON "notification_events"("event", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_id_user_id_key" ON "notifications"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_event_id_user_id_channel_key" ON "notification_deliveries"("event_id", "user_id", "channel");

-- CreateIndex
CREATE INDEX "notification_deliveries_channel_status_created_at_idx" ON "notification_deliveries"("channel", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_customer_id_last_message_at_idx" ON "support_tickets"("customer_id", "last_message_at");

-- CreateIndex
CREATE INDEX "support_tickets_seller_id_status_last_message_at_idx" ON "support_tickets"("seller_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_tickets_order_id_idx" ON "support_tickets"("order_id");

-- CreateIndex
CREATE INDEX "support_tickets_seller_order_id_idx" ON "support_tickets"("seller_order_id");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_to_id_idx" ON "support_tickets"("assigned_to_id");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "support_messages_author_id_idx" ON "support_messages"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_file_id_key" ON "support_attachments"("file_id");

-- CreateIndex
CREATE INDEX "support_attachments_ticket_id_idx" ON "support_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "support_attachments_message_id_idx" ON "support_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_categories" ADD CONSTRAINT "campaign_categories_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_categories" ADD CONSTRAINT "campaign_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_accounts" ADD CONSTRAINT "affiliate_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_accounts" ADD CONSTRAINT "affiliate_accounts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_affiliate_account_id_fkey" FOREIGN KEY ("affiliate_account_id") REFERENCES "affiliate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_affiliate_account_id_fkey" FOREIGN KEY ("affiliate_account_id") REFERENCES "affiliate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_conversions" ADD CONSTRAINT "affiliate_conversions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "affiliate_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliate_account_id_fkey" FOREIGN KEY ("affiliate_account_id") REFERENCES "affiliate_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_images" ADD CONSTRAINT "review_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "orders_affiliate_account_id_idx" ON "orders"("affiliate_account_id");

-- CreateIndex
CREATE INDEX "order_items_campaign_id_idx" ON "order_items"("campaign_id");

-- CreateIndex
CREATE INDEX "product_reviews_seller_reply_by_id_idx" ON "product_reviews"("seller_reply_by_id");

-- CreateIndex
CREATE INDEX "product_reviews_open_reports_idx" ON "product_reviews"("open_reports");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_account_id_fkey" FOREIGN KEY ("affiliate_account_id") REFERENCES "affiliate_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_seller_reply_by_id_fkey" FOREIGN KEY ("seller_reply_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Integrity rules
-- ---------------------------------------------------------------------------------------------

-- Campaign and points discounts are part of the order item snapshot too.
CREATE OR REPLACE FUNCTION "order_item_snapshot_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    frozen text[] := ARRAY['unit_price', 'line_subtotal', 'seller_discount', 'platform_discount',
        'line_total', 'vat_amount', 'commission_rule_id', 'commission_scope', 'commission_type',
        'commission_rate', 'commission_fixed', 'commission_base', 'commission_amount',
        'tax_rule_id', 'tax_rate', 'tax_inclusive', 'quantity', 'campaign_id',
        'promotion_discount', 'points_discount'];
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

-- The loyalty points ledger and support conversations are append-only.
CREATE TRIGGER "loyalty_transactions_append_only"
    BEFORE UPDATE OR DELETE ON "loyalty_transactions"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "loyalty_transactions_no_truncate"
    BEFORE TRUNCATE ON "loyalty_transactions"
    FOR EACH STATEMENT EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "support_messages_append_only"
    BEFORE UPDATE OR DELETE ON "support_messages"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "affiliate_payouts_append_only"
    BEFORE UPDATE OR DELETE ON "affiliate_payouts"
    FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_mutation"();
CREATE TRIGGER "affiliate_conversions_no_delete" BEFORE DELETE ON "affiliate_conversions"
    FOR EACH ROW EXECUTE FUNCTION "prevent_delete"();

-- A conversion's base, rate and commission are fixed when it is created; only its status,
-- dates, payout and the reversed amount (which only grows, up to the commission) move.
CREATE FUNCTION "affiliate_conversion_guard"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."base_amount" IS DISTINCT FROM OLD."base_amount"
       OR NEW."rate" IS DISTINCT FROM OLD."rate"
       OR NEW."commission_amount" IS DISTINCT FROM OLD."commission_amount"
       OR NEW."affiliate_account_id" IS DISTINCT FROM OLD."affiliate_account_id"
       OR NEW."seller_order_id" IS DISTINCT FROM OLD."seller_order_id" THEN
        RAISE EXCEPTION 'affiliate_conversions amounts cannot be changed';
    END IF;
    IF NEW."reversed_amount" < OLD."reversed_amount" OR NEW."reversed_amount" > NEW."commission_amount" THEN
        RAISE EXCEPTION 'affiliate_conversions.reversed_amount out of range';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "affiliate_conversions_guard"
    BEFORE UPDATE ON "affiliate_conversions"
    FOR EACH ROW EXECUTE FUNCTION "affiliate_conversion_guard"();

-- Order totals now also take off automatic promotions and loyalty points (coupon_discount is
-- coupons only).
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK (
    "items_subtotal" >= 0 AND "wholesale_savings" >= 0 AND "coupon_discount" >= 0
    AND "promotion_discount" >= 0 AND "points_discount" >= 0 AND "points_redeemed" >= 0
    AND "shipping_fee" >= 0 AND "shipping_discount" >= 0 AND "shipping_discount" <= "shipping_fee"
    AND "charges_total" >= 0 AND "vat_amount" >= 0 AND "grand_total" >= 0
    AND "grand_total" = "items_subtotal" - "coupon_discount" - "promotion_discount" - "points_discount"
        + "shipping_fee" - "shipping_discount" + "charges_total"
);
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_engagement_check" CHECK (
    "promotion_discount" >= 0 AND "points_discount" >= 0 AND "points_redeemed" >= 0
    AND "promotion_discount" + "points_discount" <= "seller_discount" + "platform_discount"
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_engagement_check" CHECK (
    "promotion_discount" >= 0 AND "points_discount" >= 0
    AND "promotion_discount" + "points_discount" <= "seller_discount" + "platform_discount"
);

ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_points_nonzero" CHECK ("points" <> 0);
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_balance_nonnegative" CHECK ("balance_after" >= 0);
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_balance_nonnegative" CHECK ("balance" >= 0);
ALTER TABLE "seller_ratings" ADD CONSTRAINT "seller_ratings_scores" CHECK (
    "product_quality" BETWEEN 1 AND 5 AND "shipping_speed" BETWEEN 1 AND 5 AND "communication" BETWEEN 1 AND 5);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_dates" CHECK ("ends_at" > "starts_at");
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_scope_seller" CHECK (("scope" = 'SELLER') = ("seller_id" IS NOT NULL));

-- ---------------------------------------------------------------------------------------------
-- Chart of accounts: loyalty and affiliates
-- ---------------------------------------------------------------------------------------------
INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "description", "seller_subledger", "system", "updated_at") VALUES
  (gen_random_uuid(), '2410', 'Loyalty points liability', 'LIABILITY', 'Value of loyalty points customers hold and can spend', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '2420', 'Affiliate commissions payable', 'LIABILITY', 'Affiliate commissions earned, not yet paid out', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5050', 'Loyalty programme expense', 'EXPENSE', 'Points awarded (less points that expired or were taken back)', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '5060', 'Affiliate commission expense', 'EXPENSE', 'Commissions earned by affiliates on completed orders', false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Default notification templates ({{variables}}; editable by administrators). Events whose
-- email is a built-in transactional email (order placed, new order for sellers, low stock)
-- have no EMAIL template here.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "notification_templates" ("id", "event", "channel", "subject", "body", "enabled", "updated_at") VALUES
  (gen_random_uuid(), 'CUSTOMER_REGISTERED', 'EMAIL', 'Welcome to {{appName}}, {{firstName}}!', 'Hi {{firstName}},

Thanks for joining {{appName}}. Every completed order earns loyalty points you can use on your next purchase.

Happy shopping!', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CUSTOMER_REGISTERED', 'IN_APP', 'Welcome to {{appName}}', 'Your account is ready. Completed orders earn loyalty points.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_PLACED', 'IN_APP', 'Order {{orderNumber}} placed', 'We received your order for ₱{{total}}.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_PLACED', 'SMS', NULL, '{{appName}}: order {{orderNumber}} received (P{{total}}). Thank you!', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_PLACED', 'PUSH', 'Order placed', 'Order {{orderNumber}} for ₱{{total}} was received.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SELLER_NEW_ORDER', 'IN_APP', 'New order {{orderNumber}}', 'A customer ordered from {{storeName}}. Accept it to start fulfilment.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT_CONFIRMED', 'EMAIL', 'Payment received for order {{orderNumber}}', 'Hi {{firstName}},

We received your payment of ₱{{amount}} for order {{orderNumber}}. The sellers are now preparing your items.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT_CONFIRMED', 'IN_APP', 'Payment received', 'Your payment of ₱{{amount}} for order {{orderNumber}} was confirmed.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYMENT_CONFIRMED', 'SMS', NULL, '{{appName}}: payment of P{{amount}} for order {{orderNumber}} confirmed.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_SHIPPED', 'EMAIL', 'Your order {{orderNumber}} has shipped', 'Hi {{firstName}},

{{storeName}} shipped your parcel ({{orderNumber}}) with {{carrier}}. Tracking number: {{trackingNumber}}.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_SHIPPED', 'IN_APP', 'Order shipped', '{{storeName}} shipped {{orderNumber}} with {{carrier}} ({{trackingNumber}}).', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_SHIPPED', 'SMS', NULL, '{{appName}}: {{orderNumber}} shipped via {{carrier}}, tracking {{trackingNumber}}.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_SHIPPED', 'PUSH', 'Your order is on the way', '{{orderNumber}} shipped with {{carrier}}.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_DELIVERED', 'EMAIL', 'Delivered: order {{orderNumber}}', 'Hi {{firstName}},

Your parcel {{orderNumber}} from {{storeName}} was delivered. Rate the products and the seller from your orders page.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_DELIVERED', 'IN_APP', 'Order delivered', '{{orderNumber}} from {{storeName}} was delivered. Tell us how it went!', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_DELIVERED', 'SMS', NULL, '{{appName}}: {{orderNumber}} was delivered.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_DELIVERED', 'PUSH', 'Delivered', '{{orderNumber}} from {{storeName}} was delivered.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REFUND_APPROVED', 'EMAIL', 'Refund of ₱{{amount}} for {{orderNumber}}', 'Hi {{firstName}},

A refund of ₱{{amount}} for order {{orderNumber}} was approved and sent to your original payment method.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REFUND_APPROVED', 'IN_APP', 'Refund approved', '₱{{amount}} for {{orderNumber}} is on its way back to you.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REFUND_APPROVED', 'SMS', NULL, '{{appName}}: refund of P{{amount}} for {{orderNumber}} approved.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYOUT_PAID', 'EMAIL', 'Payout {{reference}} sent: ₱{{amount}}', 'Hello {{sellerName}},

Your payout {{reference}} of ₱{{amount}} was sent. You can find the statement in your seller portal.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PAYOUT_PAID', 'IN_APP', 'Payout sent', 'Payout {{reference}} of ₱{{amount}} was sent to your bank account.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LOW_STOCK', 'IN_APP', 'Low stock', '{{count}} stock level(s) reached the low-stock threshold.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LOYALTY_POINTS_EARNED', 'IN_APP', 'You earned {{points}} points', 'Order {{orderNumber}} earned {{points}} points. Balance: {{balance}} points.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LOYALTY_POINTS_EARNED', 'EMAIL', 'You earned {{points}} loyalty points', 'Hi {{firstName}},

Order {{orderNumber}} earned you {{points}} points. Your balance is now {{balance}} points — use them at checkout.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUPPORT_TICKET_UPDATED', 'IN_APP', 'Ticket {{ticketNumber}} updated', '{{subject}}: {{summary}}', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUPPORT_TICKET_UPDATED', 'EMAIL', '[{{ticketNumber}}] {{subject}}', 'Hello,

There is an update on ticket {{ticketNumber}} ({{subject}}): {{summary}}

Reply from the Help center in your account.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'REVIEW_REPLIED', 'IN_APP', 'The seller replied to your review', '{{storeName}} replied to your review of {{productName}}.', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_UPDATE', 'IN_APP', '{{title}}', '{{orderNumber}}: {{message}}', true, CURRENT_TIMESTAMP);
