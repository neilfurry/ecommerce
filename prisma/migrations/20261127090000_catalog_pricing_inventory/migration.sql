-- Phase 3: catalog (categories, brands, products, variants, images), pricing rules and
-- inventory (warehouses, stock levels, ledger, transfers, reservations).

-- AlterEnum
ALTER TYPE "file_purpose" ADD VALUE 'PRODUCT_IMAGE';
ALTER TYPE "file_purpose" ADD VALUE 'PRODUCT_IMAGE_THUMBNAIL';
ALTER TYPE "file_purpose" ADD VALUE 'CATEGORY_IMAGE';

-- CreateEnum
CREATE TYPE "category_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "category_attribute_type" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'SELECT');

-- CreateEnum
CREATE TYPE "brand_status" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "product_event_type" AS ENUM ('CREATED', 'SUBMITTED', 'CHANGED_AFTER_APPROVAL', 'APPROVED', 'REJECTED', 'DEACTIVATED', 'ACTIVATED', 'TAKEN_DOWN', 'ARCHIVED', 'RESTORED');

-- CreateEnum
CREATE TYPE "variant_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "warehouse_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "inventory_movement_type" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGED', 'DAMAGED_WRITE_OFF', 'RETURN_RESTOCK', 'RETURN_DAMAGED', 'SALE');

