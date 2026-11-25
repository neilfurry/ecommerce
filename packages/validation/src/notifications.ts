import { z } from 'zod';

/**
 * Payloads of the email and SMS jobs the API enqueues and the worker sends.
 * Links are built by the API (which knows the frontend URLs); the worker only renders.
 */
const recipient = { to: z.email(), firstName: z.string() };

export const verifyEmailJobSchema = z.object({ ...recipient, link: z.url() });
export const passwordResetJobSchema = z.object({
  ...recipient,
  link: z.url(),
  expiresInMinutes: z.number().int(),
});
export const staffInvitationJobSchema = z.object({
  ...recipient,
  link: z.url(),
  invitedBy: z.string(),
  roles: z.array(z.string()),
  expiresInHours: z.number().int(),
});
export const wholesaleDecisionJobSchema = z.object({
  ...recipient,
  decision: z.enum(['APPROVED', 'REJECTED']),
  businessName: z.string(),
  note: z.string().nullable(),
  link: z.url(),
});
/** A seller's verification or account status changed. */
export const sellerStatusJobSchema = z.object({
  ...recipient,
  businessName: z.string(),
  event: z.enum([
    'SUBMITTED',
    'INFO_REQUESTED',
    'APPROVED',
    'REJECTED',
    'SUSPENDED',
    'REINSTATED',
    'CLOSED',
  ]),
  note: z.string().nullable(),
  link: z.url(),
});
/** Invitation to join a seller as an employee. */
export const sellerInvitationJobSchema = z.object({
  to: z.email(),
  sellerName: z.string(),
  invitedBy: z.string(),
  roles: z.array(z.string()).min(1),
  link: z.url(),
  expiresInHours: z.number().int(),
});
/** A product was approved, rejected or taken down. Sent to the seller's business email. */
export const productDecisionJobSchema = z.object({
  to: z.email(),
  businessName: z.string(),
  productName: z.string(),
  decision: z.enum(['APPROVED', 'REJECTED', 'TAKEN_DOWN']),
  note: z.string().nullable(),
  link: z.url(),
});
/** Available stock of one or more variants fell to their low-stock threshold. */
export const lowStockJobSchema = z.object({
  to: z.email(),
  businessName: z.string(),
  items: z
    .array(
      z.object({
        productName: z.string(),
        variantTitle: z.string(),
        sku: z.string(),
        warehouse: z.string(),
        available: z.number().int(),
        threshold: z.number().int(),
      }),
    )
    .min(1),
  link: z.url(),
});
const orderLine = z.object({
  productName: z.string(),
  variantTitle: z.string(),
  quantity: z.number().int(),
  lineTotal: z.string(),
});

/** Sent to the customer when an order is placed (or created waiting for payment). */
export const orderPlacedJobSchema = z.object({
  ...recipient,
  orderNumber: z.string(),
  status: z.enum(['PLACED', 'AWAITING_PAYMENT']),
  paymentMethod: z.string(),
  paymentDueAt: z.iso.datetime().nullable(),
  grandTotal: z.string(),
  sellers: z.array(z.object({ storeName: z.string(), lines: z.array(orderLine) })).min(1),
  address: z.string(),
  link: z.url(),
});
/** Sent to each seller with their suborder. */
export const sellerNewOrderJobSchema = z.object({
  to: z.email(),
  businessName: z.string(),
  number: z.string(),
  paymentMethod: z.string(),
  awaitingPayment: z.boolean(),
  total: z.string(),
  lines: z.array(orderLine).min(1),
  link: z.url(),
});
/** Sent to the customer when an order is cancelled (by them or for non-payment). */
export const orderCancelledJobSchema = z.object({
  ...recipient,
  orderNumber: z.string(),
  reason: z.string(),
  link: z.url(),
});

export const smsOtpJobSchema = z.object({
  /** E.164 */
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  code: z.string().regex(/^\d{6}$/),
  expiresInMinutes: z.number().int(),
});

export type VerifyEmailJob = z.infer<typeof verifyEmailJobSchema>;
export type PasswordResetJob = z.infer<typeof passwordResetJobSchema>;
export type StaffInvitationJob = z.infer<typeof staffInvitationJobSchema>;
export type WholesaleDecisionJob = z.infer<typeof wholesaleDecisionJobSchema>;
export type SmsOtpJob = z.infer<typeof smsOtpJobSchema>;
export type SellerStatusJob = z.infer<typeof sellerStatusJobSchema>;
export type SellerInvitationJob = z.infer<typeof sellerInvitationJobSchema>;
export type ProductDecisionJob = z.infer<typeof productDecisionJobSchema>;
export type LowStockJob = z.infer<typeof lowStockJobSchema>;
export type OrderPlacedJob = z.infer<typeof orderPlacedJobSchema>;
export type SellerNewOrderJob = z.infer<typeof sellerNewOrderJobSchema>;
export type OrderCancelledJob = z.infer<typeof orderCancelledJobSchema>;
