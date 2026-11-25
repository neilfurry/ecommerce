import {
  BUYER_TYPES,
  COUPON_SCOPES,
  COUPON_TYPES,
  MAX_LINE_QUANTITY,
  ORDER_EVENT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROMOTION_STATUSES,
  SELLER_ORDER_STATUSES,
  SHIPPING_METHODS,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { decimalStringSchema, paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';
import { priceQuoteLineSchema } from './catalog';

/**
 * Contracts for checkout and orders (Phase 4). The client sends what to buy, where to and how
 * to pay; every amount is calculated by the server. A client total is only ever compared with
 * the server's (to tell the customer something changed), never used.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const sellerOrderStatusSchema = z.enum(SELLER_ORDER_STATUSES);
export const shippingMethodSchema = z.enum(SHIPPING_METHODS);
export const buyerTypeSchema = z.enum(BUYER_TYPES);
export const couponScopeSchema = z.enum(COUPON_SCOPES);
export const couponTypeSchema = z.enum(COUPON_TYPES);
export const orderEventTypeSchema = z.enum(ORDER_EVENT_TYPES);

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,30}$/, 'Letters and numbers only, 3–30 characters');

// ---- Checkout request -------------------------------------------------------------------

export const checkoutRequestSchema = z
  .object({
    /** Lines of the customer's cart to buy (default: every line not saved for later). */
    cartItemIds: z.array(z.uuid()).max(100).optional(),
    /** "Buy now": one item, without touching the cart. */
    buyNow: z
      .object({
        variantId: z.uuid(),
        quantity: z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY),
      })
      .optional(),
    addressId: z.uuid().nullable().optional(),
    /** Delivery method per seller (default: the cheapest available). */
    shipping: z
      .array(z.object({ sellerId: z.uuid(), method: shippingMethodSchema }))
      .max(50)
      .default([]),
    /** At most one marketplace coupon and one coupon per seller; the server sorts them out. */
    couponCodes: z.array(couponCodeSchema).max(20).default([]),
    paymentMethod: paymentMethodSchema.default('COD'),
    notes: z
      .array(z.object({ sellerId: z.uuid(), note: optionalText(500) }))
      .max(50)
      .default([]),
  })
  .strict()
  .refine((v) => !(v.cartItemIds && v.buyNow), {
    message: 'Buy from the cart or buy now, not both',
    path: ['buyNow'],
  });
export type CheckoutRequest = z.input<typeof checkoutRequestSchema>;
export type CheckoutRequestParsed = z.output<typeof checkoutRequestSchema>;

/** POST /checkout/orders: the same, plus the total the customer agreed to (compared, not used). */
export const placeOrderSchema = z
  .object({
    cartItemIds: z.array(z.uuid()).max(100).optional(),
    buyNow: z
      .object({
        variantId: z.uuid(),
        quantity: z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY),
      })
      .optional(),
    addressId: z.uuid({ error: 'Choose a delivery address' }),
    shipping: z
      .array(z.object({ sellerId: z.uuid(), method: shippingMethodSchema }))
      .max(50)
      .default([]),
    couponCodes: z.array(couponCodeSchema).max(20).default([]),
    paymentMethod: paymentMethodSchema,
    notes: z
      .array(z.object({ sellerId: z.uuid(), note: optionalText(500) }))
      .max(50)
      .default([]),
    expectedGrandTotal: decimalStringSchema(),
  })
  .strict()
  .refine((v) => !(v.cartItemIds && v.buyNow), {
    message: 'Buy from the cart or buy now, not both',
    path: ['buyNow'],
  });
export type PlaceOrderRequest = z.input<typeof placeOrderSchema>;

// ---- Checkout quote ---------------------------------------------------------------------

export const shippingOptionSchema = z.object({
  method: shippingMethodSchema,
  label: z.string(),
  carrier: z.string(),
  fee: z.string(),
  etaMinDays: z.number().int(),
  etaMaxDays: z.number().int(),
});
export type ShippingOption = z.infer<typeof shippingOptionSchema>;

export const chargeSchema = z.object({ code: z.string(), label: z.string(), amount: z.string() });

