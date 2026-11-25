import {
  BANNER_PLACEMENTS,
  LOCATION_LEVELS,
  MAX_LINE_QUANTITY,
  PROMOTION_STATUSES,
  REVIEW_STATUSES,
  SEARCH_SORTS,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { decimalStringSchema, paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';
import {
  priceQuoteLineSchema,
  productImageSchema,
  productOptionSchema,
  specificationSchema,
} from './catalog';
import { phMobileSchema } from './identity';

/**
 * Contracts for the storefront (Phase 4): locations, addresses, search, home page, product
 * pages, reviews, wishlist and cart. Money crosses the API as decimal strings.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const psgcCodeSchema = z.string().regex(/^\d{10}$/, 'Choose a location');
const quantitySchema = z.coerce
  .number()
  .int('Whole numbers only')
  .min(1, 'At least 1')
  .max(MAX_LINE_QUANTITY, `At most ${MAX_LINE_QUANTITY}`);

// ---- Locations (PSGC) -------------------------------------------------------------------

export const locationLevelSchema = z.enum(LOCATION_LEVELS);
export const locationSchema = z.object({
  code: z.string(),
  name: z.string(),
  level: locationLevelSchema,
});
export type LocationDto = z.infer<typeof locationSchema>;

/**
 * GET /locations: regions (no parent), or the next step of an address under `parentCode`:
 *  - under a region: its provinces and the cities that belong to no province;
 *  - under a province: its cities and municipalities;
 *  - under a city or municipality: its barangays (Manila's districts included).
 */
export const locationListQuerySchema = z.object({ parentCode: psgcCodeSchema.optional() });
export const locationListSchema = z.object({ items: z.array(locationSchema) });
export type LocationList = z.infer<typeof locationListSchema>;

// ---- Addresses --------------------------------------------------------------------------

export const addressInputSchema = z.object({
  label: optionalText(40),
  recipientName: z.string().trim().min(2, 'Enter the recipient’s name').max(120),
  mobile: phMobileSchema,
  regionCode: psgcCodeSchema,
  /** Null in Metro Manila and for independent cities. */
  provinceCode: psgcCodeSchema.nullable().optional(),
  cityCode: psgcCodeSchema,
  barangayCode: psgcCodeSchema,
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Enter the 4-digit postal code'),
  streetAddress: z
    .string()
    .trim()
    .min(3, 'Enter the house number and street')
    .max(200, 'At most 200 characters'),
  addressLine2: optionalText(200),
  isDefault: z.boolean().optional(),
});
export type AddressInput = z.input<typeof addressInputSchema>;

export const customerAddressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  recipientName: z.string(),
  mobile: z.string(),
  region: locationSchema,
  province: locationSchema.nullable(),
  city: locationSchema,
  barangay: locationSchema,
  postalCode: z.string(),
  streetAddress: z.string(),
  addressLine2: z.string().nullable(),
  isDefault: z.boolean(),
  /** One line for display: street, barangay, city, province, postal code. */
  formatted: z.string(),
  createdAt: z.iso.datetime(),
});
export type AddressDto = z.infer<typeof customerAddressSchema>;
export const customerAddressListSchema = z.object({ items: z.array(customerAddressSchema) });
export type AddressList = z.infer<typeof customerAddressListSchema>;

// ---- Product cards and search ------------------------------------------------------------

export const flashSaleBadgeSchema = z.object({
  itemId: z.uuid(),
  price: z.string(),
  endsAt: z.iso.datetime(),
  remaining: z.number().int(),
  quantityLimit: z.number().int(),
});

export const productCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  storeName: z.string(),
  storeSlug: z.string(),
  brandName: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  currency: z.string(),
  /** Lowest current retail price (sale or flash price when one is running). */
  fromPrice: z.string(),
  regularFromPrice: z.string(),
  wholesaleAvailable: z.boolean(),
  ratingAverage: z.number(),
  ratingCount: z.number().int(),
  soldCount: z.number().int(),
  inStock: z.boolean(),
  flashSale: flashSaleBadgeSchema.nullable(),
});
export type ProductCard = z.infer<typeof productCardSchema>;

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const commaList = z
  .string()
  .trim()
  .transform((v) => v.split(',').filter(Boolean))
  .pipe(z.array(z.uuid()).max(20))
  .optional();