-- CreateEnum
CREATE TYPE "stock_reservation_status" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000),
    "image_file_id" UUID,
    "status" "category_status" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "depth" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "category_attribute_type" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "unit" VARCHAR(20),
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "status" "brand_status" NOT NULL DEFAULT 'ACTIVE',
    "requested_by_seller_id" UUID,
    "review_note" VARCHAR(1000),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "brand_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "description" VARCHAR(20000),
    "specifications" JSONB NOT NULL DEFAULT '[]',
    "attribute_values" JSONB NOT NULL DEFAULT '{}',
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "min_order_quantity" INTEGER NOT NULL DEFAULT 1,
    "max_order_quantity" INTEGER,
    "wholesale_enabled" BOOLEAN NOT NULL DEFAULT false,
    "wholesale_min_order_quantity" INTEGER NOT NULL DEFAULT 1,
    "seo_title" VARCHAR(70),
    "seo_description" VARCHAR(160),
    "seo_keywords" VARCHAR(255),
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "review_note" VARCHAR(1000),
    "approved_at" TIMESTAMPTZ(3),
    "moderated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_events" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "product_event_type" NOT NULL,
    "from_status" "product_status",
    "to_status" "product_status",
    "note" VARCHAR(1000),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "value" VARCHAR(60) NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "title" VARCHAR(200) NOT NULL,
    "option_key" VARCHAR(200) NOT NULL DEFAULT '',
    "regular_price" DECIMAL(19,4) NOT NULL,
    "sale_price" DECIMAL(19,4),
    "sale_starts_at" TIMESTAMPTZ(3),
    "sale_ends_at" TIMESTAMPTZ(3),
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "weight_grams" INTEGER,
    "length_cm" DECIMAL(8,2),
    "width_cm" DECIMAL(8,2),
    "height_cm" DECIMAL(8,2),
    "status" "variant_status" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_option_values" (
    "variant_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,

    CONSTRAINT "variant_option_values_pkey" PRIMARY KEY ("variant_id","option_value_id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "file_id" UUID NOT NULL,
    "thumbnail_file_id" UUID NOT NULL,
    "alt_text" VARCHAR(200),
    "position" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "min_quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_prices" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "customer_id" UUID NOT NULL,
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "address_line1" VARCHAR(160) NOT NULL,
    "address_line2" VARCHAR(160),
    "barangay" VARCHAR(100),
    "city" VARCHAR(100) NOT NULL,
    "province" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(4),
    "contact_name" VARCHAR(120),
    "phone" VARCHAR(16),
    "status" "warehouse_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "damaged_quantity" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER,
    "low_stock_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "stock_level_id" UUID NOT NULL,
    "type" "inventory_movement_type" NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "damaged_change" INTEGER NOT NULL DEFAULT 0,
    "on_hand_after" INTEGER NOT NULL,
    "reserved_after" INTEGER NOT NULL,
    "damaged_after" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "transfer_id" UUID,
    "reservation_id" UUID,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "stock_level_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "stock_reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "checkout_reference" VARCHAR(100) NOT NULL,
    "order_item_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "converted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_image_file_id_key" ON "categories"("image_file_id");

-- CreateIndex
CREATE INDEX "categories_parent_id_sort_order_idx" ON "categories"("parent_id", "sort_order");

-- CreateIndex
CREATE INDEX "categories_status_idx" ON "categories"("status");

-- CreateIndex
CREATE UNIQUE INDEX "category_attributes_category_id_code_key" ON "category_attributes"("category_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_status_name_idx" ON "brands"("status", "name");

-- CreateIndex
CREATE INDEX "brands_requested_by_seller_id_idx" ON "brands"("requested_by_seller_id");

-- CreateIndex
CREATE INDEX "brands_reviewed_by_id_idx" ON "brands"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "products_seller_id_status_updated_at_idx" ON "products"("seller_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "products_status_submitted_at_idx" ON "products"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_currency_idx" ON "products"("currency");

-- CreateIndex
CREATE INDEX "products_reviewed_by_id_idx" ON "products"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "products_created_by_id_idx" ON "products"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_store_id_slug_key" ON "products"("store_id", "slug");

-- CreateIndex
CREATE INDEX "product_events_product_id_created_at_idx" ON "product_events"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "product_events_actor_id_idx" ON "product_events"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_name_key" ON "product_options"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_values_option_id_value_key" ON "product_option_values"("option_id", "value");

-- CreateIndex
CREATE INDEX "product_variants_product_id_position_idx" ON "product_variants"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_variants_barcode_idx" ON "product_variants"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_seller_id_sku_key" ON "product_variants"("seller_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_option_key_key" ON "product_variants"("product_id", "option_key");

-- CreateIndex
CREATE INDEX "variant_option_values_option_value_id_idx" ON "variant_option_values"("option_value_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_file_id_key" ON "product_images"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_thumbnail_file_id_key" ON "product_images"("thumbnail_file_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- CreateIndex
CREATE INDEX "price_tiers_product_id_variant_id_min_quantity_idx" ON "price_tiers"("product_id", "variant_id", "min_quantity");

-- CreateIndex
CREATE INDEX "price_tiers_variant_id_idx" ON "price_tiers"("variant_id");

-- CreateIndex
CREATE INDEX "customer_prices_customer_id_product_id_idx" ON "customer_prices"("customer_id", "product_id");

-- CreateIndex
CREATE INDEX "customer_prices_product_id_variant_id_idx" ON "customer_prices"("product_id", "variant_id");

-- CreateIndex
CREATE INDEX "customer_prices_variant_id_idx" ON "customer_prices"("variant_id");

-- CreateIndex
CREATE INDEX "warehouses_seller_id_status_idx" ON "warehouses"("seller_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_seller_id_code_key" ON "warehouses"("seller_id", "code");

-- CreateIndex
CREATE INDEX "stock_levels_variant_id_idx" ON "stock_levels"("variant_id");

-- CreateIndex
CREATE INDEX "stock_levels_seller_id_updated_at_idx" ON "stock_levels"("seller_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_warehouse_id_variant_id_key" ON "stock_levels"("warehouse_id", "variant_id");

-- CreateIndex
CREATE INDEX "inventory_movements_seller_id_created_at_idx" ON "inventory_movements"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_stock_level_id_created_at_idx" ON "inventory_movements"("stock_level_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_warehouse_id_created_at_idx" ON "inventory_movements"("warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_transfer_id_idx" ON "inventory_movements"("transfer_id");

-- CreateIndex
CREATE INDEX "inventory_movements_reservation_id_idx" ON "inventory_movements"("reservation_id");

-- CreateIndex
CREATE INDEX "inventory_movements_actor_id_idx" ON "inventory_movements"("actor_id");

-- CreateIndex
CREATE INDEX "stock_transfers_seller_id_created_at_idx" ON "stock_transfers"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_from_warehouse_id_idx" ON "stock_transfers"("from_warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transfers_to_warehouse_id_idx" ON "stock_transfers"("to_warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transfers_created_by_id_idx" ON "stock_transfers"("created_by_id");

-- CreateIndex
CREATE INDEX "stock_transfer_items_variant_id_idx" ON "stock_transfer_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_items_transfer_id_variant_id_key" ON "stock_transfer_items"("transfer_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservations_checkout_reference_idx" ON "stock_reservations"("checkout_reference");

-- CreateIndex
CREATE INDEX "stock_reservations_order_item_id_idx" ON "stock_reservations"("order_item_id");

-- CreateIndex
CREATE INDEX "stock_reservations_stock_level_id_status_idx" ON "stock_reservations"("stock_level_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_seller_id_created_at_idx" ON "stock_reservations"("seller_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_reservations_variant_id_idx" ON "stock_reservations"("variant_id");

-- CreateIndex
CREATE INDEX "stock_reservations_warehouse_id_idx" ON "stock_reservations"("warehouse_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_file_id_fkey" FOREIGN KEY ("image_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_requested_by_seller_id_fkey" FOREIGN KEY ("requested_by_seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "product_option_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_thumbnail_file_id_fkey" FOREIGN KEY ("thumbnail_file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_stock_level_id_fkey" FOREIGN KEY ("stock_level_id") REFERENCES "stock_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "stock_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_stock_level_id_fkey" FOREIGN KEY ("stock_level_id") REFERENCES "stock_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Integrity rules Prisma cannot express (kept in step with the services).
-- ---------------------------------------------------------------------------------------

ALTER TABLE "categories"
    ADD CONSTRAINT "categories_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ADD CONSTRAINT "categories_depth_check" CHECK ("depth" BETWEEN 0 AND 2),
    ADD CONSTRAINT "categories_root_depth_check" CHECK (("parent_id" IS NULL) = ("depth" = 0)),
    ADD CONSTRAINT "categories_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "category_attributes"
    ADD CONSTRAINT "category_attributes_code_format_check" CHECK ("code" ~ '^[a-z][a-z0-9_]*$'),
    ADD CONSTRAINT "category_attributes_options_array_check" CHECK (jsonb_typeof("options") = 'array');

ALTER TABLE "brands"
    ADD CONSTRAINT "brands_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "products"
    ADD CONSTRAINT "products_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ADD CONSTRAINT "products_order_quantities_check" CHECK (
        "min_order_quantity" >= 1
        AND "wholesale_min_order_quantity" >= 1
        AND ("max_order_quantity" IS NULL OR "max_order_quantity" >= "min_order_quantity")
    ),
    ADD CONSTRAINT "products_specifications_array_check" CHECK (jsonb_typeof("specifications") = 'array'),
    ADD CONSTRAINT "products_attribute_values_object_check" CHECK (jsonb_typeof("attribute_values") = 'object'),
    ADD CONSTRAINT "products_submitted_check" CHECK ("status" <> 'PENDING_APPROVAL' OR "submitted_at" IS NOT NULL),
    ADD CONSTRAINT "products_approved_check" CHECK ("status" <> 'ACTIVE' OR "approved_at" IS NOT NULL),
    ADD CONSTRAINT "products_archived_check" CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "product_options"
    ADD CONSTRAINT "product_options_position_check" CHECK ("position" BETWEEN 0 AND 2);

ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_prices_check" CHECK (
        "regular_price" > 0
        AND ("sale_price" IS NULL OR ("sale_price" > 0 AND "sale_price" < "regular_price"))
    ),
    ADD CONSTRAINT "product_variants_sale_window_check" CHECK (
        "sale_starts_at" IS NULL OR "sale_ends_at" IS NULL OR "sale_starts_at" < "sale_ends_at"
    ),
    ADD CONSTRAINT "product_variants_measures_check" CHECK (
        ("weight_grams" IS NULL OR "weight_grams" > 0)
        AND ("length_cm" IS NULL OR "length_cm" > 0)
        AND ("width_cm" IS NULL OR "width_cm" > 0)
        AND ("height_cm" IS NULL OR "height_cm" > 0)
    ),
    ADD CONSTRAINT "product_variants_sku_format_check" CHECK ("sku" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$');

ALTER TABLE "product_images"
    ADD CONSTRAINT "product_images_dimensions_check" CHECK ("width" > 0 AND "height" > 0);

ALTER TABLE "price_tiers"
    ADD CONSTRAINT "price_tiers_values_check" CHECK ("min_quantity" >= 1 AND "unit_price" > 0),
    ADD CONSTRAINT "price_tiers_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");

ALTER TABLE "customer_prices"
    ADD CONSTRAINT "customer_prices_values_check" CHECK ("min_quantity" >= 1 AND "unit_price" > 0),
    ADD CONSTRAINT "customer_prices_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at");

ALTER TABLE "warehouses"
    ADD CONSTRAINT "warehouses_code_format_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]*$'),
    ADD CONSTRAINT "warehouses_postal_code_check" CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{4}$'),
    ADD CONSTRAINT "warehouses_phone_e164_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');

-- One default warehouse per seller.
CREATE UNIQUE INDEX "warehouses_one_default_per_seller" ON "warehouses"("seller_id") WHERE "is_default";

-- Stock can never be negative, and reservations can never exceed what is on hand:
-- available = quantity_on_hand - reserved_quantity >= 0, enforced even under concurrency.
ALTER TABLE "stock_levels"
    ADD CONSTRAINT "stock_levels_quantities_check" CHECK (
        "quantity_on_hand" >= 0 AND "reserved_quantity" >= 0 AND "damaged_quantity" >= 0
    ),
    ADD CONSTRAINT "stock_levels_available_check" CHECK ("reserved_quantity" <= "quantity_on_hand"),
    ADD CONSTRAINT "stock_levels_threshold_check" CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);

ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_change_check" CHECK ("quantity_change" <> 0 OR "damaged_change" <> 0),
    ADD CONSTRAINT "inventory_movements_after_check" CHECK (
        "on_hand_after" >= 0 AND "reserved_after" >= 0 AND "damaged_after" >= 0
        AND "reserved_after" <= "on_hand_after"
    );

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_distinct_warehouses_check" CHECK ("from_warehouse_id" <> "to_warehouse_id");

ALTER TABLE "stock_transfer_items"
    ADD CONSTRAINT "stock_transfer_items_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "stock_reservations"
    ADD CONSTRAINT "stock_reservations_quantity_check" CHECK ("quantity" > 0),
    ADD CONSTRAINT "stock_reservations_state_check" CHECK (
        ("status" = 'ACTIVE' AND "released_at" IS NULL AND "converted_at" IS NULL)
        OR ("status" = 'CONVERTED' AND "converted_at" IS NOT NULL)
        OR ("status" IN ('RELEASED', 'EXPIRED') AND "released_at" IS NOT NULL)
    );

-- The inventory ledger is append-only, like the audit log.
CREATE FUNCTION "inventory_movements_prevent_mutation"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'inventory_movements is append-only';
END;
$$;

CREATE TRIGGER "inventory_movements_append_only"
    BEFORE UPDATE OR DELETE ON "inventory_movements"
    FOR EACH ROW EXECUTE FUNCTION "inventory_movements_prevent_mutation"();

CREATE TRIGGER "inventory_movements_no_truncate"
    BEFORE TRUNCATE ON "inventory_movements"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventory_movements_prevent_mutation"();
