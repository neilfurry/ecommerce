import {
  BRAND_STATUSES,
  CATEGORY_ATTRIBUTE_TYPES,
  CATEGORY_STATUSES,
  MAX_OPTION_VALUES,
  MAX_PRICE_TIERS,
  MAX_PRODUCT_OPTIONS,
  PRICE_SOURCES,
  PRODUCT_EVENT_TYPES,
  PRODUCT_STATUSES,
  VARIANT_STATUSES,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { currencyCodeSchema, decimalStringSchema, paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';
import { emailAddressSchema } from './identity';

/**
 * Contracts for the catalog (Phase 3): categories, brands, products, variants, images and
 * pricing. Money crosses the API as decimal strings ("1499.50"), never as numbers.
 */

// ---- Shared fields ----------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** URL name: lowercase letters, digits and single hyphens. */
export const catalogSlugSchema = (max: number) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .max(max, `At most ${max} characters`)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers and single hyphens; start and end with a letter or number',
    );

/** Turns a name into a URL name ("Rice 25 kg!" → "rice-25-kg"). */
export function slugify(value: string, max = 100): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** A positive price with up to 2 decimals (centavos), e.g. "499.00". */
export const priceSchema = decimalStringSchema({ scale: 2, precision: 13 }).refine(
  (value) => Number(value) > 0,
  'Must be more than zero',
);
const quantitySchema = z.coerce.number().int().min(1, 'At least 1').max(1_000_000);
const optionalDateTime = z.iso
  .datetime({ offset: true })
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const windowOk = (v: { startsAt?: string | null; endsAt?: string | null }) =>
  !v.startsAt || !v.endsAt || new Date(v.startsAt) < new Date(v.endsAt);
const WINDOW_MESSAGE = { message: 'The end must be after the start', path: ['endsAt'] };

// ---- Categories -------------------------------------------------------------------------

export const categoryStatusSchema = z.enum(CATEGORY_STATUSES);
export const categoryAttributeTypeSchema = z.enum(CATEGORY_ATTRIBUTE_TYPES);

export const categoryAttributeInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Lowercase letters, numbers and _; start with a letter'),
    name: z.string().trim().min(1, 'Enter a name').max(80),
    type: categoryAttributeTypeSchema,
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    unit: optionalText(20),
    isRequired: z.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine((a) => a.type !== 'SELECT' || a.options.length >= 2, {
    message: 'A choice list needs at least 2 options',
    path: ['options'],
  })
  .refine((a) => new Set(a.options.map((o) => o.toLowerCase())).size === a.options.length, {
    message: 'Options must be different',
    path: ['options'],
  });
export type CategoryAttributeInput = z.input<typeof categoryAttributeInputSchema>;

/** PUT /categories/{id}/attributes: replaces the category's own attributes. */
export const putCategoryAttributesSchema = z
  .object({ attributes: z.array(categoryAttributeInputSchema).max(40) })
  .refine((v) => new Set(v.attributes.map((a) => a.code)).size === v.attributes.length, {
    message: 'Attribute codes must be unique',
    path: ['attributes'],
  });
export type PutCategoryAttributesRequest = z.input<typeof putCategoryAttributesSchema>;

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(100),
  /** Generated from the name when omitted or blank. */
  slug: z.union([z.literal('').transform(() => undefined), catalogSlugSchema(100)]).optional(),
  parentId: z.uuid().nullable().optional(),
  description: optionalText(2000),
  status: categoryStatusSchema.default('ACTIVE'),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type CreateCategoryRequest = z.input<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema
  .omit({ parentId: true })
  .extend({ status: categoryStatusSchema, sortOrder: z.coerce.number().int().min(0).max(10_000) })
  .partial();
export type UpdateCategoryRequest = z.input<typeof updateCategorySchema>;

export const categoryAttributeSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: categoryAttributeTypeSchema,
  options: z.array(z.string()),
  unit: z.string().nullable(),
  isRequired: z.boolean(),
  sortOrder: z.number().int(),
});
export type CategoryAttributeDto = z.infer<typeof categoryAttributeSchema>;

