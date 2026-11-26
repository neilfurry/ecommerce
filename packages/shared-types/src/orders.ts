/**
 * Order management, payments, shipments, returns and refunds (Phase 5): statuses, labels and
 * the seller order state machine, shared by the API, the worker and the apps.
 */

export const ORDER_STATUSES = ['AWAITING_PAYMENT', 'PLACED', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Waiting for payment',
  PLACED: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const SELLER_ORDER_STATUSES = [
  'AWAITING_PAYMENT',
  'PENDING',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'SHIPPED',
  'DELIVERY_FAILED',
  'RETURNING_TO_SELLER',
  'RETURNED_TO_SELLER',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type SellerOrderStatus = (typeof SELLER_ORDER_STATUSES)[number];
export const SELLER_ORDER_STATUS_LABELS: Record<SellerOrderStatus, string> = {
  AWAITING_PAYMENT: 'Waiting for payment',
  PENDING: 'New',
  PROCESSING: 'Processing',
  READY_FOR_PICKUP: 'Ready for pickup',
  SHIPPED: 'Shipped',
  DELIVERY_FAILED: 'Delivery failed',
  RETURNING_TO_SELLER: 'Returning to seller',
  RETURNED_TO_SELLER: 'Returned to seller',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
/** No further transition is possible. */
export const FINAL_SELLER_ORDER_STATUSES: readonly SellerOrderStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'RETURNED_TO_SELLER',
];

/** Who causes a transition. COURIER and PROVIDER are verified webhooks; SYSTEM is a job. */
export const ORDER_ACTORS = [
  'CUSTOMER',
  'SELLER',
  'STAFF',
  'COURIER',
  'PROVIDER',
  'SYSTEM',
] as const;
export type OrderActor = (typeof ORDER_ACTORS)[number];

export interface SellerOrderTransition {
  from: SellerOrderStatus;
  to: SellerOrderStatus;
  actors: readonly OrderActor[];
}

/**
 * Every allowed seller order transition and who may make it. Anything not listed is refused.
 * Customers cancel directly only before the seller accepts; afterwards they ask the seller
 * (cancellation request). Couriers move parcels; sellers do so only for self-arranged
 * deliveries (the API checks the shipment's carrier).
 */
export const SELLER_ORDER_TRANSITIONS: readonly SellerOrderTransition[] = [
  { from: 'AWAITING_PAYMENT', to: 'PENDING', actors: ['PROVIDER', 'STAFF'] },
  { from: 'AWAITING_PAYMENT', to: 'CANCELLED', actors: ['CUSTOMER', 'STAFF', 'SYSTEM'] },
  { from: 'PENDING', to: 'PROCESSING', actors: ['SELLER', 'STAFF'] },
  { from: 'PENDING', to: 'CANCELLED', actors: ['CUSTOMER', 'SELLER', 'STAFF'] },
  { from: 'PROCESSING', to: 'READY_FOR_PICKUP', actors: ['SELLER', 'STAFF'] },
  { from: 'PROCESSING', to: 'CANCELLED', actors: ['SELLER', 'STAFF'] },
  { from: 'READY_FOR_PICKUP', to: 'PROCESSING', actors: ['SELLER', 'STAFF'] },
  { from: 'READY_FOR_PICKUP', to: 'SHIPPED', actors: ['COURIER', 'SELLER', 'STAFF'] },
  { from: 'READY_FOR_PICKUP', to: 'CANCELLED', actors: ['SELLER', 'STAFF'] },
  { from: 'SHIPPED', to: 'DELIVERED', actors: ['COURIER', 'SELLER', 'CUSTOMER', 'STAFF'] },
  { from: 'SHIPPED', to: 'DELIVERY_FAILED', actors: ['COURIER', 'SELLER', 'STAFF'] },
  { from: 'SHIPPED', to: 'RETURNING_TO_SELLER', actors: ['COURIER', 'STAFF'] },
  { from: 'DELIVERY_FAILED', to: 'SHIPPED', actors: ['COURIER', 'SELLER', 'STAFF'] },
  { from: 'DELIVERY_FAILED', to: 'DELIVERED', actors: ['COURIER', 'SELLER', 'STAFF'] },
  { from: 'DELIVERY_FAILED', to: 'RETURNING_TO_SELLER', actors: ['COURIER', 'SELLER', 'STAFF'] },
  { from: 'RETURNING_TO_SELLER', to: 'RETURNED_TO_SELLER', actors: ['COURIER', 'SELLER', 'STAFF'] },
  { from: 'DELIVERED', to: 'COMPLETED', actors: ['CUSTOMER', 'STAFF', 'SYSTEM'] },
];

export function findTransition(
  from: SellerOrderStatus,
  to: SellerOrderStatus,
): SellerOrderTransition | undefined {
  return SELLER_ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** Whether `actor` may move a seller order from `from` to `to`. */
export function canTransition(
  from: SellerOrderStatus,
  to: SellerOrderStatus,
  actor: OrderActor,
): boolean {
  return findTransition(from, to)?.actors.includes(actor) ?? false;
}

/** Statuses `actor` may move a seller order to from `from`. */
export function nextStatuses(from: SellerOrderStatus, actor: OrderActor): SellerOrderStatus[] {
  return SELLER_ORDER_TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map(
    (t) => t.to,
  );
}

/** Seller Center order tabs. */
export const SELLER_ORDER_TABS = {
  NEW: ['PENDING'],
  PROCESSING: ['PROCESSING'],
  READY_FOR_PICKUP: ['READY_FOR_PICKUP'],
  SHIPPED: ['SHIPPED', 'DELIVERY_FAILED', 'RETURNING_TO_SELLER'],
  COMPLETED: ['DELIVERED', 'COMPLETED'],
  CANCELLED: ['CANCELLED', 'RETURNED_TO_SELLER'],
} as const satisfies Record<string, readonly SellerOrderStatus[]>;
export type SellerOrderTab = keyof typeof SELLER_ORDER_TABS;
export const SELLER_ORDER_TAB_LABELS: Record<SellerOrderTab, string> = {
  NEW: 'New',
  PROCESSING: 'Processing',
  READY_FOR_PICKUP: 'Ready for pickup',
  SHIPPED: 'Shipped',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled and returned',
};

export const ORDER_EVENT_TYPES = [
  'PLACED',
  'AWAITING_PAYMENT',
  'CANCELLED_BY_CUSTOMER',
  'PAYMENT_EXPIRED',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'STATUS_CHANGED',
  'CANCELLED_BY_SELLER',
  'CANCELLED_BY_STAFF',
  'CANCELLATION_REQUESTED',
  'CANCELLATION_APPROVED',
  'CANCELLATION_REJECTED',
  'SHIPMENT_CREATED',
  'SHIPMENT_UPDATED',
  'COD_COLLECTED',
  'COD_REMITTED',
  'RETURN_REQUESTED',
  'RETURN_UPDATED',
  'REFUND_CREATED',
  'REFUND_SUCCEEDED',
  'REFUND_FAILED',
  'NOTE_ADDED',
  'PAYMENT_PROOF_SUBMITTED',
  'PAYMENT_PROOF_REJECTED',
] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  PLACED: 'Order placed',
  AWAITING_PAYMENT: 'Waiting for payment',
  CANCELLED_BY_CUSTOMER: 'Cancelled by the customer',
  PAYMENT_EXPIRED: 'Cancelled: not paid in time',
  PAYMENT_RECEIVED: 'Payment received',
  PAYMENT_FAILED: 'Payment failed',
  STATUS_CHANGED: 'Status changed',
  CANCELLED_BY_SELLER: 'Cancelled by the seller',
  CANCELLED_BY_STAFF: 'Cancelled by the marketplace',
  CANCELLATION_REQUESTED: 'Cancellation requested',
  CANCELLATION_APPROVED: 'Cancellation approved',
  CANCELLATION_REJECTED: 'Cancellation declined',
  SHIPMENT_CREATED: 'Shipment booked',
  SHIPMENT_UPDATED: 'Shipment update',
  COD_COLLECTED: 'Cash collected by the courier',
  COD_REMITTED: 'Cash remitted to the marketplace',
  RETURN_REQUESTED: 'Return requested',
  RETURN_UPDATED: 'Return update',
  REFUND_CREATED: 'Refund started',
  REFUND_SUCCEEDED: 'Refunded',
  REFUND_FAILED: 'Refund failed',
  NOTE_ADDED: 'Note',
  PAYMENT_PROOF_SUBMITTED: 'Transfer proof uploaded',
  PAYMENT_PROOF_REJECTED: 'Transfer proof not accepted',
};

// ---- Payments ------------------------------------------------------------------------------

export const PAYMENT_STATUSES = [
  'PENDING',
  'PAY_ON_DELIVERY',
  'PARTIALLY_PAID',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'VOIDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Waiting for payment',
  PAY_ON_DELIVERY: 'Pay on delivery',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  VOIDED: 'Not charged',
};

export const PAYMENT_PROVIDERS = [
  'MOCK',
  'PAYMONGO',
  'MAYA_BUSINESS',
  'XENDIT',
  'MANUAL_BANK',
  'COD',
] as const;
export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];
export const PAYMENT_PROVIDER_LABELS: Record<PaymentProviderCode, string> = {
  MOCK: 'Mock (test payments)',
  PAYMONGO: 'PayMongo',
  MAYA_BUSINESS: 'Maya Business',
  XENDIT: 'Xendit',
  MANUAL_BANK: 'Bank transfer',
  COD: 'Cash on delivery',
};
/** Providers that can take online payments (GCash, Maya, cards, QR Ph). */
export const ONLINE_PAYMENT_PROVIDERS = ['MOCK', 'PAYMONGO', 'MAYA_BUSINESS', 'XENDIT'] as const;
export type OnlinePaymentProvider = (typeof ONLINE_PAYMENT_PROVIDERS)[number];

export const PAYMENT_ATTEMPT_STATUSES = [
  'CREATED',
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];
export const PAYMENT_ATTEMPT_STATUS_LABELS: Record<PaymentAttemptStatus, string> = {
  CREATED: 'Starting',
  PENDING: 'Waiting',
  PAID: 'Paid',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

/** Why finance must look at a payment. */
export const PAYMENT_REVIEW_REASONS = [
  'AMOUNT_MISMATCH',
  'LATE_PAYMENT',
  'DUPLICATE_PAYMENT',
  'PROVIDER_MISMATCH',
] as const;
export type PaymentReviewReason = (typeof PAYMENT_REVIEW_REASONS)[number];
export const PAYMENT_REVIEW_REASON_LABELS: Record<PaymentReviewReason, string> = {
  AMOUNT_MISMATCH: 'Paid amount differs from the order',
  LATE_PAYMENT: 'Paid after the order was cancelled',
  DUPLICATE_PAYMENT: 'Order was already paid',
  PROVIDER_MISMATCH: 'Provider status differs from ours',
};

export const PROOF_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

/** Bank transfers may be paid within this many hours (configurable). */
export const DEFAULT_BANK_TRANSFER_WINDOW_HOURS = 24;

// ---- Shipping ------------------------------------------------------------------------------

export const CARRIERS = ['MOCK', 'SELF', 'JNT', 'LBC', 'NINJA_VAN', 'FLASH', 'TWO_GO'] as const;
export type Carrier = (typeof CARRIERS)[number];
export const CARRIER_LABELS: Record<Carrier, string> = {
  MOCK: 'Mock courier (test)',
  SELF: 'Arranged by the seller',
  JNT: 'J&T Express',
  LBC: 'LBC',
  NINJA_VAN: 'Ninja Van',
  FLASH: 'Flash Express',
  TWO_GO: '2GO',
};

export const SHIPMENT_STATUSES = [
  'BOOKED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  BOOKED: 'Booked, waiting for pickup',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery attempt failed',
  RETURNING: 'Returning to sender',
  RETURNED: 'Returned to sender',
  CANCELLED: 'Cancelled',
};
/** Shipment statuses a parcel can move to from each status. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  // Couriers often report the first scan as in transit (or even delivered) without a pickup event.
  BOOKED: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING'],
  IN_TRANSIT: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'IN_TRANSIT'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'DELIVERED', 'RETURNING'],
  RETURNING: ['RETURNED'],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};
/** The seller order status a forward shipment's status puts its seller order in. */
export const SHIPMENT_TO_SELLER_ORDER_STATUS: Record<ShipmentStatus, SellerOrderStatus | null> = {
  BOOKED: 'READY_FOR_PICKUP',
  PICKED_UP: 'SHIPPED',
  IN_TRANSIT: 'SHIPPED',
  OUT_FOR_DELIVERY: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETURNING: 'RETURNING_TO_SELLER',
  RETURNED: 'RETURNED_TO_SELLER',
  CANCELLED: null,
};

export const COD_COLLECTION_STATUSES = ['PENDING', 'COLLECTED', 'REMITTED', 'FAILED'] as const;
export type CodCollectionStatus = (typeof COD_COLLECTION_STATUSES)[number];
export const COD_COLLECTION_STATUS_LABELS: Record<CodCollectionStatus, string> = {
  PENDING: 'To collect',
  COLLECTED: 'Collected, not remitted',
  REMITTED: 'Remitted',
  FAILED: 'Not collected',
};

export const CANCELLATION_REQUEST_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type CancellationRequestStatus = (typeof CANCELLATION_REQUEST_STATUSES)[number];

export const NOTE_VISIBILITIES = ['CUSTOMER', 'SELLER', 'STAFF'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];
export const NOTE_VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  CUSTOMER: 'Customer, seller and staff',
  SELLER: 'Seller and staff',
  STAFF: 'Staff only',
};

// ---- Returns and refunds --------------------------------------------------------------------

export const RETURN_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'ESCALATED',
  'RETURN_SHIPPED',
  'RECEIVED',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  REQUESTED: 'Waiting for the seller',
  APPROVED: 'Approved',
  REJECTED: 'Declined by the seller',
  ESCALATED: 'Under marketplace review',
  RETURN_SHIPPED: 'Item sent back',
  RECEIVED: 'Item received by the seller',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Withdrawn',
};
/** Returns still being worked on. */
export const OPEN_RETURN_STATUSES: readonly ReturnStatus[] = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'ESCALATED',
  'RETURN_SHIPPED',
  'RECEIVED',
];