export const checkoutLineSchema = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  productName: z.string(),
  productSlug: z.string(),
  variantTitle: z.string(),
  options: z.record(z.string(), z.string()),
  imageUrl: z.string().nullable(),
  quantity: z.number().int(),
  price: priceQuoteLineSchema,
  sellerDiscount: z.string(),
  platformDiscount: z.string(),
  lineTotal: z.string(),
  vatAmount: z.string(),
});
export type CheckoutLine = z.infer<typeof checkoutLineSchema>;

export const couponResultSchema = z.object({
  code: z.string(),
  status: z.enum(['APPLIED', 'NOT_APPLIED']),
  scope: couponScopeSchema.nullable(),
  type: couponTypeSchema.nullable(),
  name: z.string().nullable(),
  sellerId: z.uuid().nullable(),
  /** Item discount plus shipping discount. */
  amount: z.string(),
  /** Why it was not applied. */
  message: z.string().nullable(),
});
export type CouponResult = z.infer<typeof couponResultSchema>;

export const checkoutSellerGroupSchema = z.object({
  sellerId: z.uuid(),
  store: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  lines: z.array(checkoutLineSchema),
  shipping: z.object({
    options: z.array(shippingOptionSchema),
    selected: shippingOptionSchema.nullable(),
    origin: z.string(),
    weightGrams: z.number().int(),
    chargeableWeightGrams: z.number().int(),
    fee: z.string(),
    sellerDiscount: z.string(),
    platformDiscount: z.string(),
  }),
  itemsSubtotal: z.string(),
  wholesaleSavings: z.string(),
  sellerDiscount: z.string(),
  platformDiscount: z.string(),
  charges: z.array(chargeSchema),
  vatAmount: z.string(),
  total: z.string(),
  note: z.string().nullable(),
});
export type CheckoutSellerGroup = z.infer<typeof checkoutSellerGroupSchema>;

export const checkoutQuoteSchema = z.object({
  currency: z.string(),
  buyerType: buyerTypeSchema,
  address: z.object({ id: z.uuid(), formatted: z.string(), recipientName: z.string() }).nullable(),
  groups: z.array(checkoutSellerGroupSchema),
  coupons: z.array(couponResultSchema),
  paymentMethod: paymentMethodSchema,
  paymentMethods: z.array(
    z.object({
      method: paymentMethodSchema,
      label: z.string(),
      /** For online methods: the order waits for payment until this many minutes pass. */
      paymentWindowMinutes: z.number().int().nullable(),
    }),
  ),
  totals: z.object({
    itemsSubtotal: z.string(),
    wholesaleSavings: z.string(),
    couponDiscount: z.string(),
    shippingFee: z.string(),
    shippingDiscount: z.string(),
    chargesTotal: z.string(),
    vatAmount: z.string(),
    grandTotal: z.string(),
  }),
  vat: z.object({ rate: z.string(), included: z.boolean() }),
  /** Blocking problems (empty when the order can be placed). */
  problems: z.array(z.object({ path: z.string(), message: z.string() })),
  evaluatedAt: z.iso.datetime(),
});
export type CheckoutQuote = z.infer<typeof checkoutQuoteSchema>;

// ---- Orders -----------------------------------------------------------------------------

export const orderItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid(),
  productSlug: z.string().nullable(),
  sku: z.string(),
  productName: z.string(),
  variantTitle: z.string(),
  options: z.record(z.string(), z.string()),
  imageUrl: z.string().nullable(),
  quantity: z.number().int(),
  unitPrice: z.string(),
  regularUnitPrice: z.string(),
  lineSubtotal: z.string(),
  sellerDiscount: z.string(),
  platformDiscount: z.string(),
  lineTotal: z.string(),
  vatAmount: z.string(),
  priceSource: z.string(),
  /** Whether the customer has reviewed this item (customer views only). */
  reviewed: z.boolean(),
});
export type OrderItemDto = z.infer<typeof orderItemSchema>;

export const shippingGroupSchema = z.object({
  method: shippingMethodSchema,
  carrier: z.string(),
  serviceName: z.string(),
  origin: z.string(),
  weightGrams: z.number().int(),
  chargeableWeightGrams: z.number().int(),
  fee: z.string(),
  discount: z.string(),
  etaMinDays: z.number().int(),
  etaMaxDays: z.number().int(),
});

