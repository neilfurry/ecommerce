-- Phase 4: storefront, cart and checkout. Philippine locations (PSGC), customer addresses,
-- cart, wishlist, reviews, home page content, flash sales, coupons, platform settings,
-- commission rules, and orders split into one suborder per seller with shipping groups.

-- AlterEnum
ALTER TYPE "file_purpose" ADD VALUE 'HOME_BANNER';

-- CreateEnum
CREATE TYPE "location_level" AS ENUM ('REGION', 'PROVINCE', 'CITY', 'MUNICIPALITY', 'SUB_MUNICIPALITY', 'BARANGAY');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "promotion_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "banner_placement" AS ENUM ('HERO', 'PROMO');

-- CreateEnum
CREATE TYPE "coupon_scope" AS ENUM ('PLATFORM', 'SELLER');

-- CreateEnum
CREATE TYPE "coupon_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('AWAITING_PAYMENT', 'PLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "seller_order_status" AS ENUM ('AWAITING_PAYMENT', 'PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('COD', 'GCASH', 'MAYA', 'CARD', 'QR_PH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAY_ON_DELIVERY', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "buyer_type" AS ENUM ('RETAIL', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "shipping_method" AS ENUM ('STANDARD', 'EXPRESS', 'SAME_DAY');

-- CreateEnum
CREATE TYPE "order_event_type" AS ENUM ('PLACED', 'AWAITING_PAYMENT', 'CANCELLED_BY_CUSTOMER', 'PAYMENT_EXPIRED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sold_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_reservations" ALTER COLUMN "expires_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "barangay_code" CHAR(10),
ADD COLUMN     "city_code" CHAR(10),
ADD COLUMN     "province_code" CHAR(10),
ADD COLUMN     "region_code" CHAR(10);

-- CreateTable
CREATE TABLE "ph_locations" (
    "code" CHAR(10) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "level" "location_level" NOT NULL,
    "parent_code" CHAR(10),
    "region_code" CHAR(10) NOT NULL,
    "province_code" CHAR(10),
    "city_code" CHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ph_locations_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(40),
    "recipient_name" VARCHAR(120) NOT NULL,
    "mobile" VARCHAR(16) NOT NULL,
    "region_code" CHAR(10) NOT NULL,
    "province_code" CHAR(10),
    "city_code" CHAR(10) NOT NULL,
    "barangay_code" CHAR(10) NOT NULL,
    "postal_code" VARCHAR(4) NOT NULL,
    "street_address" VARCHAR(200) NOT NULL,
    "address_line2" VARCHAR(200),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "saved_for_later" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_price" DECIMAL(19,4),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "title" VARCHAR(120),
    "body" VARCHAR(4000),
    "status" "review_status" NOT NULL DEFAULT 'PUBLISHED',
    "moderation_note" VARCHAR(500),
    "moderated_by_id" UUID,
    "moderated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_banners" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "subtitle" VARCHAR(200),
    "image_file_id" UUID NOT NULL,
    "link_url" VARCHAR(300),
    "placement" "banner_placement" NOT NULL DEFAULT 'HERO',
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "promotion_status" NOT NULL DEFAULT 'ACTIVE',
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "home_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_products" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_stores" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sales" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "promotion_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_items" (
    "id" UUID NOT NULL,
    "flash_sale_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "flash_price" DECIMAL(19,4) NOT NULL,
    "quantity_limit" INTEGER NOT NULL,
    "sold_quantity" INTEGER NOT NULL DEFAULT 0,
    "per_order_limit" INTEGER,
    "status" "promotion_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flash_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "scope" "coupon_scope" NOT NULL,
    "seller_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "type" "coupon_type" NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "max_discount" DECIMAL(19,4),
    "min_spend" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "status" "promotion_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "category_id" UUID,
    "rate_percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "order_status" NOT NULL,
    "payment_method" "payment_method" NOT NULL,
    "payment_status" "payment_status" NOT NULL,
    "buyer_type" "buyer_type" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "idempotency_key" VARCHAR(100) NOT NULL,
    "address_id" UUID,
    "shipping_address" JSONB NOT NULL,
    "contact_email" VARCHAR(254) NOT NULL,
    "items_subtotal" DECIMAL(19,4) NOT NULL,
    "wholesale_savings" DECIMAL(19,4) NOT NULL,
    "coupon_discount" DECIMAL(19,4) NOT NULL,
    "shipping_fee" DECIMAL(19,4) NOT NULL,
    "shipping_discount" DECIMAL(19,4) NOT NULL,
    "charges_total" DECIMAL(19,4) NOT NULL,
    "vat_amount" DECIMAL(19,4) NOT NULL,
    "grand_total" DECIMAL(19,4) NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "payment_due_at" TIMESTAMPTZ(3),
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_orders" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "number" VARCHAR(24) NOT NULL,
    "status" "seller_order_status" NOT NULL,
    "items_subtotal" DECIMAL(19,4) NOT NULL,
    "wholesale_savings" DECIMAL(19,4) NOT NULL,
    "seller_discount" DECIMAL(19,4) NOT NULL,
    "platform_discount" DECIMAL(19,4) NOT NULL,
    "shipping_fee" DECIMAL(19,4) NOT NULL,
    "seller_shipping_discount" DECIMAL(19,4) NOT NULL,
    "platform_shipping_discount" DECIMAL(19,4) NOT NULL,
    "charges_total" DECIMAL(19,4) NOT NULL,
    "vat_amount" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "commission_amount" DECIMAL(19,4) NOT NULL,
    "charges" JSONB NOT NULL DEFAULT '[]',
    "customer_note" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_shipping_groups" (
    "id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "method" "shipping_method" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "service_name" VARCHAR(80) NOT NULL,
    "origin" JSONB NOT NULL,
    "destination" JSONB NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "chargeable_weight_grams" INTEGER NOT NULL,
    "parcels" JSONB NOT NULL,
    "fee" DECIMAL(19,4) NOT NULL,
    "discount" DECIMAL(19,4) NOT NULL,
    "eta_min_days" INTEGER NOT NULL,
    "eta_max_days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_shipping_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "flash_sale_item_id" UUID,
    "sku" VARCHAR(64) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "variant_title" VARCHAR(200) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "image_url" VARCHAR(300),
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "regular_unit_price" DECIMAL(19,4) NOT NULL,
    "line_subtotal" DECIMAL(19,4) NOT NULL,
    "seller_discount" DECIMAL(19,4) NOT NULL,
    "platform_discount" DECIMAL(19,4) NOT NULL,
    "line_total" DECIMAL(19,4) NOT NULL,
    "vat_amount" DECIMAL(19,4) NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "commission_rule_id" UUID,
    "commission_rate" DECIMAL(5,2) NOT NULL,
    "commission_base" DECIMAL(19,4) NOT NULL,
    "commission_amount" DECIMAL(19,4) NOT NULL,
    "weight_grams" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_coupons" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID,
    "coupon_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "scope" "coupon_scope" NOT NULL,
    "type" "coupon_type" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID,
    "type" "order_event_type" NOT NULL,
    "note" VARCHAR(1000),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ph_locations_parent_code_name_idx" ON "ph_locations"("parent_code", "name");

-- CreateIndex
CREATE INDEX "ph_locations_level_name_idx" ON "ph_locations"("level", "name");

-- CreateIndex
CREATE INDEX "ph_locations_city_code_level_idx" ON "ph_locations"("city_code", "level");

-- CreateIndex
CREATE INDEX "customer_addresses_user_id_created_at_idx" ON "customer_addresses"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_addresses_region_code_idx" ON "customer_addresses"("region_code");

-- CreateIndex
CREATE INDEX "customer_addresses_province_code_idx" ON "customer_addresses"("province_code");

-- CreateIndex
CREATE INDEX "customer_addresses_city_code_idx" ON "customer_addresses"("city_code");

-- CreateIndex
CREATE INDEX "customer_addresses_barangay_code_idx" ON "customer_addresses"("barangay_code");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_user_id_variant_id_key" ON "cart_items"("user_id", "variant_id");

-- CreateIndex
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_product_id_key" ON "wishlist_items"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "wishlist_items_product_id_idx" ON "wishlist_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_reviews_order_item_id_key" ON "product_reviews"("order_item_id");

-- CreateIndex
CREATE INDEX "product_reviews_product_id_status_created_at_idx" ON "product_reviews"("product_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "product_reviews_user_id_created_at_idx" ON "product_reviews"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "product_reviews_seller_id_created_at_idx" ON "product_reviews"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "product_reviews_status_created_at_idx" ON "product_reviews"("status", "created_at");

-- CreateIndex
CREATE INDEX "product_reviews_moderated_by_id_idx" ON "product_reviews"("moderated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "home_banners_image_file_id_key" ON "home_banners"("image_file_id");

-- CreateIndex
CREATE INDEX "home_banners_placement_status_position_idx" ON "home_banners"("placement", "status", "position");

-- CreateIndex
CREATE INDEX "home_banners_created_by_id_idx" ON "home_banners"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "featured_products_product_id_key" ON "featured_products"("product_id");

-- CreateIndex
CREATE INDEX "featured_products_position_idx" ON "featured_products"("position");

-- CreateIndex
CREATE UNIQUE INDEX "featured_stores_store_id_key" ON "featured_stores"("store_id");

-- CreateIndex
CREATE INDEX "featured_stores_position_idx" ON "featured_stores"("position");

-- CreateIndex
CREATE INDEX "flash_sales_status_starts_at_ends_at_idx" ON "flash_sales"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "flash_sales_created_by_id_idx" ON "flash_sales"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_items_flash_sale_id_variant_id_key" ON "flash_sale_items"("flash_sale_id", "variant_id");

-- CreateIndex
CREATE INDEX "flash_sale_items_seller_id_created_at_idx" ON "flash_sale_items"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "flash_sale_items_product_id_idx" ON "flash_sale_items"("product_id");

-- CreateIndex
CREATE INDEX "flash_sale_items_variant_id_status_idx" ON "flash_sale_items"("variant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_scope_status_ends_at_idx" ON "coupons"("scope", "status", "ends_at");

-- CreateIndex
CREATE INDEX "coupons_seller_id_created_at_idx" ON "coupons"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "coupons_currency_idx" ON "coupons"("currency");

-- CreateIndex
CREATE INDEX "coupons_created_by_id_idx" ON "coupons"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_order_id_key" ON "coupon_redemptions"("coupon_id", "order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_user_id_idx" ON "coupon_redemptions"("coupon_id", "user_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_order_id_idx" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_user_id_idx" ON "coupon_redemptions"("user_id");

-- CreateIndex
CREATE INDEX "platform_settings_updated_by_id_idx" ON "platform_settings"("updated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rules_category_id_key" ON "commission_rules"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_customer_id_idempotency_key_key" ON "orders"("customer_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "orders_customer_id_placed_at_idx" ON "orders"("customer_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_payment_due_at_idx" ON "orders"("status", "payment_due_at");

-- CreateIndex
CREATE INDEX "orders_address_id_idx" ON "orders"("address_id");

-- CreateIndex
CREATE INDEX "orders_cancelled_by_id_idx" ON "orders"("cancelled_by_id");

-- CreateIndex
CREATE INDEX "orders_currency_idx" ON "orders"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "seller_orders_number_key" ON "seller_orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "seller_orders_order_id_seller_id_key" ON "seller_orders"("order_id", "seller_id");

-- CreateIndex
CREATE INDEX "seller_orders_seller_id_status_created_at_idx" ON "seller_orders"("seller_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "seller_orders_store_id_idx" ON "seller_orders"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_shipping_groups_seller_order_id_key" ON "order_shipping_groups"("seller_order_id");

-- CreateIndex
CREATE INDEX "order_shipping_groups_warehouse_id_idx" ON "order_shipping_groups"("warehouse_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_seller_order_id_idx" ON "order_items"("seller_order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_created_at_idx" ON "order_items"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE INDEX "order_items_flash_sale_item_id_idx" ON "order_items"("flash_sale_item_id");

-- CreateIndex
CREATE INDEX "order_items_commission_rule_id_idx" ON "order_items"("commission_rule_id");

-- CreateIndex
CREATE INDEX "order_coupons_order_id_idx" ON "order_coupons"("order_id");

-- CreateIndex
CREATE INDEX "order_coupons_seller_order_id_idx" ON "order_coupons"("seller_order_id");

-- CreateIndex
CREATE INDEX "order_coupons_coupon_id_idx" ON "order_coupons"("coupon_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_events_seller_order_id_idx" ON "order_events"("seller_order_id");

-- CreateIndex
CREATE INDEX "order_events_actor_id_idx" ON "order_events"("actor_id");

-- CreateIndex
CREATE INDEX "products_status_sold_count_idx" ON "products"("status", "sold_count");

-- CreateIndex
CREATE INDEX "products_status_rating_average_idx" ON "products"("status", "rating_average");

-- CreateIndex
CREATE INDEX "warehouses_region_code_idx" ON "warehouses"("region_code");

-- CreateIndex
CREATE INDEX "warehouses_province_code_idx" ON "warehouses"("province_code");

-- CreateIndex
CREATE INDEX "warehouses_city_code_idx" ON "warehouses"("city_code");

-- CreateIndex
CREATE INDEX "warehouses_barangay_code_idx" ON "warehouses"("barangay_code");


-- AddForeignKey
ALTER TABLE "ph_locations" ADD CONSTRAINT "ph_locations_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_city_code_fkey" FOREIGN KEY ("city_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_barangay_code_fkey" FOREIGN KEY ("barangay_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_banners" ADD CONSTRAINT "home_banners_image_file_id_fkey" FOREIGN KEY ("image_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_banners" ADD CONSTRAINT "home_banners_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_products" ADD CONSTRAINT "featured_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_stores" ADD CONSTRAINT "featured_stores_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_flash_sale_id_fkey" FOREIGN KEY ("flash_sale_id") REFERENCES "flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_shipping_groups" ADD CONSTRAINT "order_shipping_groups_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_shipping_groups" ADD CONSTRAINT "order_shipping_groups_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_flash_sale_item_id_fkey" FOREIGN KEY ("flash_sale_item_id") REFERENCES "flash_sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_coupons" ADD CONSTRAINT "order_coupons_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_coupons" ADD CONSTRAINT "order_coupons_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_coupons" ADD CONSTRAINT "order_coupons_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_region_code_fkey" FOREIGN KEY ("region_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_city_code_fkey" FOREIGN KEY ("city_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_barangay_code_fkey" FOREIGN KEY ("barangay_code") REFERENCES "ph_locations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- Rules Prisma cannot express: partial unique indexes, search indexes, CHECK constraints.
-- ---------------------------------------------------------------------------------------

-- Trigram matching for partial words in product search ("sinan" finds "Sinandomeng").
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Full-text search over product names and descriptions (PostgreSQL search provider).
CREATE INDEX "products_search_document_idx" ON "products" USING GIN (
    to_tsvector('simple'::regconfig, "name" || ' ' || coalesce("description", ''))
);
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN (lower("name") gin_trgm_ops);

-- One default address per customer; one default commission rate.
CREATE UNIQUE INDEX "customer_addresses_one_default_per_user" ON "customer_addresses"("user_id") WHERE "is_default";
CREATE UNIQUE INDEX "commission_rules_one_default" ON "commission_rules"((true)) WHERE "category_id" IS NULL;

ALTER TABLE "ph_locations"
    ADD CONSTRAINT "ph_locations_code_check" CHECK ("code" ~ '^[0-9]{10}$'),
    ADD CONSTRAINT "ph_locations_parent_check" CHECK (("level" = 'REGION') = ("parent_code" IS NULL));

ALTER TABLE "customer_addresses"
    ADD CONSTRAINT "customer_addresses_mobile_check" CHECK ("mobile" ~ '^\+639[0-9]{9}$'),
    ADD CONSTRAINT "customer_addresses_postal_code_check" CHECK ("postal_code" ~ '^[0-9]{4}$');

ALTER TABLE "cart_items"
    ADD CONSTRAINT "cart_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100000);

ALTER TABLE "product_reviews"
    ADD CONSTRAINT "product_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "products"
    ADD CONSTRAINT "products_rating_check" CHECK ("rating_average" BETWEEN 0 AND 5 AND "rating_count" >= 0),
    ADD CONSTRAINT "products_sold_count_check" CHECK ("sold_count" >= 0);

ALTER TABLE "home_banners"
    ADD CONSTRAINT "home_banners_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at"),
    ADD CONSTRAINT "home_banners_link_check" CHECK ("link_url" IS NULL OR "link_url" ~ '^/[^/]');

ALTER TABLE "featured_products"
    ADD CONSTRAINT "featured_products_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");

ALTER TABLE "flash_sales"
    ADD CONSTRAINT "flash_sales_window_check" CHECK ("starts_at" < "ends_at");

ALTER TABLE "flash_sale_items"
    ADD CONSTRAINT "flash_sale_items_price_check" CHECK ("flash_price" > 0),
    ADD CONSTRAINT "flash_sale_items_quantity_check" CHECK (
        "quantity_limit" > 0 AND "sold_quantity" >= 0 AND "sold_quantity" <= "quantity_limit"
        AND ("per_order_limit" IS NULL OR "per_order_limit" > 0)
    );

ALTER TABLE "coupons"
    ADD CONSTRAINT "coupons_code_check" CHECK ("code" ~ '^[A-Z0-9]{3,30}$'),
    ADD CONSTRAINT "coupons_scope_check" CHECK (("scope" = 'SELLER') = ("seller_id" IS NOT NULL)),
    ADD CONSTRAINT "coupons_value_check" CHECK (
        ("type" = 'PERCENTAGE' AND "value" > 0 AND "value" <= 100)
        OR ("type" = 'FIXED_AMOUNT' AND "value" > 0)
        OR ("type" = 'FREE_SHIPPING' AND "value" = 0)
    ),
    ADD CONSTRAINT "coupons_amounts_check" CHECK ("min_spend" >= 0 AND ("max_discount" IS NULL OR "max_discount" > 0)),
    ADD CONSTRAINT "coupons_window_check" CHECK ("starts_at" < "ends_at"),
    ADD CONSTRAINT "coupons_usage_check" CHECK (
        "per_customer_limit" > 0 AND "used_count" >= 0
        AND ("usage_limit" IS NULL OR ("usage_limit" > 0 AND "used_count" <= "usage_limit"))
    );

ALTER TABLE "coupon_redemptions"
    ADD CONSTRAINT "coupon_redemptions_amount_check" CHECK ("amount" >= 0);

ALTER TABLE "commission_rules"
    ADD CONSTRAINT "commission_rules_rate_check" CHECK ("rate_percent" >= 0 AND "rate_percent" <= 100);

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_amounts_check" CHECK (
        "items_subtotal" >= 0 AND "wholesale_savings" >= 0 AND "coupon_discount" >= 0
        AND "shipping_fee" >= 0 AND "shipping_discount" >= 0 AND "shipping_discount" <= "shipping_fee"
        AND "charges_total" >= 0 AND "vat_amount" >= 0 AND "grand_total" >= 0
        AND "grand_total" = "items_subtotal" - "coupon_discount" + "shipping_fee" - "shipping_discount" + "charges_total"
    ),
    ADD CONSTRAINT "orders_state_check" CHECK (
        ("status" = 'AWAITING_PAYMENT' AND "payment_status" = 'PENDING' AND "payment_due_at" IS NOT NULL AND "cancelled_at" IS NULL)
        OR ("status" = 'PLACED' AND "payment_status" IN ('PAY_ON_DELIVERY', 'PAID') AND "cancelled_at" IS NULL)
        OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
    ),
    ADD CONSTRAINT "orders_cod_check" CHECK (("payment_method" = 'COD') = ("payment_status" = 'PAY_ON_DELIVERY') OR "status" = 'CANCELLED');

ALTER TABLE "seller_orders"
    ADD CONSTRAINT "seller_orders_amounts_check" CHECK (
        "items_subtotal" >= 0 AND "wholesale_savings" >= 0 AND "seller_discount" >= 0 AND "platform_discount" >= 0
        AND "seller_discount" + "platform_discount" <= "items_subtotal"
        AND "shipping_fee" >= 0 AND "seller_shipping_discount" >= 0 AND "platform_shipping_discount" >= 0
        AND "seller_shipping_discount" + "platform_shipping_discount" <= "shipping_fee"
        AND "charges_total" >= 0 AND "vat_amount" >= 0 AND "commission_amount" >= 0
        AND "total" = "items_subtotal" - "seller_discount" - "platform_discount" + "shipping_fee"
            - "seller_shipping_discount" - "platform_shipping_discount" + "charges_total"
    ),
    ADD CONSTRAINT "seller_orders_state_check" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

ALTER TABLE "order_shipping_groups"
    ADD CONSTRAINT "order_shipping_groups_amounts_check" CHECK (
        "fee" >= 0 AND "discount" >= 0 AND "discount" <= "fee"
        AND "weight_grams" >= 0 AND "chargeable_weight_grams" >= "weight_grams"
        AND "eta_min_days" >= 0 AND "eta_max_days" >= "eta_min_days"
    );

ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_amounts_check" CHECK (
        "quantity" > 0 AND "unit_price" > 0 AND "regular_unit_price" > 0
        AND "line_subtotal" = "unit_price" * "quantity"
        AND "seller_discount" >= 0 AND "platform_discount" >= 0
        AND "line_total" = "line_subtotal" - "seller_discount" - "platform_discount" AND "line_total" >= 0
        AND "vat_amount" >= 0
        AND "commission_rate" >= 0 AND "commission_rate" <= 100
        AND "commission_base" >= 0 AND "commission_amount" >= 0
    );

ALTER TABLE "order_coupons"
    ADD CONSTRAINT "order_coupons_amount_check" CHECK ("amount" >= 0);

-- Reservations: a hold without an expiry exists only for an order item (placed orders).
ALTER TABLE "stock_reservations"
    ADD CONSTRAINT "stock_reservations_expiry_check" CHECK ("expires_at" IS NOT NULL OR "order_item_id" IS NOT NULL);
