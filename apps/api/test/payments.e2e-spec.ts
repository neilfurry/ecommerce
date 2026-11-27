import type { NestExpressApplication } from '@nestjs/platform-express';
import { expireUnpaidOrders } from '@marketplace/database';
import {
  adminPaymentListSchema,
  adminProofSchema,
  apiErrorBodySchema,
  orderDetailSchema,
  reconciliationSchema,
  refundSchema,
  startPaymentResponseSchema,
  webhookEventListSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, type TestClient } from './auth-helpers';
import { testCategory } from './catalog-helpers';
import { PDF } from './fixtures';
import { deliverMockEvent, order, orderOf, payMock, sessionOf } from './order-helpers';
import { type Listed, listed, PLACES, shopper, shopSeller, type ShopSeller } from './shop-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

/** Phase 5 payments: mock gateway, webhooks, timeouts, bank transfers, refunds of late money. */
describe('Payments (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let finance: TestClient;
  let seller: ShopSeller;
  let item: Listed;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'payments-admin')).client;
    finance = (await signedInClient(app, 'admin', ['FINANCE_ADMIN'], 'finance')).client;
    const categoryId = (await testCategory(app)).id;
    seller = await shopSeller(app, PLACES.quezonCity);
    item = await listed(seller, admin, categoryId, { price: '1200.00', stock: 200 });
  });

  afterAll(async () => {
    await app.close();
  });

  const buyNow = (quantity = 1) => [{ variantId: item.variantId, quantity }];

  it('pays an online order through the mock checkout; the browser redirect alone proves nothing', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, buyNow());
    expect(placed).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' });
    const attempt = placed.payment.attempts[0]!;
    expect(attempt).toMatchObject({ provider: 'MOCK', status: 'PENDING', test: true });
    expect(attempt.checkoutUrl).toMatch(/\/pay\/mock\/cs_mock_/);
    expect(placed.payment.canPay).toBe(true);

    // Coming back from the payment page without paying: the server asks the provider; still unpaid.
    const verified = orderDetailSchema.parse(
      (await buyer.client.post(`/api/v1/account/orders/${placed.id}/payments/verify`).expect(200))
        .body,
    );
    expect(verified.status).toBe('AWAITING_PAYMENT');

    // Another customer cannot open or complete this test checkout.
    const stranger = await shopper(app);
    await stranger.client.get(`/api/v1/dev/mock-payments/${sessionOf(placed)}`).expect(404);

    const session = await payMock(buyer.client, placed);
    expect(session).toMatchObject({ status: 'PAID', test: true, orderId: placed.id });
    const paid = await orderOf(buyer.client, placed.id);
    expect(paid).toMatchObject({ status: 'PLACED', paymentStatus: 'PAID' });
    expect(paid.sellerOrders[0]!.status).toBe('PENDING');
    expect(paid.payment.attempts[0]).toMatchObject({ status: 'PAID', checkoutUrl: null });
    expect(paid.payment.amountReceived).toBe(paid.grandTotal);

    // The receipt and the sale (seller earnings and commission) are posted once (Phase 6
    // double-entry ledger).
    const soId = paid.sellerOrders[0]!.id;
    const sale = await prisma.journalTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `sale:${soId}` },
      include: { entries: true },
    });
    expect(sale.status).toBe('POSTED');
    expect(sale.entries.filter((e) => e.sellerOrderId === soId).map((e) => e.kind)).toEqual(
      expect.arrayContaining(['SALE', 'COMMISSION']),
    );
    await expect(
      prisma.journalTransaction.count({ where: { idempotencyKey: `receipt:${attempt.id}` } }),
    ).resolves.toBe(1);
  });

  it('processes a duplicated (and concurrently retried) webhook once', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, buyNow());
    const attempt = placed.payment.attempts[0]!;
    const event = {
      id: `evt_mock_dup_${Date.now()}`,
      type: 'payment.paid',
      livemode: false,
      data: {
        sessionId: sessionOf(placed),
        paymentReference: attempt.reference,
        paymentId: 'pay_mock_dup',
        amount: attempt.amount,
      },
    };
    const results = await Promise.all([
      deliverMockEvent(app, event),
      deliverMockEvent(app, event),
      deliverMockEvent(app, event),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => (r.body as { duplicate: boolean }).duplicate)).toHaveLength(2);
    const again = await deliverMockEvent(app, event);
    expect(again.body).toEqual({ received: true, duplicate: true });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { events: true },
    });
    expect(payment.status).toBe('PAID');
    expect(payment.amountReceived.toFixed(2)).toBe(attempt.amount);
    expect(payment.events.filter((e) => e.type === 'PAID')).toHaveLength(1);
    const rows = await prisma.webhookEvent.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PROCESSED' });
    const sales = await prisma.journalTransaction.count({
      where: { idempotencyKey: `sale:${placed.sellerOrders[0]!.id}` },
    });
    expect(sales).toBe(1);
  });

  it('refuses events with an invalid or missing signature and stores nothing', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, buyNow());
    const attempt = placed.payment.attempts[0]!;
    const id = `evt_mock_forged_${Date.now()}`;
    const event = {
      id,
      type: 'payment.paid',
      livemode: false,
      data: {
        sessionId: sessionOf(placed),
        paymentReference: attempt.reference,
        paymentId: 'x',
        amount: attempt.amount,
      },
    };
    // Signed, then changed (e.g. the amount) in transit.
    const tampered = await deliverMockEvent(app, event, (raw) =>
      raw.replace(attempt.amount, '1.00'),
    );
    expect(tampered.status).toBe(401);
    const unsigned = await deliverMockEvent(app, event).unset('x-mock-signature');
    expect(unsigned.status).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { eventId: id } })).toBe(0);
    expect((await orderOf(buyer.client, placed.id)).status).toBe('AWAITING_PAYMENT');
  });

  it('records a failed payment, lets the customer try again, and never pays twice', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, buyNow(), 'MAYA');
    await payMock(buyer.client, placed, 'failed');
    const failed = await orderOf(buyer.client, placed.id);
    expect(failed.status).toBe('AWAITING_PAYMENT');
    expect(failed.payment.attempts[0]).toMatchObject({
      status: 'FAILED',
      failureMessage: 'The test payment was declined.',
    });
    expect(failed.payment.canPay).toBe(true);
    expect(failed.events.map((e) => e.type)).toContain('PAYMENT_FAILED');

    const retry = startPaymentResponseSchema.parse(
      (await buyer.client.post(`/api/v1/account/orders/${placed.id}/payments`).expect(200)).body,
    );
    expect(retry.payment.id).not.toBe(placed.payment.attempts[0]!.id);
    // "Pay now" twice returns the same open attempt.
    const same = startPaymentResponseSchema.parse(
      (await buyer.client.post(`/api/v1/account/orders/${placed.id}/payments`).expect(200)).body,
    );
    expect(same.payment.id).toBe(retry.payment.id);

    await payMock(buyer.client, await orderOf(buyer.client, placed.id));
    const paid = await orderOf(buyer.client, placed.id);
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.payment.attempts.map((a) => a.status)).toEqual(['FAILED', 'PAID']);
    expect(errorCode(await buyer.client.post(`/api/v1/account/orders/${placed.id}/payments`))).toBe(
      'CONFLICT',
    );
  });

  it('expires unpaid orders, and money arriving afterwards goes to finance review and can be refunded', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, buyNow(2), 'QR_PH');
    const attempt = placed.payment.attempts[0]!;
    const expired = await expireUnpaidOrders(prisma, {
      now: new Date(new Date(placed.paymentDueAt!).getTime() + 1000),
    });
    expect(expired.map((e) => e.id)).toContain(placed.id);
    const cancelled = await orderOf(buyer.client, placed.id);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', paymentStatus: 'VOIDED' });
    expect(cancelled.payment.attempts[0]!.status).toBe('EXPIRED');
    // The test checkout was closed too: it cannot be completed any more.
    await buyer.client
      .post(`/api/v1/dev/mock-payments/${attempt.checkoutUrl!.split('/').pop()}`)
      .send({ outcome: 'paid' })
      .expect((res) => expect([200, 409]).toContain(res.status));

    // The provider reports a payment anyway (paid at the last second).
    const late = await deliverMockEvent(app, {
      id: `evt_mock_late_${Date.now()}`,
      type: 'payment.paid',
      livemode: false,
      data: {
        sessionId: attempt.checkoutUrl!.split('/').pop(),
        paymentReference: attempt.reference,
        paymentId: 'pay_mock_late',
        amount: attempt.amount,
      },
    });
    expect(late.status).toBe(200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(payment).toMatchObject({ status: 'CANCELLED', reviewReason: 'LATE_PAYMENT' });
    expect((await orderOf(buyer.client, placed.id)).status).toBe('CANCELLED');

    const queue = adminPaymentListSchema.parse(
      (await finance.get('/api/v1/payments?queue=review&search=' + attempt.reference).expect(200))
        .body,
    );
    expect(queue.items.map((p) => p.id)).toEqual([attempt.id]);
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
    const report = reconciliationSchema.parse(
      (await finance.get(`/api/v1/payments/reconciliation?from=${today}&to=${today}`).expect(200))
        .body,
    );
    expect(
      report.exceptions.some((e) => e.paymentId === attempt.id && e.kind === 'LATE_PAYMENT'),
    ).toBe(true);

    const key = `late-${Date.now()}`;
    const body = {
      paymentId: attempt.id,
      reason: 'LATE_PAYMENT',
      kind: 'FULL',
      note: 'Order had expired',
      idempotencyKey: key,
    };
    const refund = refundSchema.parse(
      (await finance.post('/api/v1/refunds').send(body).expect(200)).body,
    );
    expect(refund).toMatchObject({
      status: 'SUCCEEDED',
      amount: attempt.amount,
      method: 'ORIGINAL',
      test: true,
    });
    // The same form submitted again returns the same refund; a new one finds nothing left.
    const again = refundSchema.parse(
      (await finance.post('/api/v1/refunds').send(body).expect(200)).body,
    );
    expect(again.id).toBe(refund.id);
    const more = await finance
      .post('/api/v1/refunds')
      .send({ ...body, idempotencyKey: `${key}-2` });
    expect(more.status).toBe(409);
    expect(
      (
        await prisma.payment.findUniqueOrThrow({ where: { id: attempt.id } })
      ).refundedAmount.toFixed(2),
    ).toBe(attempt.amount);
    await finance
      .post(`/api/v1/payments/${attempt.id}/resolve`)
      .send({ note: 'Refunded in full.' })
      .expect(200);
  });

  it('takes bank transfers: proof upload, finance rejection (more time) and approval', async () => {
    const settings = (await admin.get('/api/v1/settings').expect(200)).body as {
      orders: Record<string, unknown> & { bankTransfer: Record<string, unknown> };
    };
    await admin
      .put('/api/v1/settings/orders')
      .send({
        ...settings.orders,
        bankTransfer: {
          ...settings.orders.bankTransfer,
          accounts: [
            {
              bankName: 'BDO',
              accountName: 'Marketplace Inc.',
              accountNumber: '0012 3456 7890',
              branch: null,
            },
          ],
          instructions: 'Use the payment reference as the transfer note.',
        },
      })
      .expect(200);
    const buyer = await shopper(app);
    const placed = await order(buyer, buyNow(), 'BANK_TRANSFER');
    expect(placed.payment.bankTransfer).toMatchObject({
      reference: placed.payment.attempts[0]!.reference,
      accounts: [expect.objectContaining({ bankName: 'BDO' })],
    });
    expect(placed.payment.canUploadProof).toBe(true);
    const dueAt = new Date(placed.paymentDueAt!);
    expect(dueAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);

    const upload = (reference: string) =>
      buyer.client
        .post(`/api/v1/account/orders/${placed.id}/bank-transfer-proofs`)
        .field('bankName', 'BDO')
        .field('referenceNumber', reference)
        .field('amount', placed.grandTotal)
        .field('transferredAt', new Date().toISOString())
        .attach('file', PDF, 'receipt.pdf');
    const submitted = orderDetailSchema.parse((await upload('BDO-111').expect(200)).body);
    expect(submitted.payment.canUploadProof).toBe(false);
    expect((await upload('BDO-112')).status).toBe(409);

    // A proof under review keeps the order open past its deadline.
    await expireUnpaidOrders(prisma, { now: new Date(dueAt.getTime() + 1000) });
    expect((await orderOf(buyer.client, placed.id)).status).toBe('AWAITING_PAYMENT');

    const proofId = submitted.payment.attempts[0]!.proofs[0]!.id;
    const support = (await signedInClient(app, 'admin', ['CUSTOMER_SUPPORT'], 'support')).client;
    await support.post(`/api/v1/payments/bank-transfer-proofs/${proofId}/approve`).expect(403);
    const rejected = adminProofSchema.parse(
      (
        await finance
          .post(`/api/v1/payments/bank-transfer-proofs/${proofId}/reject`)
          .send({ reason: 'No transfer with this reference arrived.' })
          .expect(200)
      ).body,
    );
    expect(rejected.status).toBe('REJECTED');
    const afterReject = await orderOf(buyer.client, placed.id);
    expect(afterReject.payment.canUploadProof).toBe(true);
    expect(new Date(afterReject.paymentDueAt!).getTime()).toBeGreaterThan(
      Date.now() + 23 * 3_600_000,
    );

    const second = orderDetailSchema.parse((await upload('BDO-113').expect(200)).body);
    const secondProof = second.payment.attempts[0]!.proofs.find((p) => p.status === 'SUBMITTED')!;
    await finance
      .post(`/api/v1/payments/bank-transfer-proofs/${secondProof.id}/approve`)
      .expect(200);
    await finance
      .post(`/api/v1/payments/bank-transfer-proofs/${secondProof.id}/approve`)
      .expect(409);
    const paid = await orderOf(buyer.client, placed.id);
    expect(paid).toMatchObject({ status: 'PLACED', paymentStatus: 'PAID' });
    expect(paid.sellerOrders[0]!.status).toBe('PENDING');

    await admin
      .put('/api/v1/settings/orders')
      .send({ ...settings.orders, bankTransfer: { ...settings.orders.bankTransfer, accounts: [] } })
      .expect(200);
  });

  it('lists provider events for staff and reprocesses failed ones only', async () => {
    const events = webhookEventListSchema.parse(
      (await finance.get('/api/v1/payments/webhook-events?source=mock-payments').expect(200)).body,
    );
    expect(events.items.length).toBeGreaterThan(0);
    const processed = events.items.find((e) => e.status === 'PROCESSED')!;
    const res = await admin.post(`/api/v1/payments/webhook-events/${processed.id}/reprocess`);
    expect(res.status).toBe(409);
    expect(JSON.stringify(events)).not.toContain('payload');
    const gateways = (await finance.get('/api/v1/payments/gateways').expect(200)).body as {
      items: { provider: string; active: boolean; livemode: boolean }[];
    };
    expect(gateways.items.find((g) => g.provider === 'MOCK')).toMatchObject({
      active: true,
      livemode: false,
    });
    expect(gateways.items.find((g) => g.provider === 'MAYA_BUSINESS')).toMatchObject({
      active: false,
    });
  });
});