export const sellerOrderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: sellerOrderStatusSchema,
  sellerId: z.uuid(),
  store: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  items: z.array(orderItemSchema),
  shipping: shippingGroupSchema.nullable(),
  itemsSubtotal: z.string(),
  wholesaleSavings: z.string(),
  sellerDiscount: z.string(),
  platformDiscount: z.string(),
  shippingFee: z.string(),
  shippingDiscount: z.string(),
  charges: z.array(chargeSchema),
  vatAmount: z.string(),
  total: z.string(),
  customerNote: z.string().nullable(),
});
export type SellerOrderDto = z.infer<typeof sellerOrderSchema>;

export const orderAddressSchema = z.object({
  recipientName: z.string(),
  mobile: z.string(),
  streetAddress: z.string(),
  addressLine2: z.string().nullable(),
  barangay: z.string(),
  city: z.string(),
  province: z.string().nullable(),
  region: z.string(),
  postalCode: z.string(),
  formatted: z.string(),
});
export type OrderAddress = z.infer<typeof orderAddressSchema>;

export const orderEventSchema = z.object({
  type: orderEventTypeSchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const orderSummarySchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema,
  grandTotal: z.string(),
  currency: z.string(),
  itemCount: z.number().int(),
  sellerCount: z.number().int(),
  /** First few item thumbnails and names for the list. */
  preview: z.array(z.object({ productName: z.string(), imageUrl: z.string().nullable() })),
  paymentDueAt: z.iso.datetime().nullable(),
  placedAt: z.iso.datetime(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export const orderListSchema = paginatedSchema(orderSummarySchema);
export type OrderList = z.infer<typeof orderListSchema>;
export const orderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  buyerType: buyerTypeSchema,
  address: orderAddressSchema,
  contactEmail: z.string(),
  sellerOrders: z.array(sellerOrderSchema),
  coupons: z.array(
    z.object({
      code: z.string(),
      scope: couponScopeSchema,
      type: couponTypeSchema,
      amount: z.string(),
    }),
  ),
  totals: checkoutQuoteSchema.shape.totals,
  vat: z.object({ rate: z.string(), included: z.boolean() }),
  events: z.array(orderEventSchema),
  cancelledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
  /** Whether the customer can still cancel. */
  cancellable: z.boolean(),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us why (at least 3 characters)').max(500),
});
export type CancelOrderRequest = z.input<typeof cancelOrderSchema>;

// ---- Seller and staff order views ------------------------------------------------------

export const sellerOrderSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  orderNumber: z.string(),
  status: sellerOrderStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema,
  customerName: z.string(),
  itemCount: z.number().int(),
  total: z.string(),
  commissionAmount: z.string(),
  store: z.object({ id: z.uuid(), name: z.string() }),
  seller: z.object({ id: z.uuid(), businessName: z.string() }),
  placedAt: z.iso.datetime(),
});
export type SellerOrderSummary = z.infer<typeof sellerOrderSummarySchema>;
export const sellerOrderListSchema = paginatedSchema(sellerOrderSummarySchema);
export type SellerOrderList = z.infer<typeof sellerOrderListSchema>;
export const sellerOrderListQuerySchema = paginationQuerySchema.extend({
  status: sellerOrderStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  sellerId: z.uuid().optional(),
});

export const sellerOrderDetailSchema = sellerOrderSchema.extend({
  orderId: z.uuid(),
  orderNumber: z.string(),
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema,
  buyerType: buyerTypeSchema,
  customer: z.object({ name: z.string(), email: z.string() }),
  address: orderAddressSchema,
  commission: z.object({
    amount: z.string(),
    items: z.array(
      z.object({
        orderItemId: z.uuid(),
        ruleId: z.uuid().nullable(),
        ratePercent: z.string(),
        base: z.string(),
        amount: z.string(),
      }),
    ),
  }),
  coupons: z.array(
    z.object({
      code: z.string(),
      scope: couponScopeSchema,
      type: couponTypeSchema,
      amount: z.string(),
    }),
  ),
  events: z.array(orderEventSchema),
  placedAt: z.iso.datetime(),
});
export type SellerOrderDetail = z.infer<typeof sellerOrderDetailSchema>;

// ---- Coupons ----------------------------------------------------------------------------

export const promotionStatusInputSchema = z.enum(PROMOTION_STATUSES);

