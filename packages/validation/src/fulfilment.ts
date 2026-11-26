/**
 * Phase 5: payments, shipments, cash on delivery, cancellations, notes, returns, refunds and
 * seller payables. (checkout.ts imports from here; this file does not import checkout.ts.)
 */
import {
  CANCELLATION_REQUEST_STATUSES,
  CARRIERS,
  COD_COLLECTION_STATUSES,
  MAX_RETURN_IMAGES,
  NOTE_VISIBILITIES,
  ORDER_ACTORS,
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_REVIEW_REASONS,
  PROOF_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
  RETURN_REASONS,
  RETURN_RESOLUTIONS,
  RETURN_STATUSES,
  SELLER_LEDGER_TYPES,
  SELLER_ORDER_STATUSES,
  SELLER_ORDER_TABS,
  SHIPMENT_STATUSES,
  WEBHOOK_EVENT_STATUSES,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { decimalStringSchema, paginationQuerySchema } from './common';
import { paginatedSchema } from './dev-tools';

const methodSchema = z.enum(PAYMENT_METHODS);
export const paymentAttemptStatusSchema = z.enum(PAYMENT_ATTEMPT_STATUSES);
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export const carrierSchema = z.enum(CARRIERS);
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);
export const codCollectionStatusSchema = z.enum(COD_COLLECTION_STATUSES);
export const returnStatusSchema = z.enum(RETURN_STATUSES);
export const returnReasonSchema = z.enum(RETURN_REASONS);
export const returnResolutionSchema = z.enum(RETURN_RESOLUTIONS);
export const refundStatusSchema = z.enum(REFUND_STATUSES);
export const refundReasonSchema = z.enum(REFUND_REASONS);
export const noteVisibilitySchema = z.enum(NOTE_VISIBILITIES);
export const orderActorSchema = z.enum(ORDER_ACTORS);
export const sellerOrderTabSchema = z.enum(
  Object.keys(SELLER_ORDER_TABS) as [
    keyof typeof SELLER_ORDER_TABS,
    ...(keyof typeof SELLER_ORDER_TABS)[],
  ],
);
const fulfilmentStatusSchema = z.enum(SELLER_ORDER_STATUSES);

const reasonText = (min = 3, max = 500) =>
  z.string().trim().min(min, `At least ${min} characters`).max(max);
const iso = () => z.iso.datetime();

// ---- Settings ----------------------------------------------------------------------------

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2).max(80),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9 -]{6,30}$/, 'Digits, spaces and dashes only'),
  branch: z.string().trim().max(80).nullable().default(null),
});
export type BankAccount = z.infer<typeof bankAccountSchema>;

/** Orders, payments, cash on delivery, returns and couriers (Admin Console › Settings). */
export const orderSettingsSchema = z.object({
  bankTransfer: z.object({
    /** Hours a bank-transfer order waits for the customer's transfer and proof. */
    windowHours: z.coerce.number().int().min(1).max(72),
    /** The marketplace's receiving accounts, shown to customers who choose bank transfer. */
    accounts: z.array(bankAccountSchema).max(3),
    instructions: z.string().trim().max(1000),
  }),
  cod: z.object({
    /** Largest order total that may be paid on delivery. */
    maxOrderAmount: decimalStringSchema({ scale: 2 }),
    /** Customers with this many failed COD deliveries cannot choose COD (0: no limit). */
    maxFailedDeliveries: z.coerce.number().int().min(0).max(20),
  }),
  returns: z.object({
    windowDays: z.coerce.number().int().min(0).max(30),
    sellerResponseDays: z.coerce.number().int().min(1).max(14),
  }),
  /** Couriers sellers may book. Prepared couriers can be enabled only once configured. */
  carriers: z.record(carrierSchema, z.boolean()),
});
export type OrderSettings = z.infer<typeof orderSettingsSchema>;
export type OrderSettingsInput = z.input<typeof orderSettingsSchema>;