export const searchSortSchema = z.enum(SEARCH_SORTS);

/** GET /catalog/products: keyword search and filters. */
export const productSearchQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  q: z.string().trim().max(100).optional(),
  /** A category (its subcategories included): id or link name. */
  categoryId: z.uuid().optional(),
  category: z.string().trim().max(100).optional(),
  storeId: z.uuid().optional(),
  sellerId: z.uuid().optional(),
  brandIds: commaList,
  minPrice: decimalStringSchema().optional(),
  maxPrice: decimalStringSchema().optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  inStock: booleanQuery,
  /** Only products with wholesale prices. */
  wholesale: booleanQuery,
  sort: searchSortSchema.default('relevance'),
});
export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;
export type ProductSearchQueryInput = z.input<typeof productSearchQuerySchema>;

export const searchFacetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  count: z.number().int(),
});
export const productSearchResultSchema = paginatedSchema(productCardSchema).extend({
  facets: z.object({
    categories: z.array(searchFacetSchema.extend({ slug: z.string() })),
    brands: z.array(searchFacetSchema),
    stores: z.array(searchFacetSchema.extend({ slug: z.string() })),
    priceRange: z.object({ min: z.string(), max: z.string() }).nullable(),
  }),
  /** Which search engine answered (e.g. "postgres"); for diagnostics. */
  engine: z.string(),
});
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;

export const searchSuggestionSchema = z.object({
  products: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
  categories: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
  stores: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
});
export type SearchSuggestions = z.infer<typeof searchSuggestionSchema>;

// ---- Product page ------------------------------------------------------------------------

export const storefrontProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  store: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    logoUrl: z.string().nullable(),
    city: z.string().nullable(),
    province: z.string().nullable(),
  }),
  category: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    path: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
  }),
  brand: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  specifications: z.array(specificationSchema),
  attributes: z.array(z.object({ name: z.string(), value: z.string() })),
  images: z.array(productImageSchema),
  options: z.array(productOptionSchema),
  variants: z.array(
    z.object({
      id: z.uuid(),
      sku: z.string(),
      title: z.string(),
      options: z.record(z.string(), z.string()),
      /** Units available now; null when the seller does not track stock. */
      availableQuantity: z.number().int().nullable(),
      available: z.boolean(),
      weightGrams: z.number().int().nullable(),
    }),
  ),
  /** Prices for the person asking (retail, flash, wholesale or agreed), at the minimum quantity. */
  prices: z.array(priceQuoteLineSchema),
  minOrderQuantity: z.number().int(),
  maxOrderQuantity: z.number().int().nullable(),
  /** Wholesale tiers shown to everyone; they apply to approved wholesale accounts. */
  wholesale: z
    .object({
      minOrderQuantity: z.number().int(),
      tiers: z.array(
        z.object({
          variantId: z.uuid().nullable(),
          minQuantity: z.number().int(),
          unitPrice: z.string(),
        }),
      ),
    })
    .nullable(),
  /** Whether the person asking gets wholesale prices. */
  buyerIsWholesale: z.boolean(),
  ratingAverage: z.number(),
  ratingCount: z.number().int(),
  /** Count of published reviews per star, 5 to 1. */
  ratingBreakdown: z.array(z.object({ rating: z.number().int(), count: z.number().int() })),
  soldCount: z.number().int(),
  wishlisted: z.boolean(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
});
export type StorefrontProduct = z.infer<typeof storefrontProductSchema>;

// ---- Reviews ----------------------------------------------------------------------------

export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

