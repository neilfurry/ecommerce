/**
 * Marketing and customer engagement constants (Phase 7), shared by the API, the worker and
 * the apps: promotions, loyalty, referrals and affiliates, reviews, notifications and support.
 */

export const PROMOTION_APPLIES_TO = ['ALL', 'PRODUCTS', 'CATEGORIES'] as const;
export type PromotionAppliesTo = (typeof PROMOTION_APPLIES_TO)[number];
export const PROMOTION_APPLIES_TO_LABELS: Record<PromotionAppliesTo, string> = {
  ALL: 'All items',
  PRODUCTS: 'Selected products',
  CATEGORIES: 'Selected categories',
};
/** Products or categories one coupon or campaign may list. */
export const MAX_PROMOTION_TARGETS = 200;

export const CAMPAIGN_TYPES = [
  'PERCENTAGE_OFF',
  'FIXED_OFF',
  'BUNDLE',
  'BUY_X_GET_Y',
  'FREE_SHIPPING',
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  PERCENTAGE_OFF: 'Percent off items',
  FIXED_OFF: 'Amount off each item',
  BUNDLE: 'Bundle discount',
  BUY_X_GET_Y: 'Buy X, get Y',
  FREE_SHIPPING: 'Free shipping',
};

export const LOYALTY_TRANSACTION_TYPES = [
  'EARN',
  'REDEEM',
  'RESTORE',
  'REVERSE',
  'EXPIRE',
  'ADJUST',
  'REFERRAL_BONUS',
] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];
export const LOYALTY_TRANSACTION_LABELS: Record<LoyaltyTransactionType, string> = {
  EARN: 'Earned',
  REDEEM: 'Used at checkout',
  RESTORE: 'Given back',
  REVERSE: 'Taken back (refund)',
  EXPIRE: 'Expired',
  ADJUST: 'Adjustment',
  REFERRAL_BONUS: 'Referral bonus',
};

export const REFERRAL_STATUSES = ['PENDING', 'REWARDED', 'VOID'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const AFFILIATE_STATUSES = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] as const;
export type AffiliateStatus = (typeof AFFILIATE_STATUSES)[number];
export const AFFILIATE_CONVERSION_STATUSES = ['PENDING', 'ACCRUED', 'CANCELLED', 'PAID'] as const;
export type AffiliateConversionStatus = (typeof AFFILIATE_CONVERSION_STATUSES)[number];
/** Query parameter of affiliate links: https://shop.example/?aff=CODE */
export const AFFILIATE_QUERY_PARAM = 'aff';

export const MAX_REVIEW_IMAGES = 5;
export const REVIEW_REPORT_REASONS = [
  'SPAM',
  'OFFENSIVE',
  'OFF_TOPIC',
  'FAKE',
  'PERSONAL_INFORMATION',
  'OTHER',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];
export const REVIEW_REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  SPAM: 'Spam or advertising',
  OFFENSIVE: 'Offensive or abusive',
  OFF_TOPIC: 'Not about the product',
  FAKE: 'Fake or misleading',
  PERSONAL_INFORMATION: 'Shares personal information',
  OTHER: 'Something else',
};
export const REVIEW_REPORT_STATUSES = ['OPEN', 'UPHELD', 'DISMISSED'] as const;
export type ReviewReportStatus = (typeof REVIEW_REPORT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'IN_APP', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  IN_APP: 'In-app',
  PUSH: 'Push',
};

/**
 * Events that notify people. builtInEmail: the email for this event is a built-in
 * transactional email (with order details), so there is no editable EMAIL template.
 */