export const carrierStatusSchema = z.object({
  carrier: carrierSchema,
  label: z.string(),
  enabled: z.boolean(),
  /** An adapter that can book shipments exists and has what it needs. */
  available: z.boolean(),
  livemode: z.boolean(),
  /** Why it cannot be used yet, e.g. missing credentials or documentation. */
  note: z.string().nullable(),
});
export type CarrierStatus = z.infer<typeof carrierStatusSchema>;
export const carrierListSchema = z.object({ items: z.array(carrierStatusSchema) });

export const paymentGatewayStatusSchema = z.object({
  provider: paymentProviderSchema,
  label: z.string(),
  active: z.boolean(),
  livemode: z.boolean(),
  methods: z.array(methodSchema),
  note: z.string().nullable(),
});
export type PaymentGatewayStatus = z.infer<typeof paymentGatewayStatusSchema>;
export const paymentGatewayListSchema = z.object({ items: z.array(paymentGatewayStatusSchema) });

// ---- Payments ----------------------------------------------------------------------------

export const bankInstructionsSchema = z.object({
  reference: z.string(),
  amount: z.string(),
  accounts: z.array(bankAccountSchema),
  instructions: z.string(),
  dueAt: iso().nullable(),
});
export type BankInstructions = z.infer<typeof bankInstructionsSchema>;

export const proofSchema = z.object({
  id: z.uuid(),
  status: z.enum(PROOF_STATUSES),
  bankName: z.string(),
  referenceNumber: z.string(),
  amount: z.string(),
  transferredAt: iso(),
  rejectionReason: z.string().nullable(),
  createdAt: iso(),
  reviewedAt: iso().nullable(),
});
export type ProofDto = z.infer<typeof proofSchema>;

/** A payment attempt as the customer sees it. */
export const paymentAttemptSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  method: methodSchema,
  provider: paymentProviderSchema,
  status: paymentAttemptStatusSchema,
  amount: z.string(),
  /** Mock or sandbox: no real money moved. */
  test: z.boolean(),
  /** Where to pay (open online attempts only). */
  checkoutUrl: z.string().nullable(),
  expiresAt: iso().nullable(),
  paidAt: iso().nullable(),
  failureMessage: z.string().nullable(),
  proofs: z.array(proofSchema),
  createdAt: iso(),
});
export type PaymentAttemptDto = z.infer<typeof paymentAttemptSchema>;

export const orderPaymentSchema = z.object({
  attempts: z.array(paymentAttemptSchema),
  /** The customer can start (or restart) an online payment. */
  canPay: z.boolean(),
  /** Bank transfer details while waiting for a transfer. */
  bankTransfer: bankInstructionsSchema.nullable(),
  /** A transfer proof can be uploaded now. */
  canUploadProof: z.boolean(),
  amountReceived: z.string(),
  amountRefunded: z.string(),
});
export type OrderPayment = z.infer<typeof orderPaymentSchema>;

export const startPaymentResponseSchema = z.object({
  payment: paymentAttemptSchema,
  checkoutUrl: z.string(),
});
export type StartPaymentResponse = z.infer<typeof startPaymentResponseSchema>;

export const bankProofInputSchema = z.object({
  bankName: z.string().trim().min(2).max(100),
  referenceNumber: z.string().trim().min(3).max(60),
  amount: decimalStringSchema({ scale: 2 }).refine((v) => Number(v) > 0, 'More than zero'),
  transferredAt: z.iso.datetime({ offset: true }),
});
export type BankProofInput = z.input<typeof bankProofInputSchema>;

export const paymentEventSchema = z.object({
  type: z.string(),
  fromStatus: paymentAttemptStatusSchema.nullable(),
  toStatus: paymentAttemptStatusSchema.nullable(),
  data: z.record(z.string(), z.unknown()),
  actorName: z.string().nullable(),
  webhookEventId: z.uuid().nullable(),
  createdAt: iso(),
});