export const reviewSchema = z.object({
  id: z.uuid(),
  rating: z.number().int(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  /** First name and last initial, e.g. "Juan D." */
  authorName: z.string(),
  variantTitle: z.string(),
  createdAt: z.iso.datetime(),
});
export type ReviewDto = z.infer<typeof reviewSchema>;
export const reviewListSchema = paginatedSchema(reviewSchema);
export type ReviewList = z.infer<typeof reviewListSchema>;
export const reviewListQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

export const createReviewSchema = z.object({
  orderItemId: z.uuid(),
  rating: z.coerce.number().int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars'),
  title: optionalText(120),
  body: optionalText(4000),
});
export type CreateReviewRequest = z.input<typeof createReviewSchema>;
export const updateReviewSchema = createReviewSchema.omit({ orderItemId: true });
export type UpdateReviewRequest = z.input<typeof updateReviewSchema>;

/** The customer's own reviews and the purchased items still waiting for one. */
export const myReviewsSchema = z.object({
  reviews: z.array(
    reviewSchema.extend({
      status: reviewStatusSchema,
      product: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
      orderItemId: z.uuid(),
      imageUrl: z.string().nullable(),
    }),
  ),
  toReview: z.array(
    z.object({
      orderItemId: z.uuid(),
      orderNumber: z.string(),
      product: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
      variantTitle: z.string(),
      imageUrl: z.string().nullable(),
      orderedAt: z.iso.datetime(),
    }),
  ),
});
export type MyReviews = z.infer<typeof myReviewsSchema>;

/** Staff moderation list. */
export const adminReviewSchema = reviewSchema.extend({
  status: reviewStatusSchema,
  moderationNote: z.string().nullable(),
  product: z.object({ id: z.uuid(), name: z.string() }),
  store: z.object({ id: z.uuid(), name: z.string() }),
  customerEmail: z.string(),
});
export type AdminReviewDto = z.infer<typeof adminReviewSchema>;
export const adminReviewListSchema = paginatedSchema(adminReviewSchema);
export type AdminReviewList = z.infer<typeof adminReviewListSchema>;
export const adminReviewListQuerySchema = paginationQuerySchema.extend({
  status: reviewStatusSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  search: z.string().trim().max(100).optional(),
});
export const moderateReviewSchema = z.object({
  status: reviewStatusSchema,
  note: optionalText(500),
});
export type ModerateReviewRequest = z.input<typeof moderateReviewSchema>;

// ---- Wishlist ---------------------------------------------------------------------------

export const wishlistSchema = z.object({ items: z.array(productCardSchema) });
export type Wishlist = z.infer<typeof wishlistSchema>;

// ---- Cart -------------------------------------------------------------------------------

export const cartLineInputSchema = z.object({
  variantId: z.uuid(),
  quantity: quantitySchema,
  savedForLater: z.boolean().optional(),
});
export type CartLineInput = z.input<typeof cartLineInputSchema>;

export const updateCartLineSchema = z
  .object({ quantity: quantitySchema, savedForLater: z.boolean() })
  .partial()
  .refine((v) => v.quantity !== undefined || v.savedForLater !== undefined, {
    message: 'Change the quantity or move the item',
  });
export type UpdateCartLineRequest = z.input<typeof updateCartLineSchema>;

/** A guest's cart, kept in the browser and priced by the server (POST /cart/preview, /merge). */
export const guestCartSchema = z.object({ items: z.array(cartLineInputSchema).max(100) });
export type GuestCartRequest = z.input<typeof guestCartSchema>;

export const cartLineSchema = z.object({
  /** Cart item id; for a guest cart, the variant id. */
  id: z.string(),
  variantId: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  productSlug: z.string(),
  variantTitle: z.string(),
  options: z.record(z.string(), z.string()),
  imageUrl: z.string().nullable(),
  quantity: z.number().int(),
  savedForLater: z.boolean(),
  /** Priced now by the server; null when the item cannot be bought. */
  price: priceQuoteLineSchema.nullable(),
  /** The previous price when it changed since the customer last saw it. */
  previousUnitPrice: z.string().nullable(),
  availableQuantity: z.number().int().nullable(),
  /** Why the line cannot be checked out as it is (null when it can). */
  problem: z.string().nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSchema = z.object({
  /** Lines to buy, grouped by seller. */
  groups: z.array(
    z.object({
      sellerId: z.uuid(),
      store: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
      lines: z.array(cartLineSchema),
      subtotal: z.string(),
    }),
  ),
  saved: z.array(cartLineSchema),
  itemCount: z.number().int(),
  subtotal: z.string(),
  wholesaleSavings: z.string(),
  currency: z.string(),
  buyerIsWholesale: z.boolean(),
  /** True when every line can be checked out. */
  ready: z.boolean(),
});
export type CartDto = z.infer<typeof cartSchema>;

// ---- Home page --------------------------------------------------------------------------

export const bannerPlacementSchema = z.enum(BANNER_PLACEMENTS);
export const promotionStatusSchema = z.enum(PROMOTION_STATUSES);

export const bannerSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  subtitle: z.string().nullable(),
  imageUrl: z.string(),
  linkUrl: z.string().nullable(),
  placement: bannerPlacementSchema,
});
export type BannerDto = z.infer<typeof bannerSchema>;

export const storeCardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  productCount: z.number().int(),
});
export type StoreCard = z.infer<typeof storeCardSchema>;