export const categorySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  status: categoryStatusSchema,
  sortOrder: z.number().int(),
  depth: z.number().int(),
  /** Names from the top level down to this category. */
  path: z.array(z.string()),
  childCount: z.number().int(),
  productCount: z.number().int(),
  /** This category's own attributes. */
  attributes: z.array(categoryAttributeSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CategoryDto = z.infer<typeof categorySchema>;

/** Every category, parents before children, ordered by sort order then name. */
export const categoryListSchema = z.object({ categories: z.array(categorySchema) });
export type CategoryList = z.infer<typeof categoryListSchema>;

/** Attributes a product in this category fills in (its own plus every ancestor's). */
export const categoryAttributesSchema = z.object({
  categoryId: z.uuid(),
  attributes: z.array(categoryAttributeSchema),
});
export type CategoryAttributes = z.infer<typeof categoryAttributesSchema>;

// ---- Brands -----------------------------------------------------------------------------

export const brandStatusSchema = z.enum(BRAND_STATUSES);

export const createBrandSchema = z.object({
  name: z.string().trim().min(1, 'Enter the brand name').max(100),
  description: optionalText(1000),
});
export type CreateBrandRequest = z.input<typeof createBrandSchema>;

export const updateBrandSchema = createBrandSchema
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial();
export type UpdateBrandRequest = z.input<typeof updateBrandSchema>;

export const reviewBrandSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), note: optionalText(1000) })
  .refine((v) => v.decision === 'APPROVE' || !!v.note, {
    message: 'Explain why the brand is rejected',
    path: ['note'],
  });
export type ReviewBrandRequest = z.input<typeof reviewBrandSchema>;

export const brandSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: brandStatusSchema,
  requestedBy: z.object({ sellerId: z.uuid(), businessName: z.string() }).nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  productCount: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type BrandDto = z.infer<typeof brandSchema>;
export const brandListSchema = paginatedSchema(brandSchema);
export type BrandList = z.infer<typeof brandListSchema>;

export const brandListQuerySchema = paginationQuerySchema.extend({
  status: brandStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
});
export type BrandListQuery = z.infer<typeof brandListQuerySchema>;

// ---- Products ---------------------------------------------------------------------------

export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export const variantStatusSchema = z.enum(VARIANT_STATUSES);

export const skuSchema = z
  .string()
  .trim()
  .min(1, 'Enter a SKU')
  .max(64, 'At most 64 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, numbers, ".", "_" and "-" only');

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{4,64}$/, 'Letters, numbers and "-", 4–64 characters');

export const specificationSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  value: z.string().trim().min(1, 'Enter a value').max(500),
});
export type Specification = z.infer<typeof specificationSchema>;

export const attributeValuesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  z.union([z.string().trim().max(200), z.number(), z.boolean()]),
);

const seoShape = {
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
  seoKeywords: optionalText(255),
};

const productContentShape = {
  name: z.string().trim().min(3, 'Enter at least 3 characters').max(200),
  description: optionalText(20_000),
  categoryId: z.uuid('Choose a category'),
  brandId: z.uuid().nullable().optional(),
  specifications: z.array(specificationSchema).max(50).default([]),
  attributeValues: attributeValuesSchema.default({}),
};

/** POST /products. Creates a DRAFT with one default variant (options come later). */
export const createProductSchema = z.object({
  storeId: z.uuid('Choose a store'),
  ...productContentShape,
  slug: z.union([z.literal('').transform(() => undefined), catalogSlugSchema(220)]).optional(),
  ...seoShape,
  sku: skuSchema,
  regularPrice: priceSchema,
});
export type CreateProductRequest = z.input<typeof createProductSchema>;

/** PATCH /products/{id}. Changing content of an approved product sends it back to review. */
export const updateProductSchema = z
  .object({
    ...productContentShape,
    specifications: z.array(specificationSchema).max(50),
    attributeValues: attributeValuesSchema,
    slug: catalogSlugSchema(220),
    storeId: z.uuid(),
    ...seoShape,
  })
  .partial();
export type UpdateProductRequest = z.input<typeof updateProductSchema>;