export const adminPaymentSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  order: z.object({
    id: z.uuid(),
    orderNumber: z.string(),
    status: z.string(),
    paymentStatus: z.string(),
  }),
  customer: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  method: methodSchema,
  provider: paymentProviderSchema,
  status: paymentAttemptStatusSchema,
  livemode: z.boolean(),
  amount: z.string(),
  amountReceived: z.string(),
  refundedAmount: z.string(),
  providerReference: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  reviewReason: z.enum(PAYMENT_REVIEW_REASONS).nullable(),
  reviewedAt: iso().nullable(),
  expiresAt: iso().nullable(),
  paidAt: iso().nullable(),
  createdAt: iso(),
});
export type AdminPayment = z.infer<typeof adminPaymentSchema>;
export const adminPaymentListSchema = paginatedSchema(adminPaymentSchema);
export const adminPaymentDetailSchema = adminPaymentSchema.extend({
  events: z.array(paymentEventSchema),
  proofs: z.array(proofSchema),
  refunds: z.array(z.lazy(() => refundSchema)),
});
export type AdminPaymentDetail = z.infer<typeof adminPaymentDetailSchema>;
export const adminPaymentListQuerySchema = paginationQuerySchema.extend({
  status: paymentAttemptStatusSchema.optional(),
  provider: paymentProviderSchema.optional(),
  method: methodSchema.optional(),
  /** Only payments that need finance (review reason set and not resolved, or failed). */
  queue: z.enum(['review', 'failed']).optional(),
  search: z.string().trim().max(100).optional(),
});
export const resolvePaymentSchema = z.object({ note: reasonText(3, 500) });

export const webhookEventSchema = z.object({
  id: z.uuid(),
  source: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  livemode: z.boolean(),
  status: z.enum(WEBHOOK_EVENT_STATUSES),
  attempts: z.number().int(),
  error: z.string().nullable(),
  receivedAt: iso(),
  processedAt: iso().nullable(),
});
export type WebhookEventDto = z.infer<typeof webhookEventSchema>;
export const webhookEventListSchema = paginatedSchema(webhookEventSchema);
export const webhookEventListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(WEBHOOK_EVENT_STATUSES).optional(),
  source: z.string().max(40).optional(),
});

export const adminProofSchema = proofSchema.extend({
  payment: z.object({
    id: z.uuid(),
    reference: z.string(),
    amount: z.string(),
    status: paymentAttemptStatusSchema,
  }),
  order: z.object({
    id: z.uuid(),
    orderNumber: z.string(),
    status: z.string(),
    paymentDueAt: iso().nullable(),
  }),
  customer: z.object({ name: z.string(), email: z.string() }),
  reviewedBy: z.string().nullable(),
});
export type AdminProof = z.infer<typeof adminProofSchema>;
export const adminProofListSchema = paginatedSchema(adminProofSchema);
export const adminProofListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PROOF_STATUSES).optional(),
});
export const rejectProofSchema = z.object({ reason: reasonText(5, 500) });

export const reconciliationQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});
export const reconciliationSchema = z.object({
  from: z.string(),
  to: z.string(),
  byMethod: z.array(
    z.object({
      method: methodSchema,
      provider: paymentProviderSchema,
      livemode: z.boolean(),
      payments: z.number().int(),
      received: z.string(),
      refunded: z.string(),
      net: z.string(),
    }),
  ),
  cod: z.object({
    pendingCount: z.number().int(),
    pendingAmount: z.string(),
    collectedNotRemittedCount: z.number().int(),
    collectedNotRemittedAmount: z.string(),
    remittedAmount: z.string(),
    discrepancies: z.number().int(),
  }),
  exceptions: z.array(
    z.object({
      kind: z.string(),
      message: z.string(),
      orderId: z.uuid().nullable(),
      orderNumber: z.string().nullable(),
      paymentId: z.uuid().nullable(),
      refundId: z.uuid().nullable(),
      amount: z.string().nullable(),
    }),
  ),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

// ---- Shipments ---------------------------------------------------------------------------

export const shipmentEventSchema = z.object({
  id: z.uuid(),
  status: shipmentStatusSchema,
  description: z.string(),
  location: z.string().nullable(),
  occurredAt: iso(),
  source: z.string(),
});
export const shipmentSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['FORWARD', 'RETURN']),
  carrier: carrierSchema,
  carrierName: z.string(),
  serviceName: z.string(),
  trackingNumber: z.string(),
  status: shipmentStatusSchema,
  codAmount: z.string(),
  hasWaybill: z.boolean(),
  test: z.boolean(),
  failedAttempts: z.number().int(),
  pickedUpAt: iso().nullable(),
  deliveredAt: iso().nullable(),
  createdAt: iso(),
  events: z.array(shipmentEventSchema),
});
export type ShipmentDto = z.infer<typeof shipmentSchema>;