const couponFields = {
  code: couponCodeSchema,
  name: z.string().trim().min(3, 'Enter a name').max(120),
  description: optionalText(500),
  type: couponTypeSchema,
  /** Percent (1–100) or pesos; "0" for free shipping. */
  value: decimalStringSchema(),
  maxDiscount: decimalStringSchema().nullable().optional(),
  minSpend: decimalStringSchema().default('0'),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  perCustomerLimit: z.coerce.number().int().min(1).max(100).default(1),
  status: promotionStatusInputSchema.default('ACTIVE'),
};
const couponRefinements = <
  T extends z.ZodType<{
    type: string;
    value: string;
    startsAt: string;
    endsAt: string;
  }>,
>(
  schema: T,
) =>
  schema
    .refine((v) => v.type !== 'PERCENTAGE' || (Number(v.value) > 0 && Number(v.value) <= 100), {
      message: 'Between 1 and 100 percent',
      path: ['value'],
    })
    .refine((v) => v.type !== 'FIXED_AMOUNT' || Number(v.value) > 0, {
      message: 'Enter an amount above zero',
      path: ['value'],
    })
    .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
      message: 'Must be after the start',
      path: ['endsAt'],
    });

export const couponInputSchema = couponRefinements(z.object(couponFields));
export type CouponInput = z.input<typeof couponInputSchema>;
export const updateCouponSchema = z
  .object({
    name: couponFields.name,
    description: couponFields.description,
    endsAt: couponFields.endsAt,
    usageLimit: couponFields.usageLimit,
    perCustomerLimit: z.coerce.number().int().min(1).max(100),
    status: promotionStatusInputSchema,
  })
  .partial();
export type UpdateCouponRequest = z.input<typeof updateCouponSchema>;

export const couponSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  scope: couponScopeSchema,
  seller: z.object({ id: z.uuid(), businessName: z.string() }).nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: couponTypeSchema,
  value: z.string(),
  maxDiscount: z.string().nullable(),
  minSpend: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  usageLimit: z.number().int().nullable(),
  perCustomerLimit: z.number().int(),
  usedCount: z.number().int(),
  status: promotionStatusInputSchema,
  createdAt: z.iso.datetime(),
});
export type CouponDto = z.infer<typeof couponSchema>;
export const couponListSchema = paginatedSchema(couponSchema);
export type CouponList = z.infer<typeof couponListSchema>;
export const couponListQuerySchema = paginationQuerySchema.extend({
  scope: couponScopeSchema.optional(),
  status: promotionStatusInputSchema.optional(),
  search: z.string().trim().max(60).optional(),
});

// ---- Flash sales ------------------------------------------------------------------------

export const flashSaleInputSchema = z
  .object({
    title: z.string().trim().min(3, 'Enter a title').max(120),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    status: promotionStatusInputSchema.default('ACTIVE'),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'Must be after the start',
    path: ['endsAt'],
  });
export type FlashSaleInput = z.input<typeof flashSaleInputSchema>;
export const updateFlashSaleSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    status: promotionStatusInputSchema,
  })
  .partial();
export type UpdateFlashSaleRequest = z.input<typeof updateFlashSaleSchema>;

export const flashSaleItemInputSchema = z.object({
  variantId: z.uuid(),
  flashPrice: decimalStringSchema(),
  quantityLimit: z.coerce.number().int().min(1).max(100_000),
  perOrderLimit: z.coerce.number().int().min(1).max(1000).nullable().optional(),
});
export type FlashSaleItemInput = z.input<typeof flashSaleItemInputSchema>;

export const flashSaleItemSchema = z.object({
  id: z.uuid(),
  sellerId: z.uuid(),
  sellerName: z.string(),
  productId: z.uuid(),
  productName: z.string(),
  variantId: z.uuid(),
  sku: z.string(),
  variantTitle: z.string(),
  regularPrice: z.string(),
  flashPrice: z.string(),
  quantityLimit: z.number().int(),
  soldQuantity: z.number().int(),
  perOrderLimit: z.number().int().nullable(),
  status: promotionStatusInputSchema,
});
export type FlashSaleItemDto = z.infer<typeof flashSaleItemSchema>;

