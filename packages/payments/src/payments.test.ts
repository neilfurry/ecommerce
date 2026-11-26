import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GatewayError, WebhookSignatureError } from './gateway';
import { MockGateway, type MockSession, type MockSessionStore } from './mock';
import { PayMongoGateway, checkoutState } from './paymongo';
import { MayaBusinessGateway, XenditGateway } from './prepared';
import { fromCentavos, parseSignatureHeader, toCentavos } from './util';

const NOW = new Date('2026-12-01T10:00:00Z');
const T = Math.floor(NOW.getTime() / 1000).toString();

describe('money conversion', () => {
  it('converts pesos to centavos exactly', () => {
    expect(toCentavos('1234.50')).toBe(123450);
    expect(toCentavos('0.01')).toBe(1);
    expect(toCentavos('100')).toBe(10000);
    expect(toCentavos('19.9900')).toBe(1999);
    expect(fromCentavos(123450)).toBe('1234.50');
    expect(fromCentavos(5)).toBe('0.05');
  });

  it('refuses malformed or unrounded amounts', () => {
    expect(() => toCentavos('-1')).toThrow();
    expect(() => toCentavos('1e3')).toThrow();
    expect(() => toCentavos('1.005')).toThrow(/Not rounded/);
  });

  it('parses signature headers', () => {
    expect(parseSignatureHeader('t=1,te=abc,li=')).toEqual({ t: '1', te: 'abc', li: '' });
  });
});

function memoryStore(): MockSessionStore & { sessions: Map<string, MockSession> } {
  const sessions = new Map<string, MockSession>();
  return {
    sessions,
    async create(s) {
      sessions.set(s.id, { ...s, status: 'OPEN', paymentId: null });
    },
    async get(id) {
      return sessions.get(id) ?? null;
    },
    async update(id, change) {
      const s = sessions.get(id)!;
      sessions.set(id, { ...s, status: change.status, paymentId: change.paymentId ?? s.paymentId });
    },
  };
}

const checkoutInput = {
  paymentReference: 'PAY-ABCDEFGH',
  orderNumber: 'MP261201ABCDEF',
  method: 'GCASH' as const,
  amount: '1499.00',
  currency: 'PHP' as const,
  description: 'Marketplace order MP261201ABCDEF',
  customer: { name: 'Maria Cruz', email: 'maria@example.com', phone: '+639171234567' },
  successUrl: 'https://shop.example/account/orders/1?payment=return',
  cancelUrl: 'https://shop.example/account/orders/1',
  expiresAt: new Date('2026-12-01T11:00:00Z'),
};

describe('mock gateway', () => {
  const store = memoryStore();
  const mock = new MockGateway({
    webhookSecret: 'mock-secret-for-tests-only',
    checkoutPageUrl: 'http://localhost:5173/pay/mock',
    store,
  });

  it('is never live and simulates a paid checkout as a signed webhook', async () => {
    expect(mock.livemode).toBe(false);
    const created = await mock.createCheckout(checkoutInput);
    expect(created.checkoutUrl).toBe(`http://localhost:5173/pay/mock/${created.providerReference}`);
    expect((await mock.retrieve(created.providerReference)).state).toBe('PENDING');

    const { headers, rawBody } = await mock.simulate(created.providerReference, 'paid', {
      now: NOW,
    });
    const event = mock.parseWebhook(headers, rawBody, NOW);
    expect(event.livemode).toBe(false);
    expect(event.outcome).toMatchObject({
      kind: 'payment.paid',
      providerReference: created.providerReference,
      paymentReference: 'PAY-ABCDEFGH',
      amount: '1499.00',
    });
    expect(await mock.retrieve(created.providerReference)).toMatchObject({
      state: 'PAID',
      amountPaid: '1499.00',
    });
    // A closed checkout cannot be "paid" again.
    await expect(mock.simulate(created.providerReference, 'paid')).rejects.toThrow(GatewayError);
  });

  it('rejects a tampered body, a wrong secret and a stale timestamp', async () => {
    const created = await mock.createCheckout(checkoutInput);
    const { headers, rawBody } = await mock.simulate(created.providerReference, 'failed', {
      now: NOW,
    });
    const tampered = Buffer.from(rawBody.toString().replace('mock_declined', 'mock_accepted'));
    expect(() => mock.parseWebhook(headers, tampered, NOW)).toThrow(WebhookSignatureError);
    const other = new MockGateway({
      webhookSecret: 'a-different-secret-value',
      checkoutPageUrl: 'x',
      store,
    });
    expect(() => other.parseWebhook(headers, rawBody, NOW)).toThrow(WebhookSignatureError);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    expect(() => mock.parseWebhook(headers, rawBody, later)).toThrow(/window/);
    expect(() => mock.parseWebhook({}, rawBody, NOW)).toThrow(/Missing/);
    expect(mock.parseWebhook(headers, rawBody, NOW).outcome).toMatchObject({
      kind: 'payment.failed',
      final: true,
    });
  });

  it('refunds, and refuses when asked to (failure path for tests)', async () => {
    expect(
      (
        await mock.refund({
          providerPaymentId: 'p',
          amount: '10.00',
          reason: 'others',
          idempotencyKey: 'k',
          notes: '',
        })
      ).state,
    ).toBe('SUCCEEDED');
    expect(
      (
        await mock.refund({
          providerPaymentId: 'p',
          amount: '10.00',
          reason: 'others',
          idempotencyKey: 'k',
          notes: 'x [mock:fail]',
        })
      ).state,
    ).toBe('FAILED');
  });
});