export const bookShipmentSchema = z
  .object({
    carrier: carrierSchema,
    /** Self-arranged deliveries: the courier used and its tracking number. */
    carrierName: z.string().trim().min(2).max(80).optional(),
    trackingNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,60}$/, 'Letters, digits and dashes (4–60)')
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.carrier === 'SELF') {
      if (!v.carrierName)
        ctx.addIssue({ code: 'custom', path: ['carrierName'], message: 'Which courier?' });
      if (!v.trackingNumber) {
        ctx.addIssue({
          code: 'custom',
          path: ['trackingNumber'],
          message: 'Enter the tracking number',
        });
      }
    }
  });
export type BookShipmentRequest = z.input<typeof bookShipmentSchema>;

/** Updates a parcel's status: sellers for self-arranged deliveries, staff for any. */
export const shipmentUpdateSchema = z.object({
  status: shipmentStatusSchema.exclude(['BOOKED', 'CANCELLED']),
  description: z.string().trim().max(300).optional(),
  location: z.string().trim().max(120).optional(),
});
export type ShipmentUpdateRequest = z.input<typeof shipmentUpdateSchema>;

export const adminShipmentSchema = shipmentSchema.extend({
  sellerOrder: z.object({ id: z.uuid(), number: z.string(), status: fulfilmentStatusSchema }),
  seller: z.object({ id: z.uuid(), businessName: z.string() }),
});
export const adminShipmentListSchema = paginatedSchema(adminShipmentSchema);
export const adminShipmentListQuerySchema = paginationQuerySchema.extend({
  status: shipmentStatusSchema.optional(),
  carrier: carrierSchema.optional(),
  search: z.string().trim().max(60).optional(),
});

// ---- Cash on delivery --------------------------------------------------------------------

export const codCollectionSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid(),
  sellerOrderNumber: z.string(),
  orderId: z.uuid(),
  carrier: carrierSchema.nullable(),
  trackingNumber: z.string().nullable(),
  sellerName: z.string(),
  expectedAmount: z.string(),
  collectedAmount: z.string().nullable(),
  status: codCollectionStatusSchema,
  collectedAt: iso().nullable(),
  remittanceId: z.uuid().nullable(),
});
export type CodCollectionDto = z.infer<typeof codCollectionSchema>;
export const codCollectionListSchema = paginatedSchema(codCollectionSchema);
export const codCollectionListQuerySchema = paginationQuerySchema.extend({
  status: codCollectionStatusSchema.optional(),
  carrier: carrierSchema.optional(),
});