export const NOTIFICATION_EVENTS = {
  CUSTOMER_REGISTERED: {
    label: 'Customer registration',
    audience: 'customer',
    variables: ['appName', 'firstName'],
    builtInEmail: false,
  },
  ORDER_PLACED: {
    label: 'Order confirmation',
    audience: 'customer',
    variables: ['appName', 'firstName', 'orderNumber', 'total'],
    builtInEmail: true,
  },
  SELLER_NEW_ORDER: {
    label: 'New order (seller)',
    audience: 'seller',
    variables: ['appName', 'orderNumber', 'storeName'],
    builtInEmail: true,
  },
  PAYMENT_CONFIRMED: {
    label: 'Payment confirmation',
    audience: 'customer',
    variables: ['appName', 'firstName', 'orderNumber', 'amount'],
    builtInEmail: false,
  },
  ORDER_SHIPPED: {
    label: 'Shipment',
    audience: 'customer',
    variables: ['appName', 'firstName', 'orderNumber', 'storeName', 'carrier', 'trackingNumber'],
    builtInEmail: false,
  },
  ORDER_DELIVERED: {
    label: 'Delivery',
    audience: 'customer',
    variables: ['appName', 'firstName', 'orderNumber', 'storeName'],
    builtInEmail: false,
  },
  REFUND_APPROVED: {
    label: 'Refund approval',
    audience: 'customer',
    variables: ['appName', 'firstName', 'orderNumber', 'amount'],
    builtInEmail: false,
  },
  PAYOUT_PAID: {
    label: 'Seller payout',
    audience: 'seller',
    variables: ['appName', 'sellerName', 'reference', 'amount'],
    builtInEmail: false,
  },
  LOW_STOCK: {
    label: 'Low inventory',
    audience: 'seller',
    variables: ['appName', 'count'],
    builtInEmail: true,
  },
  LOYALTY_POINTS_EARNED: {
    label: 'Loyalty points earned',
    audience: 'customer',
    variables: ['appName', 'firstName', 'orderNumber', 'points', 'balance'],
    builtInEmail: false,
  },
  SUPPORT_TICKET_UPDATED: {
    label: 'Support ticket update',
    audience: 'any',
    variables: ['appName', 'ticketNumber', 'subject', 'summary'],
    builtInEmail: false,
  },
  REVIEW_REPLIED: {
    label: 'Seller replied to a review',
    audience: 'customer',
    variables: ['appName', 'storeName', 'productName'],
    builtInEmail: false,
  },
  ORDER_UPDATE: {
    label: 'Other order updates (cancellations, returns...)',
    audience: 'any',
    variables: ['appName', 'orderNumber', 'title', 'message'],
    builtInEmail: true,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    audience: 'customer' | 'seller' | 'any';
    variables: readonly string[];
    builtInEmail: boolean;
  }
>;
export type NotificationEventCode = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_EVENT_CODES = Object.keys(NOTIFICATION_EVENTS) as NotificationEventCode[];

export const SUPPORT_TICKET_CATEGORIES = [
  'ORDER',
  'PRODUCT',
  'PAYMENT',
  'SHIPPING',
  'RETURN_REFUND',
  'ACCOUNT',
  'OTHER',
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];
export const SUPPORT_TICKET_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  ORDER: 'Order',
  PRODUCT: 'Product',
  PAYMENT: 'Payment',
  SHIPPING: 'Shipping',
  RETURN_REFUND: 'Return or refund',
  ACCOUNT: 'Account',
  OTHER: 'Other',
};
export const SUPPORT_TICKET_STATUSES = [
  'OPEN',
  'AWAITING_SELLER',
  'AWAITING_SUPPORT',
  'AWAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];
export const SUPPORT_TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: 'Open',
  AWAITING_SELLER: 'Waiting for the seller',
  AWAITING_SUPPORT: 'Waiting for support',
  AWAITING_CUSTOMER: 'Waiting for you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export const SUPPORT_AUTHOR_ROLES = ['CUSTOMER', 'SELLER', 'SUPPORT', 'SYSTEM'] as const;
export type SupportAuthorRole = (typeof SUPPORT_AUTHOR_ROLES)[number];
export const MAX_SUPPORT_ATTACHMENTS = 5;

export const REPORT_GRANULARITIES = ['day', 'week', 'month', 'year'] as const;
export type ReportGranularity = (typeof REPORT_GRANULARITIES)[number];
export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
