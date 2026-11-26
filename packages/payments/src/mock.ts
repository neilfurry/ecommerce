import { randomBytes } from 'node:crypto';
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
  hmacHex,
  header,
  parseJson,
  parseSignatureHeader,
  sameSignature,
  str,
} from './util';

/** Where the mock keeps its checkout sessions (a development-only table in the API). */
export interface MockSessionStore {
  create(session: { id: string; paymentReference: string; amount: string }): Promise<void>;
  get(id: string): Promise<MockSession | null>;
  update(id: string, change: { status: MockSessionStatus; paymentId?: string }): Promise<void>;
}
export type MockSessionStatus = 'OPEN' | 'PAID' | 'FAILED' | 'EXPIRED';
export interface MockSession {
  id: string;
  paymentReference: string;
  amount: string;
  status: MockSessionStatus;
  paymentId: string | null;
}

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';
/** Put this in a refund note to make the mock refuse the refund (tests the failure path). */
export const MOCK_REFUND_FAILURE_MARKER = '[mock:fail]';

const id = (prefix: string) => `${prefix}_mock_${randomBytes(9).toString('base64url')}`;

/**
 * A gateway for local development and tests. It never moves money and every payment it
 * reports has livemode=false. Its "hosted checkout" is a storefront page with buttons that
 * ask the API to simulate the outcome; the outcome arrives as a signed webhook, exactly like a
 * real provider's, so the same verification and processing code runs.
 */
export class MockGateway implements PaymentGateway {
  readonly code = 'MOCK' as const;
  readonly livemode = false;
  readonly methods: readonly PaymentMethod[] = ['GCASH', 'MAYA', 'CARD', 'QR_PH'];

  constructor(
    private readonly options: {
      webhookSecret: string;
      /** Base URL of the storefront's mock checkout page. */
      checkoutPageUrl: string;
      store: MockSessionStore;
      toleranceSeconds?: number;
    },
  ) {
    if (options.webhookSecret.length < 16) throw new Error('Mock webhook secret is too short');
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
    const sessionId = id('cs');
    await this.options.store.create({
      id: sessionId,
      paymentReference: input.paymentReference,
      amount: input.amount,
    });
    return {
      providerReference: sessionId,
      checkoutUrl: `${this.options.checkoutPageUrl.replace(/\/$/, '')}/${sessionId}`,
    };
  }

  async retrieve(providerReference: string): Promise<RetrievedCheckout> {
    const session = await this.options.store.get(providerReference);
    if (!session) throw new GatewayError('Unknown mock checkout session', 'NOT_FOUND', false);
    return {
      state: session.status === 'OPEN' ? 'PENDING' : session.status,
      providerPaymentId: session.paymentId,
      amountPaid: session.status === 'PAID' ? session.amount : null,
      failureCode: session.status === 'FAILED' ? 'mock_declined' : null,
      failureMessage: session.status === 'FAILED' ? 'The test payment was declined.' : null,
    };
  }

  async expire(providerReference: string): Promise<void> {
    const session = await this.options.store.get(providerReference);
    if (session?.status === 'OPEN') {
      await this.options.store.update(providerReference, { status: 'EXPIRED' });
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (input.notes.includes(MOCK_REFUND_FAILURE_MARKER)) {
      return {
        providerRefundId: id('ref'),
        state: 'FAILED',
        failureMessage: 'The mock provider refused this refund (test).',
      };
    }
    return { providerRefundId: id('ref'), state: 'SUCCEEDED', failureMessage: null };
  }

  /**
   * Simulates the customer finishing the mock checkout: records the outcome and returns the
   * signed webhook the API must deliver to its own webhook endpoint.
   */
  async simulate(
    sessionId: string,
    outcome: 'paid' | 'failed',
    options: { amount?: string; now?: Date } = {},
  ): Promise<{ headers: Record<string, string>; rawBody: Buffer }> {
    const session = await this.options.store.get(sessionId);
    if (!session) throw new GatewayError('Unknown mock checkout session', 'NOT_FOUND', false);
    if (session.status !== 'OPEN') {
      throw new GatewayError(
        `This test checkout is already ${session.status.toLowerCase()}`,
        'CLOSED',
        false,
      );
    }
    const paymentId = id('pay');
    await this.options.store.update(sessionId, {
      status: outcome === 'paid' ? 'PAID' : 'FAILED',
      paymentId,
    });
    const event = {
      id: id('evt'),
      type: outcome === 'paid' ? 'payment.paid' : 'payment.failed',
      livemode: false,
      data: {
        sessionId,
        paymentReference: session.paymentReference,
        paymentId,
        amount: options.amount ?? session.amount,
        failureCode: outcome === 'failed' ? 'mock_declined' : null,
        failureMessage: outcome === 'failed' ? 'The test payment was declined.' : null,
      },
    };
    return this.sign(event, options.now);
  }

  /** Signs any body the way the mock provider does (tests use it for forged and replayed events). */
  sign(event: unknown, now = new Date()): { headers: Record<string, string>; rawBody: Buffer } {
    const rawBody = Buffer.from(JSON.stringify(event));
    const t = Math.floor(now.getTime() / 1000).toString();
    const v1 = hmacHex(this.options.webhookSecret, `${t}.${rawBody.toString('utf8')}`);
    return { headers: { [MOCK_SIGNATURE_HEADER]: `t=${t},v1=${v1}` }, rawBody };
  }

  parseWebhook(headers: WebhookHeaders, rawBody: Buffer, now = new Date()): ParsedWebhook {
    const value = header(headers, MOCK_SIGNATURE_HEADER);
    if (!value) throw new WebhookSignatureError('Missing signature');
    const parts = parseSignatureHeader(value);
    checkTimestamp(parts.t, now, this.options.toleranceSeconds ?? 300);
    const expected = hmacHex(this.options.webhookSecret, `${parts.t}.${rawBody.toString('utf8')}`);
    if (!parts.v1 || !sameSignature(expected, parts.v1)) {
      throw new WebhookSignatureError('Signature does not match');
    }
    const payload = parseJson(rawBody);
    const eventId = str(at(payload, 'id'));
    const eventType = str(at(payload, 'type'));
    if (!eventId || !eventType) throw new WebhookSignatureError('Malformed event');
    const outcome = mockEventOutcome(payload);
    return { eventId, eventType, livemode: false, outcome, payload };
  }
}

/**
 * Translates a (verified) mock event. Exported so stored events can be processed again
 * without their signature, which is only checked on arrival.
 */
export function mockEventOutcome(payload: unknown): WebhookOutcome {
  const eventType = str(at(payload, 'type'));
  const data = at(payload, 'data');
  const base = {
    providerReference: str(at(data, 'sessionId')),
    paymentReference: str(at(data, 'paymentReference')),
  };
  if (eventType === 'payment.paid') {
    return {
      kind: 'payment.paid',
      ...base,
      providerPaymentId: str(at(data, 'paymentId')) ?? '',
      amount: str(at(data, 'amount')) ?? '0',
    };
  }
  if (eventType === 'payment.failed') {
    return {
      kind: 'payment.failed',
      ...base,
      providerPaymentId: str(at(data, 'paymentId')),
      failureCode: str(at(data, 'failureCode')),
      failureMessage: str(at(data, 'failureMessage')),
      final: true,
    };
  }
  return { kind: 'ignored' };
}