export const recordRemittanceSchema = z.object({
  carrier: carrierSchema,
  reference: z.string().trim().min(3).max(80),
  remittedAt: z.iso.datetime({ offset: true }),
  amount: decimalStringSchema({ scale: 2 }),
  collectionIds: z.array(z.uuid()).min(1).max(500),
  /** Required when the amount differs from the collections' total. */
  discrepancyNote: z.string().trim().min(5).max(1000).optional(),
});
export type RecordRemittanceRequest = z.input<typeof recordRemittanceSchema>;
export const remittanceSchema = z.object({
  id: z.uuid(),
  carrier: carrierSchema,
  reference: z.string(),
  remittedAt: iso(),
  amount: z.string(),
  expectedAmount: z.string(),
  discrepancyNote: z.string().nullable(),
  collections: z.number().int(),
  recordedBy: z.string(),
  createdAt: iso(),
});
export type RemittanceDto = z.infer<typeof remittanceSchema>;
export const remittanceListSchema = paginatedSchema(remittanceSchema);

// ---- Cancellation requests and notes ------------------------------------------------------

export const cancellationRequestSchema = z.object({
  id: z.uuid(),
  status: z.enum(CANCELLATION_REQUEST_STATUSES),
  reason: z.string(),
  response: z.string().nullable(),
  createdAt: iso(),
  respondedAt: iso().nullable(),
});
export type CancellationRequestDto = z.infer<typeof cancellationRequestSchema>;
export const requestCancellationSchema = z.object({ reason: reasonText(5, 500) });
export const answerCancellationSchema = z.object({
  response: z.string().trim().max(500).optional(),
});
export const reasonSchema = z.object({ reason: reasonText(3, 500) });

export const orderNoteSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid().nullable(),
  authorType: z.string(),
  authorName: z.string(),
  visibility: noteVisibilitySchema,
  body: z.string(),
  createdAt: iso(),
});
export type OrderNoteDto = z.infer<typeof orderNoteSchema>;
export const addNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  visibility: noteVisibilitySchema.default('CUSTOMER'),
});
export type AddNoteRequest = z.input<typeof addNoteSchema>;

export const staffTransitionSchema = z.object({
  to: fulfilmentStatusSchema,
  note: reasonText(3, 500),
});

// ---- Returns -----------------------------------------------------------------------------

export const returnItemSchema = z.object({
  orderItemId: z.uuid(),
  productName: z.string(),
  variantTitle: z.string(),
  imageUrl: z.string().nullable(),
  quantity: z.number().int(),
  /** What the customer paid for these units. */
  amount: z.string(),
});
export const returnSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  sellerOrderId: z.uuid(),
  sellerOrderNumber: z.string(),
  store: z.object({ id: z.uuid(), name: z.string() }),
  customerName: z.string(),
  status: returnStatusSchema,
  reason: returnReasonSchema,
  description: z.string(),
  requestedResolution: returnResolutionSchema,
  resolution: returnResolutionSchema.nullable(),
  refundAmount: z.string().nullable(),
  /** Most that can be refunded for the returned items. */
  maxRefund: z.string(),
  requiresReturnShipment: z.boolean(),
  sellerResponse: z.string().nullable(),
  sellerDeadline: iso(),
  escalationNote: z.string().nullable(),
  staffDecisionNote: z.string().nullable(),
  restocked: z.boolean().nullable(),
  items: z.array(returnItemSchema),
  images: z.array(z.object({ id: z.uuid(), url: z.string() })),
  shipments: z.array(shipmentSchema),
  refunds: z.array(z.lazy(() => refundSchema)),
  createdAt: iso(),
  resolvedAt: iso().nullable(),
});
export type ReturnDto = z.infer<typeof returnSchema>;
export const returnListSchema = paginatedSchema(returnSchema);
export const returnListQuerySchema = paginationQuerySchema.extend({
  status: returnStatusSchema.optional(),
  search: z.string().trim().max(60).optional(),
});

/** Sent as the "data" field of the multipart request, with up to 5 "images". */
export const createReturnSchema = z.object({
  sellerOrderId: z.uuid(),
  items: z
    .array(
      z.object({ orderItemId: z.uuid(), quantity: z.coerce.number().int().min(1).max(10_000) }),
    )
    .min(1)
    .max(100),
  reason: returnReasonSchema,
  description: reasonText(10, 2000),
  requestedResolution: z.enum(['FULL_REFUND', 'REPLACEMENT']),
});
export type CreateReturnRequest = z.input<typeof createReturnSchema>;
export const MAX_RETURN_IMAGE_BYTES = 5 * 1024 * 1024;
export { MAX_RETURN_IMAGES };