/**
 * The Seller Center details form: optional category attributes the seller has not filled in
 * are `undefined` (or '') in the form and are dropped before the PATCH is sent.
 */
export const productDetailsFormSchema = updateProductSchema.extend({
  attributeValues: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z.union([z.string().trim().max(200), z.number(), z.boolean(), z.undefined()]),
    )
    .optional(),
});

/** PUT /products/{id}/pricing: product-level pricing configuration. */
export const productPricingSchema = z
  .object({
    currency: currencyCodeSchema.default('PHP'),
    minOrderQuantity: quantitySchema,
    maxOrderQuantity: quantitySchema.nullable().optional(),
    wholesaleEnabled: z.boolean(),
    wholesaleMinOrderQuantity: quantitySchema,
  })
  .refine(
    (v) =>
      v.maxOrderQuantity === null ||
      v.maxOrderQuantity === undefined ||
      v.maxOrderQuantity >= v.minOrderQuantity,
    {
      message: 'Must be at least the minimum order quantity',
      path: ['maxOrderQuantity'],
    },
  );
export type ProductPricingRequest = z.input<typeof productPricingSchema>;

export const productOptionInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name, e.g. Size').max(40),
  values: z
    .array(z.string().trim().min(1, 'Enter a value').max(60))
    .min(1, 'Add at least one value')
    .max(MAX_OPTION_VALUES)
    .refine((values) => new Set(values.map((v) => v.toLowerCase())).size === values.length, {
      message: 'Values must be different',
    }),
});

/**
 * PUT /products/{id}/options: sets the variation axes (e.g. Size × Color) and creates a
 * variant for every combination that does not exist yet, priced and SKU'd from `generate`.
 * Variants whose combination no longer exists are deleted (or refused when they have stock).
 */
export const setProductOptionsSchema = z
  .object({
    options: z.array(productOptionInputSchema).max(MAX_PRODUCT_OPTIONS),
    generate: z.object({
      /** Each new variant's SKU is the prefix plus its values, e.g. "TSHIRT-RED-L". */
      skuPrefix: z
        .string()
        .trim()
        .min(1, 'Enter a SKU prefix')
        .max(30)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Letters, numbers, ".", "_" and "-" only'),
      regularPrice: priceSchema,
    }),
  })
  .refine((v) => new Set(v.options.map((o) => o.name.toLowerCase())).size === v.options.length, {
    message: 'Option names must be different',
    path: ['options'],
  });
export type SetProductOptionsRequest = z.input<typeof setProductOptionsSchema>;

const dimension = decimalStringSchema({ scale: 2, precision: 6 })
  .refine((v) => Number(v) > 0, 'Must be more than zero')
  .nullable()
  .optional();

/** PATCH /products/{id}/variants/{variantId}. Price fields need seller.pricing.manage. */
export const updateVariantSchema = z
  .object({
    sku: skuSchema,
    barcode: barcodeSchema.nullable(),
    regularPrice: priceSchema,
    salePrice: priceSchema.nullable(),
    saleStartsAt: optionalDateTime,
    saleEndsAt: optionalDateTime,
    trackInventory: z.boolean(),
    weightGrams: z.coerce.number().int().min(1).max(1_000_000).nullable(),
    lengthCm: dimension,
    widthCm: dimension,
    heightCm: dimension,
    status: variantStatusSchema,
  })
  .partial()
  .refine((v) => windowOk({ startsAt: v.saleStartsAt, endsAt: v.saleEndsAt }), {
    message: 'The sale must end after it starts',
    path: ['saleEndsAt'],
  });
export type UpdateVariantRequest = z.input<typeof updateVariantSchema>;
export const VARIANT_PRICE_FIELDS = [
  'regularPrice',
  'salePrice',
  'saleStartsAt',
  'saleEndsAt',
] as const;

export const reviewProductSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), note: optionalText(1000) })
  .refine((v) => v.decision === 'APPROVE' || !!v.note, {
    message: 'Tell the seller what to fix',
    path: ['note'],
  });
export type ReviewProductRequest = z.input<typeof reviewProductSchema>;