export const flashSaleSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: promotionStatusInputSchema,
  /** UPCOMING, RUNNING or ENDED, from the dates. */
  phase: z.enum(['UPCOMING', 'RUNNING', 'ENDED']),
  items: z.array(flashSaleItemSchema),
});
export type FlashSaleDto = z.infer<typeof flashSaleSchema>;
export const flashSaleListSchema = z.object({ items: z.array(flashSaleSchema) });
export type FlashSaleList = z.infer<typeof flashSaleListSchema>;

// ---- Settings ---------------------------------------------------------------------------

const rateString = decimalStringSchema({ scale: 4 });

export const checkoutSettingsSchema = z.object({
  vat: z.object({
    /** e.g. "0.12" for 12%. */
    rate: rateString.refine((v) => Number(v) >= 0 && Number(v) < 1, 'Between 0 and 1'),
    /** Prices already include VAT (the VAT is shown as part of the total). */
    pricesIncludeVat: z.literal(true),
  }),
  /** Other configured charges, added per seller order. */
  charges: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Upper-case letters, digits and _'),
        label: z.string().trim().min(2).max(60),
        type: z.enum(['FIXED', 'PERCENT_OF_ITEMS']),
        amount: decimalStringSchema({ scale: 2 }),
        /** Only for these payment methods (empty: all). */
        paymentMethods: z.array(paymentMethodSchema).default([]),
      }),
    )
    .max(10),
  /** How long online-payment orders hold stock waiting for payment. */
  paymentWindowMinutes: z.coerce.number().int().min(5).max(60),
  /** Payment methods offered at checkout. */
  paymentMethods: z.array(paymentMethodSchema).min(1),
});
export type CheckoutSettings = z.infer<typeof checkoutSettingsSchema>;
export type CheckoutSettingsInput = z.input<typeof checkoutSettingsSchema>;

/** Mock shipping rate table (development): zones by island group. */
export const shippingRatesSchema = z.object({
  /** Fee for the first kilogram, per route. */
  base: z.object({
    sameCity: decimalStringSchema(),
    sameRegion: decimalStringSchema(),
    sameIslandGroup: decimalStringSchema(),
    otherIslandGroup: decimalStringSchema(),
  }),
  /** Each additional kilogram (rounded up). */
  perAdditionalKg: decimalStringSchema(),
  /** Volumetric weight divisor (cm³ per kg), e.g. 3500. */
  volumetricDivisor: z.coerce.number().int().min(1000).max(10000),
  /** Multiplier for express delivery, e.g. "1.6". */
  expressMultiplier: decimalStringSchema({ scale: 2 }),
  /** Same-day delivery within the same city, flat fee (null: not offered). */
  sameDayFee: decimalStringSchema().nullable(),
});
export type ShippingRates = z.infer<typeof shippingRatesSchema>;

export const commissionRuleSchema = z.object({
  id: z.uuid(),
  category: z.object({ id: z.uuid(), name: z.string(), path: z.array(z.string()) }).nullable(),
  ratePercent: z.string(),
  updatedAt: z.iso.datetime(),
});
export type CommissionRuleDto = z.infer<typeof commissionRuleSchema>;
export const commissionRuleListSchema = z.object({ items: z.array(commissionRuleSchema) });
export const commissionRuleInputSchema = z.object({
  categoryId: z.uuid().nullable(),
  ratePercent: decimalStringSchema().refine((v) => Number(v) <= 100, 'At most 100%'),
});
export type CommissionRuleInput = z.input<typeof commissionRuleInputSchema>;

export const platformSettingsSchema = z.object({
  checkout: checkoutSettingsSchema,
  shippingRates: shippingRatesSchema,
  commissionRules: z.array(commissionRuleSchema),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

// ---- Staff order views ------------------------------------------------------------------

export const adminOrderSummarySchema = orderSummarySchema.extend({
  customer: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  buyerType: buyerTypeSchema,
});
export type AdminOrderSummary = z.infer<typeof adminOrderSummarySchema>;
export const adminOrderListSchema = paginatedSchema(adminOrderSummarySchema);
export type AdminOrderList = z.infer<typeof adminOrderListSchema>;
export const adminOrderListQuerySchema = paginationQuerySchema.extend({
  status: orderStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  /** Order number or customer name/email. */
  search: z.string().trim().max(100).optional(),
});
export const adminOrderDetailSchema = orderDetailSchema.extend({
  customer: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  commissionAmount: z.string(),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