export const RETURN_REASONS = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'MISSING_PARTS',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'OTHER',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  DAMAGED: 'Arrived damaged',
  DEFECTIVE: 'Does not work',
  WRONG_ITEM: 'Wrong item',
  MISSING_PARTS: 'Missing parts or accessories',
  NOT_AS_DESCRIBED: 'Not as described',
  CHANGED_MIND: 'Changed my mind',
  OTHER: 'Other',
};

export const RETURN_RESOLUTIONS = [
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'REPLACEMENT',
  'REJECTED',
] as const;
export type ReturnResolution = (typeof RETURN_RESOLUTIONS)[number];
export const RETURN_RESOLUTION_LABELS: Record<ReturnResolution, string> = {
  FULL_REFUND: 'Full refund',
  PARTIAL_REFUND: 'Partial refund',
  REPLACEMENT: 'Replacement',
  REJECTED: 'No refund',
};

export const REFUND_STATUSES = ['PROCESSING', 'AWAITING_PAYOUT', 'SUCCEEDED', 'FAILED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  PROCESSING: 'Processing',
  AWAITING_PAYOUT: 'Waiting for payout',
  SUCCEEDED: 'Refunded',
  FAILED: 'Failed',
};
export const REFUND_REASONS = [
  'CANCELLATION',
  'RETURN',
  'LATE_PAYMENT',
  'DUPLICATE_PAYMENT',
  'GOODWILL',
  'OTHER',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  CANCELLATION: 'Cancelled order',
  RETURN: 'Return',
  LATE_PAYMENT: 'Paid after cancellation',
  DUPLICATE_PAYMENT: 'Duplicate payment',
  GOODWILL: 'Goodwill',
  OTHER: 'Other',
};

