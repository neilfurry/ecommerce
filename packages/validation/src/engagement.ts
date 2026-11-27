import {
  AFFILIATE_CONVERSION_STATUSES,
  AFFILIATE_STATUSES,
  CAMPAIGN_TYPES,
  COUPON_SCOPES,
  LOYALTY_TRANSACTION_TYPES,
  MAX_PROMOTION_TARGETS,
  NOTIFICATION_CHANNELS,
  PROMOTION_APPLIES_TO,
  PROMOTION_STATUSES,
  REFERRAL_STATUSES,
  REPORT_FORMATS,
  REPORT_GRANULARITIES,
  REVIEW_REPORT_REASONS,
  REVIEW_REPORT_STATUSES,
  SUPPORT_AUTHOR_ROLES,
  SUPPORT_PRIORITIES,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { decimalStringSchema, paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';

/**
 * Contracts for marketing and customer engagement (Phase 7): campaigns, loyalty points,
 * referrals and affiliates, review replies and reports, seller ratings, notifications,
 * support tickets and analytics. Every amount is calculated by the server.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const campaignTypeSchema = z.enum(CAMPAIGN_TYPES);
const scopeSchema = z.enum(COUPON_SCOPES);
const appliesToSchema = z.enum(PROMOTION_APPLIES_TO);
const statusSchema = z.enum(PROMOTION_STATUSES);
const named = z.object({ id: z.uuid(), name: z.string() });

// ---- Settings ---------------------------------------------------------------------------

/** platform_settings key "loyalty" (ADR 0031). */
export const loyaltySettingsSchema = z.object({
  enabled: z.boolean(),
  /** Pesos of merchandise paid per point earned (1 point per ₱100 by default). */
  pesosPerPoint: decimalStringSchema().refine((v) => Number(v) >= 1, 'At least ₱1'),
  /** What one point is worth at checkout. */
  pointValue: decimalStringSchema().refine((v) => Number(v) > 0, 'Above zero'),
  /** Points can pay at most this share of the items (after other discounts). */
  maxRedeemPercent: z.coerce.number().int().min(0).max(100),
  /** Points expire this many months after they were earned. */
  expiryMonths: z.coerce.number().int().min(1).max(60),
  referral: z.object({
    enabled: z.boolean(),
    /** Points for the customer who shared the code, after the friend's first completed order. */
    referrerPoints: z.coerce.number().int().min(0).max(100_000),
    /** Points for the friend who signed up with the code. */
    refereePoints: z.coerce.number().int().min(0).max(100_000),
  }),
});
export type LoyaltySettings = z.infer<typeof loyaltySettingsSchema>;
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: true,
  pesosPerPoint: '100',
  pointValue: '1',
  maxRedeemPercent: 20,
  expiryMonths: 12,
  referral: { enabled: true, referrerPoints: 100, refereePoints: 50 },
};

/** platform_settings key "affiliates" (ADR 0032). */
export const affiliateSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Percent of the merchandise paid, for affiliates without their own rate. */
  defaultCommissionRate: decimalStringSchema().refine((v) => Number(v) <= 50, 'At most 50%'),
  /** How long a click is remembered by the storefront before checkout. */
  cookieDays: z.coerce.number().int().min(1).max(90),
  /** Smallest payout finance records. */
  minPayout: decimalStringSchema(),
});
export type AffiliateSettings = z.infer<typeof affiliateSettingsSchema>;
export const DEFAULT_AFFILIATE_SETTINGS: AffiliateSettings = {
  enabled: true,
  defaultCommissionRate: '5',
  cookieDays: 30,
  minPayout: '500',
};

// ---- Campaigns --------------------------------------------------------------------------