const WEBHOOK_SECRET = 'whsk_test_secret_value';
function paymongoSigned(body: unknown, mode: 'te' | 'li' = 'te', secret = WEBHOOK_SECRET) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha256', secret).update(`${T}.${raw.toString()}`).digest('hex');
  const value = mode === 'te' ? `t=${T},te=${signature},li=` : `t=${T},te=,li=${signature}`;
  return { headers: { 'Paymongo-Signature': value }, raw };
}

const paidSessionEvent = (livemode = false) => ({
  data: {
    id: 'evt_123',
    type: 'event',
    attributes: {
      type: 'checkout_session.payment.paid',
      livemode,
      data: {
        id: 'cs_abc',
        type: 'checkout_session',
        attributes: {
          reference_number: 'PAY-ABCDEFGH',
          status: 'active',
          payments: [
            { id: 'pay_failed', attributes: { amount: 149900, status: 'failed' } },
            { id: 'pay_ok', attributes: { amount: 149900, status: 'paid' } },
          ],
        },
      },
    },
  },
});

describe('PayMongo gateway', () => {
  const fetchMock = vi.fn();
  const gateway = new PayMongoGateway({
    secretKey: 'sk_test_abc123',
    webhookSecret: WEBHOOK_SECRET,
    fetch: fetchMock as unknown as typeof fetch,
  });

  it('verifies the test signature and reads the paid payment from the session', () => {
    const { headers, raw } = paymongoSigned(paidSessionEvent());
    const event = gateway.parseWebhook(headers, raw, NOW);
    expect(event).toMatchObject({
      eventId: 'evt_123',
      eventType: 'checkout_session.payment.paid',
      livemode: false,
      outcome: {
        kind: 'payment.paid',
        providerReference: 'cs_abc',
        paymentReference: 'PAY-ABCDEFGH',
        providerPaymentId: 'pay_ok',
        amount: '1499.00',
      },
    });
  });

  it('rejects a missing, wrong-mode, wrong-secret, tampered or stale signature', () => {
    const body = paidSessionEvent();
    const { headers, raw } = paymongoSigned(body);
    expect(() => gateway.parseWebhook({}, raw, NOW)).toThrow(WebhookSignatureError);
    // Signed in the li slot but the event says test mode.
    const live = paymongoSigned(body, 'li');
    expect(() => gateway.parseWebhook(live.headers, live.raw, NOW)).toThrow(/does not match/);
    const wrong = paymongoSigned(body, 'te', 'whsk_other');
    expect(() => gateway.parseWebhook(wrong.headers, wrong.raw, NOW)).toThrow(/does not match/);
    const tampered = Buffer.from(raw.toString().replace('149900', '1'));
    expect(() => gateway.parseWebhook(headers, tampered, NOW)).toThrow(/does not match/);
    const late = new Date(NOW.getTime() + 3600_000);
    expect(() => gateway.parseWebhook(headers, raw, late)).toThrow(/window/);
  });

  it('does not act on live events with test keys', () => {
    const { headers, raw } = paymongoSigned(paidSessionEvent(true), 'li');
    expect(gateway.parseWebhook(headers, raw, NOW).outcome).toEqual({ kind: 'ignored' });
  });

  it('maps failed attempts as non-final and refunds by state', () => {
    const failed = paymongoSigned({
      data: {
        id: 'evt_f',
        attributes: {
          type: 'payment.failed',
          livemode: false,
          data: {
            id: 'pay_x',
            attributes: {
              failed_code: 'insufficient_funds',
              failed_message: 'Declined',
              metadata: {},
            },
          },
        },
      },
    });
    expect(gateway.parseWebhook(failed.headers, failed.raw, NOW).outcome).toMatchObject({
      kind: 'payment.failed',
      failureCode: 'insufficient_funds',
      final: false,
    });
    const refund = paymongoSigned({
      data: {
        id: 'evt_r',
        attributes: {
          type: 'refund.succeeded',
          livemode: false,
          data: { id: 'ref_1', attributes: { status: 'succeeded' } },
        },
      },
    });
    expect(gateway.parseWebhook(refund.headers, refund.raw, NOW).outcome).toEqual({
      kind: 'refund.updated',
      providerRefundId: 'ref_1',
      state: 'SUCCEEDED',
      failureMessage: null,
    });
  });

  it('creates a hosted checkout in centavos for the one chosen method', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { id: 'cs_new', attributes: { checkout_url: 'https://pm.link/cs_new' } },
        }),
        {
          status: 200,
        },
      ),
    );
    const created = await gateway.createCheckout(checkoutInput);
    expect(created).toEqual({ providerReference: 'cs_new', checkoutUrl: 'https://pm.link/cs_new' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paymongo.com/v2/checkout_sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('sk_test_abc123:').toString('base64')}`,
    );
    const body = JSON.parse(String(init.body));
    expect(body.data.attributes).toMatchObject({
      line_items: [{ amount: 149900, currency: 'PHP', quantity: 1 }],
      payment_method_types: ['gcash'],
      reference_number: 'PAY-ABCDEFGH',
    });
  });

  it('sends refunds with an idempotency key and maps provider errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: 'ref_9', attributes: { status: 'pending' } } }), {
        status: 200,
      }),
    );
    const result = await gateway.refund({
      providerPaymentId: 'pay_ok',
      amount: '500.00',
      reason: 'requested_by_customer',
      idempotencyKey: 'refund-1',
      notes: 'Return RT-1',
    });
    expect(result).toEqual({
      providerRefundId: 'ref_9',
      state: 'PROCESSING',
      failureMessage: null,
    });
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('refund-1');
    expect(JSON.parse(String(init.body)).data.attributes.amount).toBe(50000);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ code: 'resource_processing_state', detail: 'Refund in progress' }],
        }),
        {
          status: 400,
        },
      ),
    );
    await expect(
      gateway.refund({
        providerPaymentId: 'p',
        amount: '1.00',
        reason: 'others',
        idempotencyKey: 'k',
        notes: '',
      }),
    ).rejects.toMatchObject({ code: 'resource_processing_state', retryable: false });
  });

  it('reports an expired session without a payment', () => {
    expect(checkoutState({ attributes: { status: 'expired', payments: [] } }).state).toBe(
      'EXPIRED',
    );
  });

  it('refuses keys that are not PayMongo secret keys', () => {
    expect(
      () => new PayMongoGateway({ secretKey: 'pk_test_x', webhookSecret: WEBHOOK_SECRET }),
    ).toThrow();
  });
});

describe('prepared adapters', () => {
  it('never takes a payment or accepts a webhook', async () => {
    for (const gateway of [new MayaBusinessGateway(), new XenditGateway()]) {
      await expect(gateway.createCheckout()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
      expect(() => gateway.parseWebhook()).toThrow(WebhookSignatureError);
    }
  });
});
