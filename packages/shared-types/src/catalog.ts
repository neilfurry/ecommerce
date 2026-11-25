/** Catalog, pricing and inventory constants shared by the API and the frontends (Phase 3). */

export const CATEGORY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];
/** Top level is depth 0; categories can be nested three levels deep. */
export const MAX_CATEGORY_DEPTH = 2;

export const CATEGORY_ATTRIBUTE_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT'] as const;
export type CategoryAttributeType = (typeof CATEGORY_ATTRIBUTE_TYPES)[number];

export const BRAND_STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE'] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];
export const BRAND_STATUS_LABELS: Record<BrandStatus, string> = {
  PENDING: 'Requested',
  ACTIVE: 'Active',
  REJECTED: 'Rejected',
  INACTIVE: 'Retired',
};

export const PRODUCT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'INACTIVE',
  'ARCHIVED',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  ACTIVE: 'Active',
  REJECTED: 'Rejected',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};

export const PRODUCT_EVENT_TYPES = [
  'CREATED',
  'SUBMITTED',
  'CHANGED_AFTER_APPROVAL',
  'APPROVED',
  'REJECTED',
  'DEACTIVATED',
  'ACTIVATED',
  'TAKEN_DOWN',
  'ARCHIVED',
  'RESTORED',
] as const;
export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

/**
 * Product fields whose change sends an approved product back to review (decision of
 * 2026-11-25: content changes need re-approval; prices and stock do not).
 */
export const PRODUCT_CONTENT_FIELDS = [
  'name',
  'description',
  'categoryId',
  'brandId',
  'specifications',
  'attributeValues',
  'images',
  'options',
] as const;

export const VARIANT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

/** Common variation axes offered in the product editor; sellers can type their own. */
export const SUGGESTED_OPTION_NAMES = ['Size', 'Color', 'Model', 'Material', 'Weight'] as const;
export const MAX_PRODUCT_OPTIONS = 3;
export const MAX_OPTION_VALUES = 30;
export const MAX_VARIANTS_PER_PRODUCT = 100;
export const MAX_PRODUCT_IMAGES = 10;
/** Image processing: the stored photo's longest side and the thumbnail's longest side. */
export const PRODUCT_IMAGE_MAX_EDGE = 1600;
export const PRODUCT_IMAGE_THUMBNAIL_EDGE = 400;
export const PRODUCT_IMAGE_MIN_EDGE = 200;
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Accepted uploads, checked by extension and by the file's content. */
export const PRODUCT_IMAGE_TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
} as const;

// ---- Pricing ----------------------------------------------------------------------

/** Where a calculated unit price came from (stored with order items as part of the snapshot). */
export const PRICE_SOURCES = ['REGULAR', 'SALE', 'WHOLESALE_TIER', 'CUSTOMER_PRICE'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  REGULAR: 'Regular price',
  SALE: 'Sale price',
  WHOLESALE_TIER: 'Wholesale price',
  CUSTOMER_PRICE: 'Your agreed price',
};
export const MAX_PRICE_TIERS = 10;

// ---- Inventory --------------------------------------------------------------------

export const WAREHOUSE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];
export const MAX_WAREHOUSES_PER_SELLER = 20;

export const INVENTORY_MOVEMENT_TYPES = [
  'STOCK_IN',
  'STOCK_OUT',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'DAMAGED',
  'DAMAGED_WRITE_OFF',
  'RETURN_RESTOCK',
  'RETURN_DAMAGED',
  'SALE',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
export const INVENTORY_MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  STOCK_IN: 'Stock in',
  STOCK_OUT: 'Stock out',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  DAMAGED: 'Marked damaged',
  DAMAGED_WRITE_OFF: 'Damaged written off',
  RETURN_RESTOCK: 'Return restocked',
  RETURN_DAMAGED: 'Return (damaged)',
  SALE: 'Sold',
};
/** Movements a seller records by hand (transfers and sales come from their own flows). */
export const MANUAL_MOVEMENT_TYPES = [
  'STOCK_IN',
  'STOCK_OUT',
  'ADJUSTMENT',
  'DAMAGED',
  'DAMAGED_WRITE_OFF',
  'RETURN_RESTOCK',
  'RETURN_DAMAGED',
] as const satisfies readonly InventoryMovementType[];
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const STOCK_RESERVATION_STATUSES = ['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED'] as const;
export type StockReservationStatus = (typeof STOCK_RESERVATION_STATUSES)[number];
/** How long a checkout holds stock unless the caller asks for less. */
export const DEFAULT_RESERVATION_TTL_MINUTES = 15;
export const MAX_RESERVATION_TTL_MINUTES = 60;