export const productReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Explain the reason (at least 5 characters)').max(1000),
});

export const productImageSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid().nullable(),
  url: z.string(),
  thumbnailUrl: z.string(),
  altText: z.string().nullable(),
  position: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
});
export type ProductImageDto = z.infer<typeof productImageSchema>;

export const updateProductImageSchema = z
  .object({ altText: optionalText(200), variantId: z.uuid().nullable() })
  .partial();
export const reorderProductImagesSchema = z.object({
  imageIds: z.array(z.uuid()).min(1).max(50),
});

export const productOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
  values: z.array(z.object({ id: z.uuid(), value: z.string(), position: z.number().int() })),
});

export const variantSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  barcode: z.string().nullable(),
  title: z.string(),
  /** Option name → value, e.g. { Size: "L", Color: "Red" }. */
  options: z.record(z.string(), z.string()),
  regularPrice: z.string(),
  salePrice: z.string().nullable(),
  saleStartsAt: z.iso.datetime().nullable(),
  saleEndsAt: z.iso.datetime().nullable(),
  trackInventory: z.boolean(),
  weightGrams: z.number().int().nullable(),
  lengthCm: z.string().nullable(),
  widthCm: z.string().nullable(),
  heightCm: z.string().nullable(),
  status: variantStatusSchema,
  position: z.number().int(),
  stock: z.object({
    onHand: z.number().int(),
    reserved: z.number().int(),
    available: z.number().int(),
  }),
});
export type VariantDto = z.infer<typeof variantSchema>;

export const priceTierSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid().nullable(),
  minQuantity: z.number().int(),
  unitPrice: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
});
export type PriceTierDto = z.infer<typeof priceTierSchema>;

export const productEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(PRODUCT_EVENT_TYPES),
  fromStatus: productStatusSchema.nullable(),
  toStatus: productStatusSchema.nullable(),
  note: z.string().nullable(),
  actor: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProductEventDto = z.infer<typeof productEventSchema>;

