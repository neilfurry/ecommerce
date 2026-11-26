/**
 * Storefront, cart and checkout constants (Phase 4), shared by the API and the apps.
 */

export const LOCATION_LEVELS = [
  'REGION',
  'PROVINCE',
  'CITY',
  'MUNICIPALITY',
  'SUB_MUNICIPALITY',
  'BARANGAY',
] as const;
export type LocationLevel = (typeof LOCATION_LEVELS)[number];

export const MAX_ADDRESSES = 20;
/** Distinct lines in a cart (saved-for-later lines included). */
export const MAX_CART_LINES = 100;
export const MAX_LINE_QUANTITY = 10_000;
export const MAX_WISHLIST_ITEMS = 200;

export const PAYMENT_METHODS = ['COD', 'GCASH', 'MAYA', 'CARD', 'QR_PH', 'BANK_TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  COD: 'Cash on delivery',
  GCASH: 'GCash',
  MAYA: 'Maya',
  CARD: 'Credit or debit card',
  QR_PH: 'QR Ph',
  BANK_TRANSFER: 'Bank transfer',
};
/** Methods not paid on delivery: the order waits for payment (online or bank transfer). */
export const ONLINE_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'GCASH',
  'MAYA',
  'CARD',
  'QR_PH',
  'BANK_TRANSFER',
];

export const SHIPPING_METHODS = ['STANDARD', 'EXPRESS', 'SAME_DAY'] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];
export const SHIPPING_METHOD_LABELS: Record<ShippingMethod, string> = {
  STANDARD: 'Standard delivery',
  EXPRESS: 'Express delivery',
  SAME_DAY: 'Same-day delivery',
};

export const BUYER_TYPES = ['RETAIL', 'WHOLESALE'] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export const COUPON_SCOPES = ['PLATFORM', 'SELLER'] as const;
export type CouponScope = (typeof COUPON_SCOPES)[number];
export const COUPON_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];
export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  PERCENTAGE: 'Percent off',
  FIXED_AMOUNT: 'Amount off',
  FREE_SHIPPING: 'Free shipping',
};

export const PROMOTION_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];
export const BANNER_PLACEMENTS = ['HERO', 'PROMO'] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export const REVIEW_STATUSES = ['PUBLISHED', 'HIDDEN'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const SEARCH_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
  'best_selling',
  'rating',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Best match',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  best_selling: 'Best selling',
  rating: 'Top rated',
};

/** Reservations of online-payment orders last this long by default (pay within the window). */
export const DEFAULT_PAYMENT_WINDOW_MINUTES = 60;
/** Default VAT in the Philippines (12%), included in prices. Configurable by administrators. */
export const DEFAULT_VAT_RATE = '0.12';