const campaignFields = {
  name: z.string().trim().min(3, 'Enter a name').max(120),
  description: optionalText(500),
  season: optionalText(60),
  type: campaignTypeSchema,
  /** Percent for PERCENTAGE_OFF / BUNDLE / BUY_X_GET_Y; pesos for FIXED_OFF; 0 for free shipping. */
  value: decimalStringSchema().default('0'),
  maxDiscount: decimalStringSchema().nullable().optional(),
  minQuantity: z.coerce.number().int().min(1).max(1000).default(1),
  buyQuantity: z.coerce.number().int().min(1).max(100).nullable().optional(),
  getQuantity: z.coerce.number().int().min(1).max(100).nullable().optional(),
  minSpend: decimalStringSchema().default('0'),
  appliesTo: appliesToSchema.default('ALL'),
  productIds: z.array(z.uuid()).max(MAX_PROMOTION_TARGETS).default([]),
  categoryIds: z.array(z.uuid()).max(MAX_PROMOTION_TARGETS).default([]),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  status: statusSchema.default('ACTIVE'),
  priority: z.coerce.number().int().min(0).max(100).default(0),
};

type CampaignShape = {
  type: string;
  value: string;
  startsAt: string;
  endsAt: string;
  appliesTo: string;
  productIds: string[];
  categoryIds: string[];
  minQuantity: number;
  buyQuantity?: number | null;
  getQuantity?: number | null;
};
const percent = (v: string) => Number(v) > 0 && Number(v) <= 100;
export const campaignInputSchema = z.object(campaignFields).superRefine((v: CampaignShape, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (new Date(v.endsAt) <= new Date(v.startsAt)) issue('endsAt', 'Must be after the start');
  if (['PERCENTAGE_OFF', 'BUNDLE', 'BUY_X_GET_Y'].includes(v.type) && !percent(v.value))
    issue('value', 'Between 1 and 100 percent');
  if (v.type === 'FIXED_OFF' && !(Number(v.value) > 0)) issue('value', 'Enter an amount');
  if (v.type === 'BUNDLE' && v.minQuantity < 2) issue('minQuantity', 'At least 2 items');
  if (v.type === 'BUY_X_GET_Y' && (!v.buyQuantity || !v.getQuantity))
    issue('buyQuantity', 'Enter how many to buy and how many they get');
  if (v.appliesTo === 'PRODUCTS' && v.productIds.length === 0)
    issue('productIds', 'Choose at least one product');
  if (v.appliesTo === 'CATEGORIES' && v.categoryIds.length === 0)
    issue('categoryIds', 'Choose at least one category');
});
export type CampaignInput = z.input<typeof campaignInputSchema>;
export type CampaignInputParsed = z.output<typeof campaignInputSchema>;
/** Changes keep the type; dates, value, targets and status can change. */
export const updateCampaignSchema = z
  .object({
    name: campaignFields.name,
    description: campaignFields.description,
    season: campaignFields.season,
    value: decimalStringSchema(),
    maxDiscount: campaignFields.maxDiscount,
    minQuantity: z.coerce.number().int().min(1).max(1000),
    buyQuantity: campaignFields.buyQuantity,
    getQuantity: campaignFields.getQuantity,
    minSpend: decimalStringSchema(),
    appliesTo: appliesToSchema,
    productIds: z.array(z.uuid()).max(MAX_PROMOTION_TARGETS),
    categoryIds: z.array(z.uuid()).max(MAX_PROMOTION_TARGETS),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    status: statusSchema,
    priority: z.coerce.number().int().min(0).max(100),
  })
  .partial();
export type UpdateCampaignRequest = z.input<typeof updateCampaignSchema>;