export const sellerReturnDecisionSchema = z
  .object({
    resolution: z.enum(['FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT']),
    refundAmount: decimalStringSchema({ scale: 2 }).optional(),
    requiresReturnShipment: z.boolean(),
    response: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.resolution === 'PARTIAL_REFUND' && !v.refundAmount) {
      ctx.addIssue({
        code: 'custom',
        path: ['refundAmount'],
        message: 'Enter the amount to refund',
      });
    }
  });
export type SellerReturnDecision = z.input<typeof sellerReturnDecisionSchema>;
export const rejectReturnSchema = z.object({ response: reasonText(10, 1000) });
export const escalateReturnSchema = z.object({ note: reasonText(10, 1000) });
export const receiveReturnSchema = z.object({ restock: z.boolean() });
export const shipBackSchema = z.object({
  carrierName: z.string().trim().min(2).max(80),
  trackingNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,60}$/, 'Letters, digits and dashes (4–60)'),
});
export const staffReturnDecisionSchema = z
  .object({
    resolution: returnResolutionSchema,
    refundAmount: decimalStringSchema({ scale: 2 }).optional(),
    requiresReturnShipment: z.boolean().default(false),
    note: reasonText(10, 1000),
  })
  .superRefine((v, ctx) => {
    if (v.resolution === 'PARTIAL_REFUND' && !v.refundAmount) {
      ctx.addIssue({
        code: 'custom',
        path: ['refundAmount'],
        message: 'Enter the amount to refund',
      });
    }
  });
export type StaffReturnDecision = z.input<typeof staffReturnDecisionSchema>;

// ---- Refunds and payables ----------------------------------------------------------------

export const refundSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  sellerOrderId: z.uuid().nullable(),
  sellerOrderNumber: z.string().nullable(),
  paymentReference: z.string(),
  returnRequestId: z.uuid().nullable(),
  reason: refundReasonSchema,
  kind: z.enum(['FULL', 'PARTIAL']),
  status: refundStatusSchema,
  method: z.enum(['ORIGINAL', 'MANUAL']),
  amount: z.string(),
  itemsAmount: z.string(),
  shippingAmount: z.string(),
  chargesAmount: z.string(),
  sellerDebit: z.string(),
  commissionReversal: z.string(),
  test: z.boolean(),
  payoutReference: z.string().nullable(),
  failureMessage: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: iso(),
  succeededAt: iso().nullable(),
});
export type RefundDto = z.infer<typeof refundSchema>;
export const refundListSchema = paginatedSchema(refundSchema);
export const refundListQuerySchema = paginationQuerySchema.extend({
  status: refundStatusSchema.optional(),
  reason: refundReasonSchema.optional(),
  search: z.string().trim().max(60).optional(),
});
/** Staff refund (goodwill, duplicate or late payment, or a seller order). */
export const createRefundSchema = z
  .object({
    sellerOrderId: z.uuid().optional(),
    paymentId: z.uuid().optional(),
    reason: refundReasonSchema.exclude(['RETURN']),
    kind: z.enum(['FULL', 'PARTIAL']),
    amount: decimalStringSchema({ scale: 2 }).optional(),
    note: reasonText(3, 1000),
    /** Generated by the browser once per form, so a double submit creates one refund. */
    idempotencyKey: z.string().min(8).max(100),
  })
  .superRefine((v, ctx) => {
    if (!v.sellerOrderId && !v.paymentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sellerOrderId'],
        message: 'Choose a seller order or payment',
      });
    }
    if (v.kind === 'PARTIAL' && !v.amount) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter the amount' });
    }
  });
export type CreateRefundRequest = z.input<typeof createRefundSchema>;
export const markRefundPaidSchema = z.object({ payoutReference: z.string().trim().min(3).max(80) });