export const SELLER_LEDGER_TYPES = [
  'ORDER_EARNING',
  'COMMISSION',
  'SHIPPING_CREDIT',
  'REFUND',
  'COMMISSION_REVERSAL',
  'ADJUSTMENT',
] as const;
export type SellerLedgerType = (typeof SELLER_LEDGER_TYPES)[number];
export const SELLER_LEDGER_TYPE_LABELS: Record<SellerLedgerType, string> = {
  ORDER_EARNING: 'Sale',
  COMMISSION: 'Commission',
  SHIPPING_CREDIT: 'Shipping fee',
  REFUND: 'Refund',
  COMMISSION_REVERSAL: 'Commission returned',
  ADJUSTMENT: 'Adjustment',
};

/**
 * Phase 6: kinds of seller payable lines in the double-entry ledger (journal_entries.kind),
 * as shown to sellers and staff.
 */
export const LEDGER_KIND_LABELS: Record<string, string> = {
  SALE: 'Sale',
  COMMISSION: 'Commission',
  COMMISSION_REVERSAL: 'Commission returned',
  PAYMENT_FEE: 'Payment fee',
  COD_FEE: 'COD fee',
  SHIPPING_CREDIT: 'Shipping fee',
  REFUND: 'Refund',
  SETTLEMENT: 'Settlement',
  WITHHOLDING: 'Withholding tax',
  PAYOUT: 'Payout',
  RESERVE: 'Reserve',
  ADJUSTMENT: 'Adjustment',
  ORDER_EARNING: 'Sale',
};
export const ledgerKindLabel = (kind: string | null | undefined) =>
  (kind && LEDGER_KIND_LABELS[kind]) ?? kind ?? 'Adjustment';

/** Default return window after delivery and seller response time (configurable). */
export const DEFAULT_RETURN_WINDOW_DAYS = 7;
export const DEFAULT_RETURN_RESPONSE_DAYS = 3;
export const MAX_RETURN_IMAGES = 5;
