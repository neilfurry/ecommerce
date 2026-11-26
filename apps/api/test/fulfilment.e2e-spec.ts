import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  codCollectionListSchema,
  refundSchema,
  remittanceSchema,
  returnSchema,
  sellerLedgerSchema,
  sellerOrderCountsSchema,
  sellerOrderDetailSchema,
  sellerOrderListSchema,
  shipmentSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, type TestClient } from './auth-helpers';
import { image, testCategory, testEmployee } from './catalog-helpers';
import { acceptAndShip, courier, order, orderOf, payMock, sellerOrderOf } from './order-helpers';
import { type Listed, listed, PLACES, shopper, shopSeller, type ShopSeller } from './shop-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

/** Phase 5 fulfilment: seller orders, shipments, COD, cancellations, refunds and returns. */
describe('Fulfilment (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let finance: TestClient;
  let sellerA: ShopSeller;
  let sellerB: ShopSeller;
  let lamp: Listed;
  let mug: Listed;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'fulfilment-admin')).client;
    finance = (await signedInClient(app, 'admin', ['FINANCE_ADMIN'], 'fulfilment-finance')).client;
    const categoryId = (await testCategory(app)).id;
    sellerA = await shopSeller(app, PLACES.quezonCity);
    sellerB = await shopSeller(app, PLACES.cebuCity);
    lamp = await listed(sellerA, admin, categoryId, {
      name: 'Desk Lamp',
      price: '1500.00',
      stock: 100,
    });
    mug = await listed(sellerB, admin, categoryId, {
      name: 'Coffee Mug',
      price: '300.00',
      stock: 100,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const levelOf = (variantId: string) =>
    prisma.stockLevel.findFirstOrThrow({ where: { variantId } });

  it('splits a paid order per seller: each seller sees and ships only its own, the customer sees both', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [
      { variantId: lamp.variantId, quantity: 2 },
      { variantId: mug.variantId, quantity: 3 },
    ]);
    expect(placed.sellerOrders).toHaveLength(2);
    await payMock(buyer.client, placed);
    const soA = placed.sellerOrders.find((so) => so.sellerId === sellerA.sellerId)!;
    const soB = placed.sellerOrders.find((so) => so.sellerId === sellerB.sellerId)!;

    // Isolation: another seller's order does not exist for them.
    await sellerB.client.get(`/api/v1/seller/orders/${soA.id}`).expect(404);
    await sellerB.client.post(`/api/v1/seller/orders/${soA.id}/accept`).expect(404);
    const listB = sellerOrderListSchema.parse(
      (await sellerB.client.get('/api/v1/seller/orders?tab=NEW&pageSize=100').expect(200)).body,
    );
    expect(listB.items.map((s) => s.id)).toContain(soB.id);
    expect(listB.items.map((s) => s.id)).not.toContain(soA.id);
    const counts = sellerOrderCountsSchema.parse(
      (await sellerA.client.get('/api/v1/seller/orders/counts').expect(200)).body,
    );
    expect(counts.NEW).toBeGreaterThanOrEqual(1);

    // A read-only employee sees but cannot act.
    const viewer = await testEmployee(app, sellerA.sellerId, 'SELLER_ACCOUNTING');
    const seen = await viewer.client.get(`/api/v1/seller/orders/${soA.id}`);
    if (seen.status === 200) {
      expect(sellerOrderDetailSchema.parse(seen.body).actions.accept).toBe(false);
    }
    await viewer.client.post(`/api/v1/seller/orders/${soA.id}/accept`).expect(403);

    const before = await levelOf(lamp.variantId);
    const shipment = await acceptAndShip(sellerA.client, soA.id);
    expect(shipment).toMatchObject({
      carrier: 'MOCK',
      status: 'BOOKED',
      test: true,
      hasWaybill: true,
    });
    expect(shipment.trackingNumber).toMatch(/^MCK\d{10}$/);
    const label = await sellerA.client
      .get(`/api/v1/seller/shipments/${shipment.id}/waybill`)
      .expect(200);
    expect(label.headers['content-type']).toBe('application/pdf');
    expect((label.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await sellerB.client.get(`/api/v1/seller/shipments/${shipment.id}/waybill`).expect(404);

    await courier(admin, shipment.id, 'PICKED_UP');
    const after = await levelOf(lamp.variantId);
    // Held units left the warehouse at pickup.
    expect(after.quantityOnHand).toBe(before.quantityOnHand - 2);
    expect(after.reservedQuantity).toBe(before.reservedQuantity - 2);
    await courier(admin, shipment.id, 'IN_TRANSIT');
    await courier(admin, shipment.id, 'DELIVERED');

    const view = await orderOf(buyer.client, placed.id);
    const a = view.sellerOrders.find((so) => so.id === soA.id)!;
    const b = view.sellerOrders.find((so) => so.id === soB.id)!;
    expect(a.status).toBe('DELIVERED');
    expect(a.returnWindowEndsAt).not.toBeNull();
    expect(a.shipments[0]!.events.map((e) => e.status)).toEqual([
      'BOOKED',
      'PICKED_UP',
      'IN_TRANSIT',
      'DELIVERED',
    ]);
    expect(a.actions.requestReturn).toBe(true);
    expect(b.status).toBe('PENDING');
    expect(view.status).toBe('PLACED');

    // Seller B cancels after payment: refunded automatically, payables corrected once.
    await sellerB.client
      .post(`/api/v1/seller/orders/${soB.id}/cancel`)
      .send({ reason: 'Out of stock after a warehouse count.' })
      .expect(200);
    const cancelledB = await sellerOrderOf(sellerB.client, soB.id);
    expect(cancelledB.status).toBe('CANCELLED');
    expect(cancelledB.refunds).toHaveLength(1);
    expect(cancelledB.refunds[0]).toMatchObject({
      reason: 'CANCELLATION',
      status: 'SUCCEEDED',
      amount: soB.total,
    });
    expect(cancelledB.ledger.map((e) => e.type).sort()).toEqual(
      ['COMMISSION', 'COMMISSION_REVERSAL', 'ORDER_EARNING', 'REFUND'].sort(),
    );
    const balance = cancelledB.ledger.reduce((s, e) => s + Number(e.amount), 0);
    expect(balance).toBeCloseTo(0, 2);
    expect((await orderOf(buyer.client, placed.id)).paymentStatus).toBe('PARTIALLY_REFUNDED');

    // No second refund for the same cancellation, from any path.
    const dup = await finance.post('/api/v1/refunds').send({
      sellerOrderId: soB.id,
      reason: 'CANCELLATION',
      kind: 'FULL',
      note: 'Trying again',
      idempotencyKey: `dup-${Date.now()}`,
    });
    expect(dup.status).toBe(409);

    // Partial refund on the delivered part (goodwill: the marketplace's cost).
    const partial = refundSchema.parse(
      (
        await finance
          .post('/api/v1/refunds')
          .send({
            sellerOrderId: soA.id,
            reason: 'GOODWILL',
            kind: 'PARTIAL',
            amount: '100.00',
            note: 'Late delivery voucher',
            idempotencyKey: `partial-${Date.now()}`,
          })
          .expect(200)
      ).body,
    );
    expect(partial).toMatchObject({
      kind: 'PARTIAL',
      status: 'SUCCEEDED',
      amount: '100.00',
      sellerDebit: '0.00',
    });
    const tooMuch = await finance.post('/api/v1/refunds').send({
      sellerOrderId: soA.id,
      reason: 'OTHER',
      kind: 'PARTIAL',
      amount: '999999.00',
      note: 'Too much',
      idempotencyKey: `too-much-${Date.now()}`,
    });
    expect(tooMuch.status).toBe(409);
  });

  it('enforces the state machine and lets only one of two concurrent changes win', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: lamp.variantId, quantity: 1 }], 'COD');
    const so = placed.sellerOrders[0]!;
    expect(so.status).toBe('PENDING');
    // Shipping before accepting, and customer-driven delivery of a courier parcel, are refused.
    const early = await sellerA.client
      .post(`/api/v1/seller/orders/${so.id}/shipments`)
      .send({ carrier: 'MOCK' });
    expect(errorCode(early)).toBe('INVALID_TRANSITION');

    const results = await Promise.all([
      sellerA.client.post(`/api/v1/seller/orders/${so.id}/accept`),
      sellerA.client.post(`/api/v1/seller/orders/${so.id}/accept`),
      sellerA.client.post(`/api/v1/seller/orders/${so.id}/accept`),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);

    // The customer can no longer cancel directly; they ask instead (once).
    expect(
      errorCode(
        await buyer.client
          .post(`/api/v1/account/seller-orders/${so.id}/cancel`)
          .send({ reason: 'Changed my mind' }),
      ),
    ).toBe('INVALID_TRANSITION');
    await buyer.client
      .post(`/api/v1/account/seller-orders/${so.id}/cancellation-request`)
      .send({ reason: 'Ordered the wrong colour' })
      .expect(200);
    await buyer.client
      .post(`/api/v1/account/seller-orders/${so.id}/cancellation-request`)
      .send({ reason: 'Again' })
      .expect(409);
    const answers = await Promise.all([
      sellerA.client.post(`/api/v1/seller/orders/${so.id}/cancellation-request/approve`).send({}),
      sellerA.client
        .post(`/api/v1/seller/orders/${so.id}/cancellation-request/reject`)
        .send({ response: 'Already packed, sorry.' }),
    ]);
    expect(answers.filter((r) => r.status === 200)).toHaveLength(1);
    const final = await sellerOrderOf(sellerA.client, so.id);
    expect(final.cancellationRequest!.status).not.toBe('REQUESTED');
    if (final.status === 'CANCELLED') {
      // COD never collected: the collection is closed and nothing is refunded.
      expect(final.cod).toMatchObject({ status: 'FAILED' });
      expect(final.refunds).toHaveLength(0);
    }
  });

  it('cash on delivery counts as received only when the courier’s remittance is recorded', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: mug.variantId, quantity: 2 }], 'COD');
    const so = placed.sellerOrders[0]!;
    expect(so.cod).toMatchObject({ status: 'PENDING', expectedAmount: so.total });
    const shipment = await acceptAndShip(sellerB.client, so.id);
    expect(shipment.codAmount).toBe(so.total);
    await courier(admin, shipment.id, 'PICKED_UP');
    await courier(admin, shipment.id, 'DELIVERED');

    const delivered = await sellerOrderOf(sellerB.client, so.id);
    expect(delivered.cod).toMatchObject({ status: 'COLLECTED' });
    // Collected by the courier is not money received: no earnings yet, order still pay-on-delivery.
    expect(delivered.ledger).toHaveLength(0);
    expect(delivered.paymentStatus).toBe('PAY_ON_DELIVERY');

    const collections = codCollectionListSchema.parse(
      (
        await finance
          .get('/api/v1/cod/collections?status=COLLECTED&carrier=MOCK&pageSize=100')
          .expect(200)
      ).body,
    );
    const mine = collections.items.find((c) => c.sellerOrderId === so.id)!;
    expect(mine.collectedAmount).toBe(so.total);
    const reference = `RMT-${Date.now()}`;
    const short = await finance.post('/api/v1/cod/remittances').send({
      carrier: 'MOCK',
      reference,
      remittedAt: new Date().toISOString(),
      amount: '1.00',
      collectionIds: [mine.id],
    });
    expect(short.status).toBe(422);
    const remittance = remittanceSchema.parse(
      (
        await finance
          .post('/api/v1/cod/remittances')
          .send({
            carrier: 'MOCK',
            reference,
            remittedAt: new Date().toISOString(),
            amount: so.total,
            collectionIds: [mine.id],
          })
          .expect(200)
      ).body,
    );
    expect(remittance).toMatchObject({
      amount: so.total,
      expectedAmount: so.total,
      collections: 1,
    });
    const again = await finance.post('/api/v1/cod/remittances').send({
      carrier: 'MOCK',
      reference,
      remittedAt: new Date().toISOString(),
      amount: so.total,
      collectionIds: [mine.id],
    });
    expect(again.status).toBe(409);

    const remitted = await sellerOrderOf(sellerB.client, so.id);
    expect(remitted.cod).toMatchObject({ status: 'REMITTED' });
    expect(remitted.paymentStatus).toBe('PAID');
    expect(remitted.ledger.map((e) => e.type).sort()).toEqual(['COMMISSION', 'ORDER_EARNING']);
    const ledger = sellerLedgerSchema.parse(
      (await sellerB.client.get('/api/v1/seller/ledger').expect(200)).body,
    );
    expect(ledger.items.some((e) => e.sellerOrderId === so.id)).toBe(true);
  });

  it('returns an undelivered parcel to the seller: stock back, COD not collected', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: lamp.variantId, quantity: 1 }], 'COD');
    const so = placed.sellerOrders[0]!;
    const shipment = await acceptAndShip(sellerA.client, so.id);
    await courier(admin, shipment.id, 'PICKED_UP');
    const level = await levelOf(lamp.variantId);
    await courier(admin, shipment.id, 'DELIVERY_FAILED');
    expect((await sellerOrderOf(sellerA.client, so.id)).status).toBe('DELIVERY_FAILED');
    // An impossible courier event (delivered → booked style) is kept in history but changes nothing.
    await courier(admin, shipment.id, 'RETURNED');
    expect((await sellerOrderOf(sellerA.client, so.id)).status).toBe('DELIVERY_FAILED');
    await courier(admin, shipment.id, 'RETURNING');
    const tracked = shipmentSchema.parse(await courier(admin, shipment.id, 'RETURNED'));
    expect(tracked.status).toBe('RETURNED');
    const after = await sellerOrderOf(sellerA.client, so.id);
    expect(after.status).toBe('RETURNED_TO_SELLER');
    expect(after.cod).toMatchObject({ status: 'FAILED' });
    expect((await levelOf(lamp.variantId)).quantityOnHand).toBe(level.quantityOnHand + 1);
    const view = await orderOf(buyer.client, placed.id);
    expect(view).toMatchObject({ status: 'CANCELLED', paymentStatus: 'VOIDED' });

    // Manual updates follow the shipment state machine too.
    const self = await shopper(app);
    const other = await order(self, [{ variantId: lamp.variantId, quantity: 1 }], 'COD');
    await sellerA.client
      .post(`/api/v1/seller/orders/${other.sellerOrders[0]!.id}/accept`)
      .expect(200);
    const own = shipmentSchema.parse(
      (
        await sellerA.client
          .post(`/api/v1/seller/orders/${other.sellerOrders[0]!.id}/shipments`)
          .send({ carrier: 'SELF', carrierName: 'Lalamove', trackingNumber: 'LLM-12345' })
          .expect(200)
      ).body,
    );
    const jump = await sellerA.client
      .post(`/api/v1/seller/shipments/${own.id}/events`)
      .send({ status: 'RETURNED' });
    expect(errorCode(jump)).toBe('INVALID_TRANSITION');
    await sellerA.client
      .post(`/api/v1/seller/shipments/${own.id}/events`)
      .send({ status: 'PICKED_UP' })
      .expect(200);
    await self.client
      .post(`/api/v1/account/seller-orders/${other.sellerOrders[0]!.id}/confirm-received`)
      .expect(200);
    expect((await orderOf(self.client, other.id)).sellerOrders[0]!.status).toBe('DELIVERED');
  });

  it('handles a return: request with photos, seller approval, item back, refund and payables', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: mug.variantId, quantity: 4 }]);
    await payMock(buyer.client, placed);
    const so = placed.sellerOrders[0]!;
    const shipment = await acceptAndShip(sellerB.client, so.id);
    await courier(admin, shipment.id, 'PICKED_UP');
    await courier(admin, shipment.id, 'DELIVERED');
    const itemId = so.items[0]!.id;

    const created = returnSchema.parse(
      (
        await buyer.client
          .post('/api/v1/account/returns')
          .field(
            'data',
            JSON.stringify({
              sellerOrderId: so.id,
              items: [{ orderItemId: itemId, quantity: 2 }],
              reason: 'DAMAGED',
              description: 'Two mugs arrived with cracked handles.',
              requestedResolution: 'FULL_REFUND',
            }),
          )
          .attach('images', await image(800, 600), 'crack.jpg')
          .expect(200)
      ).body,
    );
    expect(created).toMatchObject({ status: 'REQUESTED', maxRefund: '600.00' });
    expect(created.images).toHaveLength(1);
    // One open return at a time; a second is refused.
    const second = await buyer.client.post('/api/v1/account/returns').field(
      'data',
      JSON.stringify({
        sellerOrderId: so.id,
        items: [{ orderItemId: itemId, quantity: 1 }],
        reason: 'OTHER',
        description: 'Another problem with the order.',
        requestedResolution: 'FULL_REFUND',
      }),
    );
    expect(second.status).toBe(409);
    await sellerA.client.get(`/api/v1/seller/returns/${created.id}`).expect(404);

    const approved = returnSchema.parse(
      (
        await sellerB.client
          .post(`/api/v1/seller/returns/${created.id}/approve`)
          .send({
            resolution: 'FULL_REFUND',
            requiresReturnShipment: true,
            response: 'Sorry! Please send them back.',
          })
          .expect(200)
      ).body,
    );
    expect(approved).toMatchObject({ status: 'APPROVED', refundAmount: '600.00' });
    await buyer.client
      .post(`/api/v1/account/returns/${created.id}/ship-back`)
      .send({ carrierName: 'J&T Express', trackingNumber: 'JT0001234' })
      .expect(200);
    const level = await levelOf(mug.variantId);
    const received = await Promise.all([
      sellerB.client.post(`/api/v1/seller/returns/${created.id}/receive`).send({ restock: true }),
      sellerB.client.post(`/api/v1/seller/returns/${created.id}/receive`).send({ restock: true }),
    ]);
    expect(received.map((r) => r.status).sort()).toEqual([200, 409]);
    const resolved = returnSchema.parse(
      (await buyer.client.get(`/api/v1/account/returns/${created.id}`).expect(200)).body,
    );
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.refunds).toHaveLength(1);
    expect(resolved.refunds[0]).toMatchObject({
      reason: 'RETURN',
      status: 'SUCCEEDED',
      amount: '600.00',
    });
    expect((await levelOf(mug.variantId)).quantityOnHand).toBe(level.quantityOnHand + 2);
    const detail = await sellerOrderOf(sellerB.client, so.id);
    const refundEntry = detail.ledger.find((e) => e.type === 'REFUND')!;
    expect(Number(refundEntry.amount)).toBeLessThan(0);
    expect(detail.ledger.some((e) => e.type === 'COMMISSION_REVERSAL')).toBe(true);
  });

  it('lets the customer escalate a rejected return and staff decide a partial refund', async () => {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: lamp.variantId, quantity: 1 }]);
    await payMock(buyer.client, placed);
    const so = placed.sellerOrders[0]!;
    const shipment = await acceptAndShip(sellerA.client, so.id);
    await courier(admin, shipment.id, 'DELIVERED');
    const created = returnSchema.parse(
      (
        await buyer.client
          .post('/api/v1/account/returns')
          .field(
            'data',
            JSON.stringify({
              sellerOrderId: so.id,
              items: [{ orderItemId: so.items[0]!.id, quantity: 1 }],
              reason: 'NOT_AS_DESCRIBED',
              description: 'The lamp is much dimmer than described.',
              requestedResolution: 'FULL_REFUND',
            }),
          )
          .expect(200)
      ).body,
    );
    await buyer.client
      .post(`/api/v1/account/returns/${created.id}/escalate`)
      .send({ note: 'The seller has not answered yet.' })
      .expect(409);
    await sellerA.client
      .post(`/api/v1/seller/returns/${created.id}/reject`)
      .send({ response: 'The brightness is listed correctly.' })
      .expect(200);
    await buyer.client
      .post(`/api/v1/account/returns/${created.id}/escalate`)
      .send({ note: 'It is half as bright as the photos suggest.' })
      .expect(200);
    const support = (await signedInClient(app, 'admin', ['CUSTOMER_SUPPORT'], 'disputes')).client;
    const decided = returnSchema.parse(
      (
        await support
          .post(`/api/v1/returns/${created.id}/decide`)
          .send({
            resolution: 'PARTIAL_REFUND',
            refundAmount: '500.00',
            note: 'Partial refund; keep the lamp.',
          })
          .expect(200)
      ).body,
    );
    expect(decided).toMatchObject({
      status: 'RESOLVED',
      resolution: 'PARTIAL_REFUND',
      refundAmount: '500.00',
    });
    expect(decided.refunds[0]).toMatchObject({
      kind: 'PARTIAL',
      amount: '500.00',
      status: 'SUCCEEDED',
    });
    await support
      .post(`/api/v1/returns/${created.id}/decide`)
      .send({ resolution: 'FULL_REFUND', note: 'Changing my mind afterwards.' })
      .expect(409);
  });
});