export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  type: z.enum(SELLER_LEDGER_TYPES),
  amount: z.string(),
  description: z.string(),
  sellerOrderId: z.uuid().nullable(),
  refundId: z.uuid().nullable(),
  createdAt: iso(),
});
export type LedgerEntryDto = z.infer<typeof ledgerEntrySchema>;
export const sellerLedgerSchema = paginatedSchema(ledgerEntrySchema).extend({
  balance: z.string(),
});
export type SellerLedger = z.infer<typeof sellerLedgerSchema>;

// ---- Order views (added to the Phase 4 order schemas) --------------------------------------

/** What the viewer may do with a seller order right now. */
export const sellerOrderActionsSchema = z.object({
  accept: z.boolean(),
  cancel: z.boolean(),
  requestCancellation: z.boolean(),
  answerCancellation: z.boolean(),
  bookShipment: z.boolean(),
  updateShipment: z.boolean(),
  confirmReceived: z.boolean(),
  requestReturn: z.boolean(),
  /** Staff: statuses they can move it to. */
  moveTo: z.array(fulfilmentStatusSchema),
});
export type SellerOrderActions = z.infer<typeof sellerOrderActionsSchema>;

export const sellerOrderFulfilmentSchema = z.object({
  acceptedAt: iso().nullable(),
  shippedAt: iso().nullable(),
  deliveredAt: iso().nullable(),
  completedAt: iso().nullable(),
  cancelledAt: iso().nullable(),
  cancelReason: z.string().nullable(),
  returnWindowEndsAt: iso().nullable(),
  shipments: z.array(shipmentSchema),
  cod: z
    .object({
      expectedAmount: z.string(),
      status: codCollectionStatusSchema,
      collectedAt: iso().nullable(),
    })
    .nullable(),
  cancellationRequest: cancellationRequestSchema.nullable(),
  returns: z.array(
    z.object({ id: z.uuid(), number: z.string(), status: returnStatusSchema, createdAt: iso() }),
  ),
  refunds: z.array(refundSchema),
  notes: z.array(orderNoteSchema),
  actions: sellerOrderActionsSchema,
});
export type SellerOrderFulfilment = z.infer<typeof sellerOrderFulfilmentSchema>;

export const sellerOrderCountsSchema = z.object({
  NEW: z.number().int(),
  PROCESSING: z.number().int(),
  READY_FOR_PICKUP: z.number().int(),
  SHIPPED: z.number().int(),
  COMPLETED: z.number().int(),
  CANCELLED: z.number().int(),
  returns: z.number().int(),
  cancellationRequests: z.number().int(),
});
export type SellerOrderCounts = z.infer<typeof sellerOrderCountsSchema>;

export { orderActorSchema as actorSchema };

// ---- Development tools (mock payment page, mock courier) ----------------------------------

export const mockPaymentOutcomeSchema = z.object({ outcome: z.enum(['paid', 'failed']) });
export const mockPaymentSessionSchema = z.object({
  id: z.string(),
  status: z.enum(['OPEN', 'PAID', 'FAILED', 'EXPIRED']),
  amount: z.string(),
  paymentReference: z.string(),
  method: methodSchema,
  orderId: z.uuid(),
  orderNumber: z.string(),
  /** Always true: the mock never moves money. */
  test: z.literal(true),
});
export type MockPaymentSession = z.infer<typeof mockPaymentSessionSchema>;
export const simulateShipmentSchema = z.object({
  status: shipmentStatusSchema.exclude(['BOOKED', 'CANCELLED']),
  /** Cash the mock courier reports collecting (defaults to the expected amount). */
  codCollected: decimalStringSchema({ scale: 2 }).optional(),
});
export const ledgerQuerySchema = paginationQuerySchema.extend({ sellerId: z.uuid().optional() });
export const webhookAckSchema = z.object({ received: z.literal(true), duplicate: z.boolean() });