export const campaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  season: z.string().nullable(),
  scope: scopeSchema,
  seller: z.object({ id: z.uuid(), businessName: z.string() }).nullable(),
  type: campaignTypeSchema,
  value: z.string(),
  maxDiscount: z.string().nullable(),
  minQuantity: z.number().int(),
  buyQuantity: z.number().int().nullable(),
  getQuantity: z.number().int().nullable(),
  minSpend: z.string(),
  appliesTo: appliesToSchema,
  products: z.array(named),
  categories: z.array(named),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: statusSchema,
  priority: z.number().int(),
  /** Seller orders that used it (not cancelled) and the discount given. */
  usage: z.object({ orders: z.number().int(), discount: z.string() }),
  createdAt: z.iso.datetime(),
});
export type CampaignDto = z.infer<typeof campaignSchema>;
export const campaignListSchema = paginatedSchema(campaignSchema);
export type CampaignList = z.infer<typeof campaignListSchema>;
export const campaignListQuerySchema = paginationQuerySchema.extend({
  scope: scopeSchema.optional(),
  status: statusSchema.optional(),
  type: campaignTypeSchema.optional(),
  search: z.string().trim().max(60).optional(),
});

/** Storefront: running campaigns (for banners and product badges). */
export const activeCampaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  season: z.string().nullable(),
  type: campaignTypeSchema,
  scope: scopeSchema,
  store: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }).nullable(),
  /** Short customer-facing text, e.g. "Buy 1, take 1" or "15% off". */
  headline: z.string(),
  minSpend: z.string(),
  minQuantity: z.number().int(),
  endsAt: z.iso.datetime(),
});
export type ActiveCampaign = z.infer<typeof activeCampaignSchema>;
export const activeCampaignListSchema = z.object({ items: z.array(activeCampaignSchema) });

// ---- Loyalty ----------------------------------------------------------------------------