export const productSummarySchema = z.object({
  id: z.uuid(),
  sellerId: z.uuid(),
  sellerName: z.string(),
  storeId: z.uuid(),
  storeName: z.string(),
  storeSlug: z.string(),
  name: z.string(),
  slug: z.string(),
  status: productStatusSchema,
  category: z.object({ id: z.uuid(), name: z.string(), path: z.array(z.string()) }),
  brand: z.object({ id: z.uuid(), name: z.string(), status: brandStatusSchema }).nullable(),
  thumbnailUrl: z.string().nullable(),
  currency: z.string(),
  /** Lowest and highest regular price of the active variants. */
  priceRange: z.object({ min: z.string(), max: z.string() }).nullable(),
  variantCount: z.number().int(),
  totalAvailable: z.number().int(),
  wholesaleEnabled: z.boolean(),
  submittedAt: z.iso.datetime().nullable(),
  /** Set while the marketplace has taken the product down. */
  takenDown: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;
export const productListSchema = paginatedSchema(productSummarySchema);
export type ProductList = z.infer<typeof productListSchema>;

export const productDetailSchema = productSummarySchema.extend({
  description: z.string().nullable(),
  specifications: z.array(specificationSchema),
  attributeValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  categoryAttributes: z.array(categoryAttributeSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  seoKeywords: z.string().nullable(),
  minOrderQuantity: z.number().int(),
  maxOrderQuantity: z.number().int().nullable(),
  wholesaleMinOrderQuantity: z.number().int(),
  reviewNote: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  options: z.array(productOptionSchema),
  variants: z.array(variantSchema),
  images: z.array(productImageSchema),
  priceTiers: z.array(priceTierSchema),
  events: z.array(productEventSchema),
  /** What still blocks submitting for approval (empty when ready). */
  missingForSubmission: z.array(z.string()),
  createdAt: z.iso.datetime(),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productListQuerySchema = paginationQuerySchema.extend({
  status: productStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  storeId: z.uuid().optional(),
  sellerId: z.uuid().optional(),
  brandId: z.uuid().optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

// ---- Pricing ----------------------------------------------------------------------------

export const priceTierInputSchema = z
  .object({
    /** Null: applies to every variant without tiers of its own. */
    variantId: z.uuid().nullable().default(null),
    minQuantity: quantitySchema,
    unitPrice: priceSchema,
    startsAt: optionalDateTime,
    endsAt: optionalDateTime,
  })
  .refine(windowOk, WINDOW_MESSAGE);

/** PUT /products/{id}/price-tiers: replaces the product's wholesale tiers. */
export const putPriceTiersSchema = z.object({
  tiers: z.array(priceTierInputSchema).max(MAX_PRICE_TIERS * 10),
});
export type PutPriceTiersRequest = z.input<typeof putPriceTiersSchema>;

export const customerPriceInputSchema = z
  .object({
    customerEmail: emailAddressSchema,
    variantId: z.uuid().nullable().default(null),
    minQuantity: quantitySchema.default(1),
    unitPrice: priceSchema,
    startsAt: optionalDateTime,
    endsAt: optionalDateTime,
    note: optionalText(500),
  })
  .refine(windowOk, WINDOW_MESSAGE);
export type CustomerPriceInput = z.input<typeof customerPriceInputSchema>;

export const customerPriceSchema = z.object({
  id: z.uuid(),
  customer: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  variantId: z.uuid().nullable(),
  variantTitle: z.string().nullable(),
  minQuantity: z.number().int(),
  unitPrice: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type CustomerPriceDto = z.infer<typeof customerPriceSchema>;
export const customerPriceListSchema = z.object({ items: z.array(customerPriceSchema) });

export const priceSourceSchema = z.enum(PRICE_SOURCES);

/**
 * The price the server worked out for one line, with the rule that produced it. Orders keep
 * this snapshot so later price changes never alter what a customer agreed to pay.
 */
export const priceQuoteLineSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  sellerId: z.uuid(),
  sku: z.string(),
  quantity: z.number().int(),
  currency: z.string(),
  unitPrice: z.string(),
  lineTotal: z.string(),
  regularPrice: z.string(),
  source: priceSourceSchema,
  rule: z
    .object({
      type: z.enum(['SALE', 'FLASH_SALE', 'PRICE_TIER', 'CUSTOMER_PRICE']),
      id: z.string(),
      minQuantity: z.number().int().nullable(),
      startsAt: z.iso.datetime().nullable(),
      endsAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  /** Wholesale tiers that apply to this buyer, for showing "buy more, pay less". */
  tiers: z.array(z.object({ minQuantity: z.number().int(), unitPrice: z.string() })),
  minOrderQuantity: z.number().int(),
  maxOrderQuantity: z.number().int().nullable(),
  wholesaleEligible: z.boolean(),
  /** The flash sale this line's price comes from, with what is left of it. */
  flashSale: z
    .object({
      itemId: z.uuid(),
      endsAt: z.iso.datetime(),
      remaining: z.number().int(),
      perOrderLimit: z.number().int().nullable(),
    })
    .nullable(),
});
export type PriceQuoteLine = z.infer<typeof priceQuoteLineSchema>;

export const priceQuoteSchema = z.object({
  lines: z.array(priceQuoteLineSchema),
  evaluatedAt: z.iso.datetime(),
});
export type PriceQuote = z.infer<typeof priceQuoteSchema>;

/** POST /pricing/quote. Only ids and quantities: prices are never accepted from clients. */
export const priceQuoteRequestSchema = z
  .object({
    items: z
      .array(z.object({ variantId: z.uuid(), quantity: quantitySchema }))
      .min(1)
      .max(100),
  })
  .strict();
export type PriceQuoteRequest = z.input<typeof priceQuoteRequestSchema>;

/** POST /products/{id}/price-preview (Seller Center): what a kind of buyer would pay. */
export const pricePreviewRequestSchema = z.object({
  variantId: z.uuid(),
  quantity: quantitySchema,
  buyer: z.enum(['RETAIL', 'WHOLESALE']),
  customerEmail: emailAddressSchema.optional(),
});
export type PricePreviewRequest = z.input<typeof pricePreviewRequestSchema>;