export const homeCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  imageUrl: z.string().nullable(),
  children: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
});

export const homePageSchema = z.object({
  heroBanners: z.array(bannerSchema),
  promoBanners: z.array(bannerSchema),
  categories: z.array(homeCategorySchema),
  flashSale: z
    .object({
      id: z.uuid(),
      title: z.string(),
      endsAt: z.iso.datetime(),
      products: z.array(productCardSchema),
    })
    .nullable(),
  featuredProducts: z.array(productCardSchema),
  bestSellers: z.array(productCardSchema),
  /** For signed-in customers: based on what they bought, saved and carted; otherwise top rated. */
  recommended: z.array(productCardSchema),
  featuredStores: z.array(storeCardSchema),
});
export type HomePage = z.infer<typeof homePageSchema>;

// ---- Home page administration ------------------------------------------------------------

const optionalDate = z.iso.datetime({ offset: true }).nullable().optional();

export const bannerAdminSchema = bannerSchema.extend({
  position: z.number().int(),
  status: promotionStatusSchema,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type BannerAdminDto = z.infer<typeof bannerAdminSchema>;
export const bannerAdminListSchema = z.object({ items: z.array(bannerAdminSchema) });

/** Multipart fields of POST /storefront/banners (the image is the `file` part). */
export const bannerInputSchema = z.object({
  title: z.string().trim().min(2, 'Enter a title').max(120),
  subtitle: optionalText(200),
  linkUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/[^/]/, 'A path inside the store, e.g. /c/laptops')
    .or(z.literal('').transform(() => null))
    .nullable()
    .optional(),
  placement: bannerPlacementSchema.default('HERO'),
  status: promotionStatusSchema.default('ACTIVE'),
  position: z.coerce.number().int().min(0).max(1000).default(0),
  startsAt: optionalDate.or(z.literal('').transform(() => null)),
  endsAt: optionalDate.or(z.literal('').transform(() => null)),
});
export type BannerInput = z.input<typeof bannerInputSchema>;
export const updateBannerSchema = bannerInputSchema.partial();
export type UpdateBannerRequest = z.input<typeof updateBannerSchema>;

export const featuredItemsSchema = z.object({
  products: z.array(
    z.object({
      id: z.uuid(),
      productId: z.uuid(),
      name: z.string(),
      storeName: z.string(),
      position: z.number().int(),
      visible: z.boolean(),
    }),
  ),
  stores: z.array(
    z.object({ id: z.uuid(), storeId: z.uuid(), name: z.string(), position: z.number().int() }),
  ),
});
export type FeaturedItems = z.infer<typeof featuredItemsSchema>;
export const putFeaturedProductsSchema = z.object({ productIds: z.array(z.uuid()).max(24) });
export const putFeaturedStoresSchema = z.object({ storeIds: z.array(z.uuid()).max(12) });