export const loyaltyTransactionTypeSchema = z.enum(LOYALTY_TRANSACTION_TYPES);
export const loyaltyTransactionSchema = z.object({
  id: z.uuid(),
  type: loyaltyTransactionTypeSchema,
  points: z.number().int(),
  balanceAfter: z.number().int(),
  value: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  description: z.string(),
  orderNumber: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type LoyaltyTransactionDto = z.infer<typeof loyaltyTransactionSchema>;
export const loyaltyTransactionListSchema = paginatedSchema(loyaltyTransactionSchema);
export type LoyaltyTransactionList = z.infer<typeof loyaltyTransactionListSchema>;

export const loyaltySummarySchema = z.object({
  enabled: z.boolean(),
  balance: z.number().int(),
  /** Peso value of the balance. */
  value: z.string(),
  lifetimeEarned: z.number().int(),
  /** Points that will expire within 30 days, and the first expiry date. */
  expiringSoon: z.object({ points: z.number().int(), firstAt: z.iso.datetime().nullable() }),
  /** Points waiting for orders to complete (estimated). */
  pending: z.number().int(),
  rules: z.object({
    pesosPerPoint: z.string(),
    pointValue: z.string(),
    maxRedeemPercent: z.number().int(),
    expiryMonths: z.number().int(),
  }),
});
export type LoyaltySummary = z.infer<typeof loyaltySummarySchema>;

/** Staff: one customer's account. */
export const adminLoyaltyAccountSchema = loyaltySummarySchema.extend({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
});
export type AdminLoyaltyAccount = z.infer<typeof adminLoyaltyAccountSchema>;
export const adminLoyaltyAccountListSchema = paginatedSchema(
  z.object({
    userId: z.uuid(),
    name: z.string(),
    email: z.string(),
    balance: z.number().int(),
    lifetimeEarned: z.number().int(),
    updatedAt: z.iso.datetime(),
  }),
);
export type AdminLoyaltyAccountList = z.infer<typeof adminLoyaltyAccountListSchema>;
export const loyaltyAdjustmentSchema = z.object({
  points: z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, 'Enter a number of points'),
  reason: z.string().trim().min(5, 'Explain the adjustment').max(300),
});
export type LoyaltyAdjustmentRequest = z.input<typeof loyaltyAdjustmentSchema>;
export const loyaltyTransactionQuerySchema = paginationQuerySchema.extend({
  type: loyaltyTransactionTypeSchema.optional(),
});

// ---- Referrals --------------------------------------------------------------------------

export const myReferralsSchema = z.object({
  enabled: z.boolean(),
  code: z.string(),
  /** Sign-up link with the code. */
  link: z.string(),
  referrerPoints: z.number().int(),
  refereePoints: z.number().int(),
  referrals: z.array(
    z.object({
      name: z.string(),
      status: z.enum(REFERRAL_STATUSES),
      joinedAt: z.iso.datetime(),
      rewardedAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type MyReferrals = z.infer<typeof myReferralsSchema>;

// ---- Affiliates -------------------------------------------------------------------------

export const affiliateStatusSchema = z.enum(AFFILIATE_STATUSES);
export const affiliateConversionStatusSchema = z.enum(AFFILIATE_CONVERSION_STATUSES);
export const affiliateApplicationSchema = z.object({
  displayName: z.string().trim().min(2, 'Enter a name').max(120),
  website: z
    .string()
    .trim()
    .url('Enter a full address (https://...)')
    .max(300)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
});
export type AffiliateApplication = z.input<typeof affiliateApplicationSchema>;

export const affiliateTotalsSchema = z.object({
  clicks: z.number().int(),
  conversions: z.number().int(),
  /** Conversion rate (orders per click), percent. */
  conversionRate: z.string(),
  sales: z.string(),
  pending: z.string(),
  accrued: z.string(),
  paid: z.string(),
  reversed: z.string(),
  /** Accrued, not yet paid (what the next payout would be). */
  payable: z.string(),
});
export const affiliateAccountSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  link: z.string(),
  displayName: z.string(),
  website: z.string().nullable(),
  status: affiliateStatusSchema,
  /** The rate in effect (own rate or the default). */
  commissionRate: z.string(),
  ownRate: z.string().nullable(),
  reviewNote: z.string().nullable(),
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  totals: affiliateTotalsSchema,
  createdAt: z.iso.datetime(),
});
export type AffiliateAccountDto = z.infer<typeof affiliateAccountSchema>;
export const affiliateAccountListSchema = paginatedSchema(affiliateAccountSchema);
export type AffiliateAccountList = z.infer<typeof affiliateAccountListSchema>;
export const affiliateListQuerySchema = paginationQuerySchema.extend({
  status: affiliateStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
});
export const reviewAffiliateSchema = z
  .object({
    status: affiliateStatusSchema.exclude(['PENDING']),
    commissionRate: decimalStringSchema()
      .refine((v) => Number(v) <= 50, 'At most 50%')
      .nullable()
      .optional(),
    note: optionalText(500),
  })
  .strict();
export type ReviewAffiliateRequest = z.input<typeof reviewAffiliateSchema>;

export const affiliateConversionSchema = z.object({
  id: z.uuid(),
  orderNumber: z.string(),
  sellerOrderNumber: z.string(),
  status: affiliateConversionStatusSchema,
  baseAmount: z.string(),
  rate: z.string(),
  commissionAmount: z.string(),
  reversedAmount: z.string(),
  accruedAt: z.iso.datetime().nullable(),
  payoutReference: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AffiliateConversionDto = z.infer<typeof affiliateConversionSchema>;
export const affiliateConversionListSchema = paginatedSchema(affiliateConversionSchema);
export type AffiliateConversionList = z.infer<typeof affiliateConversionListSchema>;
export const affiliateConversionQuerySchema = paginationQuerySchema.extend({
  status: affiliateConversionStatusSchema.optional(),
});

/** Monthly affiliate report rows. */
export const affiliateReportSchema = z.object({
  totals: affiliateTotalsSchema,
  months: z.array(
    z.object({
      month: z.string(),
      clicks: z.number().int(),
      conversions: z.number().int(),
      sales: z.string(),
      commission: z.string(),
    }),
  ),
});
export type AffiliateReport = z.infer<typeof affiliateReportSchema>;

export const recordAffiliatePayoutSchema = z
  .object({
    method: z.string().trim().min(2, 'How was it paid?').max(60),
    externalReference: optionalText(120),
    note: optionalText(500),
    paidAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type RecordAffiliatePayoutRequest = z.input<typeof recordAffiliatePayoutSchema>;
export const affiliatePayoutSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  amount: z.string(),
  method: z.string(),
  externalReference: z.string().nullable(),
  note: z.string().nullable(),
  conversions: z.number().int(),
  paidAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type AffiliatePayoutDto = z.infer<typeof affiliatePayoutSchema>;
export const affiliatePayoutListSchema = z.object({ items: z.array(affiliatePayoutSchema) });

export const affiliateClickSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{3,20}$/),
    landingPath: z.string().trim().max(300).default('/'),
  })
  .strict();
export type AffiliateClickRequest = z.input<typeof affiliateClickSchema>;

// ---- Reviews: replies, reports, seller ratings ------------------------------------------------

export const reviewReplySchema = z.object({
  body: z.string().trim().min(2, 'Write a reply').max(2000),
});
export type ReviewReplyRequest = z.input<typeof reviewReplySchema>;

export const reviewReportReasonSchema = z.enum(REVIEW_REPORT_REASONS);
export const reviewReportStatusSchema = z.enum(REVIEW_REPORT_STATUSES);
export const reportReviewSchema = z.object({
  reason: reviewReportReasonSchema,
  details: optionalText(500),
});
export type ReportReviewRequest = z.input<typeof reportReviewSchema>;
export const reviewReportSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  reason: reviewReportReasonSchema,
  details: z.string().nullable(),
  status: reviewReportStatusSchema,
  reporterEmail: z.string(),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewReportDto = z.infer<typeof reviewReportSchema>;
export const resolveReviewReportsSchema = z.object({
  /** UPHOLD hides the review; DISMISS keeps it. Either closes its open reports. */
  action: z.enum(['UPHOLD', 'DISMISS']),
  note: optionalText(500),
});
export type ResolveReviewReportsRequest = z.input<typeof resolveReviewReportsSchema>;

/** Seller portal: reviews of the seller's products. */
export const sellerReviewQuerySchema = paginationQuerySchema.extend({
  replied: z.enum(['true', 'false']).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

const score = z.coerce.number().int().min(1, 'Choose 1 to 5').max(5, 'Choose 1 to 5');
export const sellerRatingInputSchema = z.object({
  productQuality: score,
  shippingSpeed: score,
  communication: score,
  comment: optionalText(1000),
});
export type SellerRatingInput = z.input<typeof sellerRatingInputSchema>;
export const sellerRatingSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid(),
  productQuality: z.number().int(),
  shippingSpeed: z.number().int(),
  communication: z.number().int(),
  overall: z.string(),
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SellerRatingDto = z.infer<typeof sellerRatingSchema>;
/** Aggregates from verified (delivered) seller orders only. */
export const sellerRatingSummarySchema = z.object({
  count: z.number().int(),
  overall: z.string(),
  productQuality: z.string(),
  shippingSpeed: z.string(),
  communication: z.string(),
  /** Delivered seller orders of this seller (the transactions customers can rate). */
  deliveredOrders: z.number().int(),
  breakdown: z.array(z.object({ rating: z.number().int(), count: z.number().int() })),
});
export type SellerRatingSummary = z.infer<typeof sellerRatingSummarySchema>;

// ---- Notifications ----------------------------------------------------------------------

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export const notificationTemplateSchema = z.object({
  id: z.uuid(),
  event: z.string(),
  channel: notificationChannelSchema,
  subject: z.string().nullable(),
  body: z.string(),
  enabled: z.boolean(),
  variables: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export type NotificationTemplateDto = z.infer<typeof notificationTemplateSchema>;
export const notificationTemplateListSchema = z.object({
  items: z.array(notificationTemplateSchema),
  events: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      audience: z.string(),
      builtInEmail: z.boolean(),
      variables: z.array(z.string()),
    }),
  ),
});
export type NotificationTemplateList = z.infer<typeof notificationTemplateListSchema>;
export const upsertNotificationTemplateSchema = z
  .object({
    subject: optionalText(200),
    body: z.string().trim().min(2, 'Write the message').max(4000),
    enabled: z.boolean().default(true),
  })
  .strict();
export type UpsertNotificationTemplateRequest = z.input<typeof upsertNotificationTemplateSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  event: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
export const notificationListSchema = paginatedSchema(notificationSchema).extend({
  unread: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;
export const notificationListQuerySchema = paginationQuerySchema.extend({
  unread: z.enum(['true', 'false']).optional(),
});
export const markNotificationsReadSchema = z
  .object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() })
  .strict()
  .refine((v) => v.all || (v.ids && v.ids.length > 0), 'Choose notifications');
export type MarkNotificationsReadRequest = z.input<typeof markNotificationsReadSchema>;

export const notificationPreferencesSchema = z.object({
  channels: z.array(z.object({ channel: notificationChannelSchema, enabled: z.boolean() })),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const updateNotificationPreferencesSchema = z
  .object({
    channels: z
      .array(z.object({ channel: notificationChannelSchema, enabled: z.boolean() }))
      .min(1)
      .max(4),
  })
  .strict();
export type UpdateNotificationPreferencesRequest = z.input<
  typeof updateNotificationPreferencesSchema
>;

export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z.url().max(500),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  })
  .strict();
export type PushSubscriptionInput = z.input<typeof pushSubscriptionInputSchema>;

export const notificationDeliverySchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  event: z.string(),
  channel: notificationChannelSchema,
  status: z.enum(['SENT', 'SKIPPED', 'FAILED']),
  /** Masked (e.g. j***@example.com, +63917****567). */
  destination: z.string().nullable(),
  provider: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationDeliveryDto = z.infer<typeof notificationDeliverySchema>;
export const notificationDeliveryListSchema = paginatedSchema(notificationDeliverySchema);
export type NotificationDeliveryList = z.infer<typeof notificationDeliveryListSchema>;
export const notificationDeliveryQuerySchema = paginationQuerySchema.extend({
  channel: notificationChannelSchema.optional(),
  status: z.enum(['SENT', 'SKIPPED', 'FAILED']).optional(),
  event: z.string().trim().max(60).optional(),
});

/** Worker job: render and deliver one outbox event. */
export const notificationDispatchJobSchema = z.object({ eventId: z.uuid() });
export type NotificationDispatchJob = z.infer<typeof notificationDispatchJobSchema>;

// ---- Support ----------------------------------------------------------------------------

export const supportCategorySchema = z.enum(SUPPORT_TICKET_CATEGORIES);
export const supportStatusSchema = z.enum(SUPPORT_TICKET_STATUSES);
export const supportPrioritySchema = z.enum(SUPPORT_PRIORITIES);
export const createTicketSchema = z
  .object({
    subject: z.string().trim().min(4, 'Enter a subject').max(160),
    category: supportCategorySchema,
    /** Set for a question about one store's part of an order (goes to that seller). */
    sellerOrderId: z.uuid().nullable().optional(),
    body: z.string().trim().min(5, 'Describe the problem').max(5000),
  })
  .strict();
export type CreateTicketRequest = z.input<typeof createTicketSchema>;
export const ticketMessageInputSchema = z
  .object({
    body: z.string().trim().min(1, 'Write a message').max(5000),
    /** Seller team and staff only: a note the customer does not see. */
    internal: z.boolean().default(false),
  })
  .strict();
export type TicketMessageInput = z.input<typeof ticketMessageInputSchema>;

export const ticketMessageSchema = z.object({
  id: z.uuid(),
  authorRole: z.enum(SUPPORT_AUTHOR_ROLES),
  authorName: z.string(),
  body: z.string(),
  internal: z.boolean(),
  attachments: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      contentType: z.string(),
      sizeBytes: z.number().int(),
    }),
  ),
  createdAt: z.iso.datetime(),
});
export type TicketMessageDto = z.infer<typeof ticketMessageSchema>;
export const ticketSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  subject: z.string(),
  category: supportCategorySchema,
  status: supportStatusSchema,
  priority: supportPrioritySchema,
  customer: z.object({ id: z.uuid(), name: z.string() }),
  store: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  orderNumber: z.string().nullable(),
  sellerOrderNumber: z.string().nullable(),
  assignedTo: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  supportJoined: z.boolean(),
  lastMessageAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export const ticketListSchema = paginatedSchema(ticketSummarySchema);
export type TicketList = z.infer<typeof ticketListSchema>;
export const ticketDetailSchema = ticketSummarySchema.extend({
  messages: z.array(ticketMessageSchema),
  /** What the viewer may do. */
  can: z.object({
    reply: z.boolean(),
    internalNote: z.boolean(),
    resolve: z.boolean(),
    close: z.boolean(),
    reopen: z.boolean(),
    join: z.boolean(),
    takeOver: z.boolean(),
    assign: z.boolean(),
  }),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
export const ticketListQuerySchema = paginationQuerySchema.extend({
  status: supportStatusSchema.optional(),
  open: z.enum(['true', 'false']).optional(),
  category: supportCategorySchema.optional(),
  sellerId: z.uuid().optional(),
  assigned: z.enum(['me', 'none']).optional(),
  search: z.string().trim().max(100).optional(),
});
export const ticketActionSchema = z
  .object({
    action: z.enum(['RESOLVE', 'CLOSE', 'REOPEN', 'JOIN', 'TAKE_OVER', 'ASSIGN', 'PRIORITY']),
    assignedToId: z.uuid().nullable().optional(),
    priority: supportPrioritySchema.optional(),
    note: optionalText(500),
  })
  .strict();
export type TicketActionRequest = z.input<typeof ticketActionSchema>;

// ---- Analytics --------------------------------------------------------------------------

export const reportGranularitySchema = z.enum(REPORT_GRANULARITIES);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const reportQuerySchema = z
  .object({
    /** Inclusive dates in Philippine time. Default: the last 30 days. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    granularity: reportGranularitySchema.default('day'),
    sellerId: z.uuid().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start must be on or before the end',
    path: ['to'],
  });
export type ReportQuery = z.input<typeof reportQuerySchema>;
export type ReportQueryParsed = z.output<typeof reportQuerySchema>;

export const ADMIN_REPORTS = [
  'sales',
  'products',
  'categories',
  'sellers',
  'customers',
  'payments',
  'refunds',
] as const;
export type AdminReportName = (typeof ADMIN_REPORTS)[number];
export const SELLER_REPORTS = [
  'sales',
  'products',
  'inventory',
  'ratings',
  'commissions',
  'settlements',
] as const;
export type SellerReportName = (typeof SELLER_REPORTS)[number];
export const reportExportQuerySchema = z
  .object({
    format: z.enum(REPORT_FORMATS).default('csv'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    granularity: reportGranularitySchema.default('day'),
    sellerId: z.uuid().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start must be on or before the end',
    path: ['to'],
  });

const kpi = z.object({ key: z.string(), label: z.string(), value: z.string(), unit: z.string() });
export const reportSeriesPointSchema = z.object({
  period: z.string(),
  values: z.record(z.string(), z.string()),
});
/** Every report: KPI cards, a time series and a table, with the filters that produced them. */
export const reportSchema = z.object({
  name: z.string(),
  title: z.string(),
  range: z.object({ from: z.string(), to: z.string(), granularity: reportGranularitySchema }),
  kpis: z.array(kpi),
  series: z.object({
    keys: z.array(z.object({ key: z.string(), label: z.string(), unit: z.string() })),
    points: z.array(reportSeriesPointSchema),
  }),
  table: z.object({
    columns: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(['text', 'money', 'number', 'percent']),
      }),
    ),
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  }),
  generatedAt: z.iso.datetime(),
});
export type ReportDto = z.infer<typeof reportSchema>;
