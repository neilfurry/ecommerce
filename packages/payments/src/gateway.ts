import type { OnlinePaymentProvider, PaymentMethod } from '@marketplace/shared-types';

/**
 * A payment gateway: hosted checkout, status lookups, refunds and signed webhooks.
 * Amounts are decimal strings in pesos ("1234.50"); adapters convert to the provider's units.
 *
 * Nothing here decides that an order is paid: the API marks payments paid only from a
 * verified webhook or a server-side status lookup (`retrieve`), never from a browser redirect.
 */
export interface PaymentGateway {
  readonly code: OnlinePaymentProvider;
  /** false for test (sandbox) keys and the mock: no real money moves. */
  readonly livemode: boolean;
  /** Methods this gateway can take. */
  readonly methods: readonly PaymentMethod[];

  createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout>;
  /** Asks the provider for the current state (verification and reconciliation). */
  retrieve(providerReference: string): Promise<RetrievedCheckout>;
  /** Stops the checkout from being paid (best effort; ignore "already paid" answers). */
  expire(providerReference: string): Promise<void>;
  refund(input: RefundInput): Promise<RefundResult>;
  /**
   * Verifies the signature over the exact raw body and translates the event.
   * Throws `WebhookSignatureError` when the request is not from the provider.
   */
  parseWebhook(headers: WebhookHeaders, rawBody: Buffer, now?: Date): ParsedWebhook;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface CreateCheckoutInput {
  /** Our payment reference, sent as the provider's reference number. */
  paymentReference: string;
  orderNumber: string;
  method: PaymentMethod;
  amount: string;
  currency: 'PHP';
  description: string;
  customer: { name: string; email: string; phone: string | null };
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface CreatedCheckout {
  providerReference: string;
  checkoutUrl: string;
}

export type GatewayPaymentState = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export interface RetrievedCheckout {
  state: GatewayPaymentState;
  providerPaymentId: string | null;
  /** Amount paid, when paid. */
  amountPaid: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface RefundInput {
  providerPaymentId: string;
  amount: string;
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'others';
  /** Our refund id: providers that support idempotency keys get it, so a retry never refunds twice. */
  idempotencyKey: string;
  notes: string;
}

export interface RefundResult {
  providerRefundId: string;
  state: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  failureMessage: string | null;
}

export type WebhookOutcome =
  | {
      kind: 'payment.paid';
      providerReference: string | null;
      paymentReference: string | null;
      providerPaymentId: string;
      amount: string;
    }
  | {
      kind: 'payment.failed';
      providerReference: string | null;
      paymentReference: string | null;
      providerPaymentId: string | null;
      failureCode: string | null;
      failureMessage: string | null;
      /**
       * true when the checkout cannot be paid any more. Hosted checkouts that let the
       * customer try again after a failed attempt report false: the payment stays open.
       */
      final: boolean;
    }
  | {
      kind: 'refund.updated';
      providerRefundId: string;
      state: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
      failureMessage: string | null;
    }
  | { kind: 'ignored' };

export interface ParsedWebhook {
  eventId: string;
  eventType: string;
  livemode: boolean;
  outcome: WebhookOutcome;
  /** The verified JSON body, for the event log. */
  payload: unknown;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/** The provider refused the request or could not be reached; safe to show to staff. */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** The adapter exists but needs credentials, an agreement or documentation first. */
export class GatewayNotConfiguredError extends GatewayError {
  constructor(provider: string, missing: string) {
    super(`${provider} is not configured: ${missing}`, 'NOT_CONFIGURED', false);
  }
}
