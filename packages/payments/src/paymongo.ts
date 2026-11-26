import type { PaymentMethod } from '@marketplace/shared-types';
import {
  type CreateCheckoutInput,
  type CreatedCheckout,
  GatewayError,
  type ParsedWebhook,
  type PaymentGateway,
  type RefundInput,
  type RefundResult,
  type RetrievedCheckout,
  type WebhookHeaders,
  type WebhookOutcome,
  WebhookSignatureError,
} from './gateway';
import {
  at,
  checkTimestamp,
  fromCentavos,
  header,
  hmacHex,
  parseJson,
  parseSignatureHeader,
  sameSignature,
  str,
  toCentavos,
} from './util';

export interface PayMongoConfig {
  /** sk_test_… (sandbox) or sk_live_…; never sent to browsers or logged. */
  secretKey: string;
  /** The webhook's own secret (shown when the webhook is created in PayMongo). */
  webhookSecret: string;
  apiBase?: string;
  /** Checkout Sessions API version; PayMongo recommends v2 for new integrations. */
  checkoutVersion?: 'v1' | 'v2';
  /** Seconds a webhook signature timestamp may differ from now (replay protection). */
  toleranceSeconds?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Our methods → PayMongo payment_method_types. */
export const PAYMONGO_METHOD_TYPES: Partial<Record<PaymentMethod, string>> = {
  GCASH: 'gcash',
  MAYA: 'paymaya',
  CARD: 'card',
  QR_PH: 'qrph',
};

export const PAYMONGO_SIGNATURE_HEADER = 'paymongo-signature';

/**
 * PayMongo hosted checkout (Checkout Sessions), refunds and signed webhooks.
 *
 * Amounts are sent in centavos. Webhooks are verified with HMAC-SHA256 over
 * "<t>.<raw body>" using the webhook secret, compared with `te` (test) or `li` (live).
 * Used with sandbox keys until a live merchant account is approved; split settlement
 * (PayMongo Platforms) is not used: the marketplace receives every payment (ADR 0022).
 */
export class PayMongoGateway implements PaymentGateway {
  readonly code = 'PAYMONGO' as const;
  readonly livemode: boolean;
  readonly methods: readonly PaymentMethod[] = ['GCASH', 'MAYA', 'CARD', 'QR_PH'];
  private readonly base: string;
  private readonly version: 'v1' | 'v2';
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: PayMongoConfig) {
    if (!/^sk_(test|live)_/.test(config.secretKey)) {
      throw new Error('PAYMONGO_SECRET_KEY must start with sk_test_ or sk_live_');
    }
    if (config.webhookSecret.length < 8) throw new Error('PAYMONGO_WEBHOOK_SECRET is missing');
    this.livemode = config.secretKey.startsWith('sk_live_');
    this.base = (config.apiBase ?? 'https://api.paymongo.com').replace(/\/$/, '');
    this.version = config.checkoutVersion ?? 'v2';
    this.fetcher = config.fetch ?? fetch;
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.secretKey}:`).toString('base64')}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, json };
    } catch (error) {
      throw new GatewayError(
        `PayMongo could not be reached: ${(error as Error).message}`,
        'UNREACHABLE',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(status: number, json: unknown): never {
    const detail = str(at(json, 'errors', 0, 'detail')) ?? `HTTP ${status}`;
    const code = str(at(json, 'errors', 0, 'code')) ?? `http_${status}`;
    throw new GatewayError(`PayMongo: ${detail}`, code, status >= 500 || status === 429);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
    const type = PAYMONGO_METHOD_TYPES[input.method];
    if (!type) throw new GatewayError(`PayMongo does not take ${input.method}`, 'METHOD', false);
    const { status, json } = await this.call('POST', `/${this.version}/checkout_sessions`, {
      data: {
        attributes: {
          line_items: [
            {
              name: `Order ${input.orderNumber}`,
              amount: toCentavos(input.amount),
              currency: input.currency,
              quantity: 1,
            },
          ],
          payment_method_types: [type],
          description: input.description,
          reference_number: input.paymentReference,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          billing: {
            name: input.customer.name,
            email: input.customer.email,
            ...(input.customer.phone ? { phone: input.customer.phone } : {}),
          },
          metadata: { payment_reference: input.paymentReference, order_number: input.orderNumber },
        },
      },
    });
    if (status >= 300) this.fail(status, json);
    const providerReference = str(at(json, 'data', 'id'));
    const checkoutUrl = str(at(json, 'data', 'attributes', 'checkout_url'));
    if (!providerReference || !checkoutUrl) {
      throw new GatewayError('PayMongo returned no checkout URL', 'BAD_RESPONSE', true);
    }
    return { providerReference, checkoutUrl };
  }

  async retrieve(providerReference: string): Promise<RetrievedCheckout> {
    const { status, json } = await this.call(
      'GET',
      `/${this.version}/checkout_sessions/${encodeURIComponent(providerReference)}`,
    );
    if (status >= 300) this.fail(status, json);
    return checkoutState(at(json, 'data'));
  }

  async expire(providerReference: string): Promise<void> {
    const { status, json } = await this.call(
      'POST',
      `/${this.version}/checkout_sessions/${encodeURIComponent(providerReference)}/expire`,
    );
    // PayMongo refuses to expire a session with a paid or ongoing payment: that is fine here,
    // the webhook or reconciliation records the payment.
    if (status >= 500) this.fail(status, json);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const { status, json } = await this.call(
      'POST',
      '/v1/refunds',
      {
        data: {
          attributes: {
            amount: toCentavos(input.amount),
            payment_id: input.providerPaymentId,
            reason: input.reason,
            notes: input.notes.slice(0, 255),
            metadata: { refund_id: input.idempotencyKey },
          },
        },
      },
      { 'Idempotency-Key': input.idempotencyKey },
    );
    if (status >= 300) this.fail(status, json);
    const providerRefundId = str(at(json, 'data', 'id'));
    if (!providerRefundId)
      throw new GatewayError('PayMongo returned no refund', 'BAD_RESPONSE', true);
    return {
      providerRefundId,
      state: refundState(str(at(json, 'data', 'attributes', 'status'))),
      failureMessage: null,
    };
  }

  parseWebhook(headers: WebhookHeaders, rawBody: Buffer, now = new Date()): ParsedWebhook {
    const value = header(headers, PAYMONGO_SIGNATURE_HEADER);
    if (!value) throw new WebhookSignatureError('Missing Paymongo-Signature header');
    const parts = parseSignatureHeader(value);
    checkTimestamp(parts.t, now, this.config.toleranceSeconds ?? 600);
    const payload = parseJson(rawBody);
    const livemode = at(payload, 'data', 'attributes', 'livemode') === true;
    const given = livemode ? parts.li : parts.te;
    const expected = hmacHex(this.config.webhookSecret, `${parts.t}.${rawBody.toString('utf8')}`);
    if (!given || !sameSignature(expected, given)) {
      throw new WebhookSignatureError('Signature does not match');
    }
    const eventId = str(at(payload, 'data', 'id'));
    const eventType = str(at(payload, 'data', 'attributes', 'type'));
    if (!eventId || !eventType) throw new WebhookSignatureError('Malformed event');
    // A live event reaching test keys (or the reverse) is not ours to act on.
    const outcome: WebhookOutcome =
      livemode !== this.livemode
        ? { kind: 'ignored' }
        : eventOutcome(eventType, at(payload, 'data', 'attributes', 'data'));
    return { eventId, eventType, livemode, outcome, payload };
  }
}

function amountOf(resource: unknown): string | null {
  const value = at(resource, 'attributes', 'amount') ?? at(resource, 'amount');
  return typeof value === 'number' && Number.isInteger(value) ? fromCentavos(value) : null;
}

/** A checkout session object → our state, from its payments (at most one is paid). */
export function checkoutState(session: unknown): RetrievedCheckout {
  const payments = at(session, 'attributes', 'payments');
  const list = Array.isArray(payments) ? payments : [];
  const statusOf = (p: unknown) => str(at(p, 'attributes', 'status') ?? at(p, 'status'));
  const paid = list.find((p) => statusOf(p) === 'paid');
  if (paid) {
    return {
      state: 'PAID',
      providerPaymentId: str(at(paid, 'id')),
      amountPaid: amountOf(paid),
      failureCode: null,
      failureMessage: null,
    };
  }
  const sessionStatus = str(at(session, 'attributes', 'status'));
  const lastFailed = [...list].reverse().find((p) => statusOf(p) === 'failed');
  return {
    state: sessionStatus === 'expired' ? 'EXPIRED' : 'PENDING',
    providerPaymentId: null,
    amountPaid: null,
    failureCode: lastFailed ? str(at(lastFailed, 'attributes', 'failed_code')) : null,
    failureMessage: lastFailed ? str(at(lastFailed, 'attributes', 'failed_message')) : null,
  };
}

function refundState(status: string | null): RefundResult['state'] {
  if (status === 'succeeded') return 'SUCCEEDED';
  if (status === 'failed') return 'FAILED';
  return 'PROCESSING';
}

/** Event resource → outcome. Unknown events are ignored (stored, not acted on). */
export function eventOutcome(eventType: string, resource: unknown): WebhookOutcome {
  switch (eventType) {
    case 'checkout_session.payment.paid': {
      const state = checkoutState(resource);
      if (state.state !== 'PAID' || !state.providerPaymentId || !state.amountPaid) {
        return { kind: 'ignored' };
      }
      return {
        kind: 'payment.paid',
        providerReference: str(at(resource, 'id')),
        paymentReference: str(at(resource, 'attributes', 'reference_number')),
        providerPaymentId: state.providerPaymentId,
        amount: state.amountPaid,
      };
    }
    case 'payment.paid': {
      // Only usable when it carries our reference; checkout sessions report through
      // checkout_session.payment.paid.
      const paymentReference = str(at(resource, 'attributes', 'metadata', 'payment_reference'));
      const providerPaymentId = str(at(resource, 'id'));
      const amount = amountOf(resource);
      if (!paymentReference || !providerPaymentId || !amount) return { kind: 'ignored' };
      return {
        kind: 'payment.paid',
        providerReference: null,
        paymentReference,
        providerPaymentId,
        amount,
      };
    }
    case 'payment.failed':
      return {
        kind: 'payment.failed',
        providerReference: null,
        paymentReference: str(at(resource, 'attributes', 'metadata', 'payment_reference')),
        providerPaymentId: str(at(resource, 'id')),
        failureCode: str(at(resource, 'attributes', 'failed_code')),
        failureMessage: str(at(resource, 'attributes', 'failed_message')),
        // The customer may try another card or wallet in the same hosted checkout.
        final: false,
      };
    case 'refund.succeeded':
    case 'refund.failed':
    case 'refund.updated':
    case 'payment.refund.updated': {
      const providerRefundId = str(at(resource, 'id'));
      if (!providerRefundId) return { kind: 'ignored' };
      const status =
        eventType === 'refund.succeeded'
          ? 'succeeded'
          : eventType === 'refund.failed'
            ? 'failed'
            : str(at(resource, 'attributes', 'status'));
      return {
        kind: 'refund.updated',
        providerRefundId,
        state: refundState(status),
        failureMessage: null,
      };
    }
    default:
      return { kind: 'ignored' };
  }
}
