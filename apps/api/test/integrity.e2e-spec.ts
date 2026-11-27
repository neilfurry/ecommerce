import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  codCollectionListSchema,
  reconciliationReportSchema,
  refundSchema,
  ticketDetailSchema,
} from '@marketplace/validation';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, type TestClient } from './auth-helpers';
import { testCategory } from './catalog-helpers';
import {
  acceptAndShip,
  courier,
  deliverMockEvent,
  order,
  payMock,
  sessionOf,
} from './order-helpers';
import {
  type Listed,
  listed,
  PLACES,
  placeOrder,
  shopper,
  shopSeller,
  type ShopSeller,
} from './shop-helpers';
import { createTestApp } from './test-app';

/**
 * Phase 8 data-integrity audit: money and stock stay correct under duplicate and concurrent
 * requests, failed work rolls back completely, and one seller can never reach another's data.
 * Earlier phases test the single-request paths; these push them concurrently, then run the
 * finance reconciliation (ledger + operational checks) over the whole database.
 */
describe('Data integrity and isolation (Phase 8, e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let finance: TestClient;
  let sellerA: ShopSeller;
  let sellerB: ShopSeller;
  let categoryId: string;
  let lamp: Listed;
  let mug: Listed;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'integrity-admin')).client;
    finance = (await signedInClient(app, 'admin', ['FINANCE_ADMIN'], 'integrity-finance')).client;
    categoryId = (await testCategory(app)).id;
    sellerA = await shopSeller(app, PLACES.quezonCity);
    sellerB = await shopSeller(app, PLACES.cebuCity);
    lamp = await listed(sellerA, admin, categoryId, { price: '1000.00', stock: 200 });
    mug = await listed(sellerB, admin, categoryId, { price: '300.00', stock: 200 });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('applies each payment once under a burst of distinct, duplicated and concurrent webhooks', async () => {
    const buyers = await Promise.all(Array.from({ length: 8 }, () => shopper(app)));
    const orders = await Promise.all(
      buyers.map((b) => order(b, [{ variantId: lamp.variantId, quantity: 1 }])),
    );
    const deliveries = orders.flatMap((placed) => {
      const attempt = placed.payment.attempts[0]!;
      const event = (id: string) => ({
        id,
        type: 'payment.paid',
        livemode: false,
        data: {
          sessionId: sessionOf(placed),
          paymentReference: attempt.reference,
          paymentId: `pay_burst_${attempt.id}`,
          amount: attempt.amount,
        },
      });
      // The provider resends with new event ids and retries the same id.
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      return [...ids, ids[0]!].map((id) => deliverMockEvent(app, event(`evt_burst_${id}`)));
    });
    const results = await Promise.all(deliveries);
    expect(results.filter((r) => r.status !== 200).map((r) => r.status)).toEqual([]);

    for (const placed of orders) {
      const attempt = placed.payment.attempts[0]!;
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { events: true },
      });
      expect(payment.status).toBe('PAID');
      expect(payment.amountReceived.toFixed(2)).toBe(attempt.amount);
      expect(payment.events.filter((e) => e.type === 'PAID')).toHaveLength(1);
      expect(
        await prisma.journalTransaction.count({
          where: {
            idempotencyKey: { in: [`receipt:${attempt.id}`, `sale:${placed.sellerOrders[0]!.id}`] },
          },
        }),
      ).toBe(2);
      expect(await prisma.payment.count({ where: { orderId: placed.id, status: 'PAID' } })).toBe(1);
    }
  }, 120_000);

  it('never refunds more than was paid, whatever the number of concurrent refund requests', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: lamp.variantId, quantity: 1 }]);
    await payMock(buyer.client, placed);
    const so = placed.sellerOrders[0]!;
    const sameKey = `integrity-same-${randomUUID()}`;
    const partial = (idempotencyKey: string) =>
      finance.post('/api/v1/refunds').send({
        sellerOrderId: so.id,
        reason: 'GOODWILL',
        kind: 'PARTIAL',
        amount: '300.00',
        note: 'Concurrency test',
        idempotencyKey,
      });
    // The same request retried at once (same idempotency key) gives one refund.
    const repeated = await Promise.all(Array.from({ length: 4 }, () => partial(sameKey)));
    for (const r of repeated) expect([200, 409]).toContain(r.status);
    const sameKeyRows = await prisma.refund.findMany({
      where: { idempotencyKey: { endsWith: `:${sameKey}` } },
    });
    expect(sameKeyRows).toHaveLength(1);
    const repeatedIds = repeated
      .filter((r) => r.status === 200)
      .map((r) => refundSchema.parse(r.body).id);
    expect(new Set(repeatedIds)).toEqual(new Set([sameKeyRows[0]!.id]));

    // Different refunds at once: only as many as the money received allows.
    const distinct = await Promise.all(
      Array.from({ length: 6 }, () => partial(`integrity-${randomUUID()}`)),
    );
    for (const r of distinct) expect([200, 409]).toContain(r.status);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: placed.id, status: 'PAID' },
    });
    const refunds = await prisma.refund.findMany({
      where: { paymentId: payment.id, status: { not: 'FAILED' } },
    });
    const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(Number(payment.refundedAmount)).toBeCloseTo(refunded, 2);
    expect(Number(payment.refundedAmount)).toBeLessThanOrEqual(Number(payment.amountReceived));
    // ₱1,000 item + shipping: at most three ₱300 refunds fit.
    expect(refunds.length).toBeLessThanOrEqual(Math.floor(Number(payment.amountReceived) / 300));
    expect(
      await prisma.journalTransaction.count({
        where: { idempotencyKey: { in: refunds.map((r) => `refund:${r.id}`) } },
      }),
    ).toBe(refunds.filter((r) => r.status === 'SUCCEEDED').length);
  }, 120_000);

  it('never refunds a seller order beyond its own total when one payment covers several sellers', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [
      { variantId: lamp.variantId, quantity: 1 },
      { variantId: mug.variantId, quantity: 2 },
    ]);
    await payMock(buyer.client, placed);
    const soA = placed.sellerOrders.find((so) => so.sellerId === sellerA.sellerId)!;
    // Each ₱650 fits in the whole payment, but only one fits in seller A's part.
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        finance.post('/api/v1/refunds').send({
          sellerOrderId: soA.id,
          reason: 'OTHER',
          kind: 'PARTIAL',
          amount: '650.00',
          note: 'Concurrency test',
          idempotencyKey: `integrity-so-${randomUUID()}`,
        }),
      ),
    );
    for (const r of results) expect([200, 409]).toContain(r.status);
    const refunds = await prisma.refund.findMany({
      where: { sellerOrderId: soA.id, status: { not: 'FAILED' } },
    });
    const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(refunded).toBeLessThanOrEqual(Number(soA.total));
    expect(refunds).toHaveLength(1);
  }, 120_000);

  it('records a COD remittance once when it is submitted several times at once', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: mug.variantId, quantity: 2 }], 'COD');
    const so = placed.sellerOrders[0]!;
    const shipment = await acceptAndShip(sellerB.client, so.id);
    await courier(admin, shipment.id, 'PICKED_UP');
    await courier(admin, shipment.id, 'DELIVERED');
    const collections = codCollectionListSchema.parse(
      (
        await finance
          .get('/api/v1/cod/collections?status=COLLECTED&carrier=MOCK&pageSize=100')
          .expect(200)
      ).body,
    );
    const mine = collections.items.find((c) => c.sellerOrderId === so.id)!;
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        finance.post('/api/v1/cod/remittances').send({
          carrier: 'MOCK',
          reference: `RMT-INT-${Date.now()}-${i}`,
          remittedAt: new Date().toISOString(),
          amount: so.total,
          collectionIds: [mine.id],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect(r.status).toBe(409);
    const collection = await prisma.codCollection.findUniqueOrThrow({ where: { id: mine.id } });
    expect(collection.status).toBe('REMITTED');
    expect(
      await prisma.journalTransaction.count({ where: { idempotencyKey: `sale:${so.id}` } }),
    ).toBe(1);
  }, 120_000);

  it('rolls a failed checkout back completely: no order, no stock held', async () => {
    const scarce = await listed(sellerB, admin, categoryId, { price: '250.00', stock: 3 });
    const buyer = await shopper(app);
    await buyer.client
      .post('/api/v1/cart/items')
      .send({ variantId: lamp.variantId, quantity: 1 })
      .expect(200);
    await buyer.client
      .post('/api/v1/cart/items')
      .send({ variantId: scarce.variantId, quantity: 3 })
      .expect(200);
    const lampBefore = await prisma.stockLevel.findFirstOrThrow({
      where: { variantId: lamp.variantId },
    });
    // The last units sell out between the quote and the order: the second seller's part fails.
    const other = await shopper(app);
    const sold = await placeOrder(other.client, {
      addressId: other.addressId,
      buyNow: { variantId: scarce.variantId, quantity: 1 },
    });
    expect(sold.status).toBe(201);

    const res = await placeOrder(buyer.client, { addressId: buyer.addressId });
    expect([409, 422]).toContain(res.status);
    expect(await prisma.order.count({ where: { customerId: buyer.userId } })).toBe(0);
    const lampAfter = await prisma.stockLevel.findFirstOrThrow({
      where: { variantId: lamp.variantId },
    });
    expect(lampAfter.reservedQuantity).toBe(lampBefore.reservedQuantity);
    expect(lampAfter.quantityOnHand).toBe(lampBefore.quantityOnHand);
    const scarceLevel = await prisma.stockLevel.findFirstOrThrow({
      where: { variantId: scarce.variantId },
    });
    expect(scarceLevel.reservedQuantity).toBe(1);
  }, 120_000);

  describe('seller isolation matrix', () => {
    let ids: Record<string, string>;

    beforeAll(async () => {
      const buyer = await shopper(app);
      const placed = await order(buyer, [{ variantId: lamp.variantId, quantity: 1 }], 'COD');
      const so = placed.sellerOrders[0]!;
      const shipment = await acceptAndShip(sellerA.client, so.id);
      const ticket = ticketDetailSchema.parse(
        (
          await buyer.client
            .post('/api/v1/account/support/tickets')
            .field(
              'data',
              JSON.stringify({
                subject: 'Where is it?',
                category: 'ORDER',
                sellerOrderId: so.id,
                body: 'Hello',
              }),
            )
            .expect(200)
        ).body,
      );
      ids = {
        product: lamp.productId,
        store: sellerA.storeId,
        sellerOrder: so.id,
        shipment: shipment.id,
        ticket: ticket.id,
        warehouse: sellerA.warehouseId,
        variant: lamp.variantId,
      };
    }, 120_000);

    const reads: [string, (i: Record<string, string>) => string][] = [
      ['product', (i) => `/api/v1/products/${i.product}`],
      ['product customer prices', (i) => `/api/v1/products/${i.product}/customer-prices`],
      ['store', (i) => `/api/v1/stores/${i.store}`],
      ['seller order', (i) => `/api/v1/seller/orders/${i.sellerOrder}`],
      ['waybill', (i) => `/api/v1/seller/shipments/${i.shipment}/waybill`],
      ['support ticket', (i) => `/api/v1/seller/support/tickets/${i.ticket}`],
    ];

    it.each(reads)('another seller cannot read: %s', async (_name, path) => {
      const res = await sellerB.client.get(path(ids));
      expect([403, 404]).toContain(res.status);
      // The owner can (the route is real, so the refusal above is about ownership).
      expect((await sellerA.client.get(path(ids))).status).toBe(200);
    });

    it('another seller cannot change or act on the first seller’s records', async () => {
      const attempts = [
        sellerB.client.patch(`/api/v1/products/${ids.product}`).send({ name: 'Hijacked name' }),
        sellerB.client.patch(`/api/v1/stores/${ids.store}`).send({ name: 'Hijacked store' }),
        sellerB.client
          .post(`/api/v1/seller/orders/${ids.sellerOrder}/cancel`)
          .send({ reason: 'Not mine' }),
        sellerB.client
          .post(`/api/v1/seller/support/tickets/${ids.ticket}/messages`)
          .field('data', JSON.stringify({ body: 'Not my ticket' })),
        sellerB.client.post('/api/v1/inventory/movements').send({
          warehouseId: ids.warehouse,
          variantId: ids.variant,
          type: 'STOCK_IN',
          quantity: 5,
        }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect([403, 404, 422]).toContain(res.status);
      }
      const product = await prisma.product.findUniqueOrThrow({ where: { id: ids.product } });
      expect(product.name).not.toBe('Hijacked name');
      const store = await prisma.store.findUniqueOrThrow({ where: { id: ids.store } });
      expect(store.name).not.toBe('Hijacked store');
      const so = await prisma.sellerOrder.findUniqueOrThrow({ where: { id: ids.sellerOrder } });
      expect(so.status).not.toBe('CANCELLED');
    });

    it('lists never include another seller’s records', async () => {
      const orders = (await sellerB.client.get('/api/v1/seller/orders?pageSize=100').expect(200))
        .body as {
        items: { id: string }[];
      };
      expect(orders.items.map((o) => o.id)).not.toContain(ids.sellerOrder);
      const tickets = (await sellerB.client.get('/api/v1/seller/support/tickets').expect(200))
        .body as {
        items: { id: string }[];
      };
      expect(tickets.items.map((t) => t.id)).not.toContain(ids.ticket);
    });
  });

  it('the whole database reconciles: ledger, stock holds, refunds and order totals', async () => {
    const report = reconciliationReportSchema.parse(
      (await finance.get('/api/v1/finance/reconciliation').expect(200)).body,
    );
    expect(report.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining([
        'BALANCED',
        'STOCK_HOLDS',
        'REFUND_TOTALS',
        'DOUBLE_PAID',
        'ORDER_TOTALS',
      ]),
    );
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  }, 60_000);
});
