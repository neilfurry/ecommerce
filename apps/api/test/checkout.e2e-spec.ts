import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { EMAIL_JOBS } from '@marketplace/config';
import { Prisma } from '@marketplace/database';
import {
  apiErrorBodySchema,
  cartSchema,
  orderDetailSchema,
  sellerOrderDetailSchema,
  sellerOrderListSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { findJob, signedInClient, type TestClient } from './auth-helpers';
import { testCategory } from './catalog-helpers';
import {
  type Listed,
  listed,
  PLACES,
  placeOrder,
  quote,
  shopper,
  shopSeller,
  type ShopSeller,
} from './shop-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const D = (v: string) => new Prisma.Decimal(v);

/** Multi-seller checkout: quote, order with seller suborders, reservations and isolation. */
describe('Checkout (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let categoryId: string;
  let sellerA: ShopSeller;
  let sellerB: ShopSeller;
  let laptop: Listed;
  let mouse: Listed;
  let keyboard: Listed;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'checkout-admin')).client;
    categoryId = (await testCategory(app)).id;
    sellerA = await shopSeller(app, PLACES.cebuCity);
    sellerB = await shopSeller(app, PLACES.davaoCity);
    laptop = await listed(sellerA, admin, categoryId, {
      name: 'Aero 14 Laptop',
      price: '32999.00',
      weightGrams: 1900,
      dims: ['38', '27', '6'],
      stock: 10,
    });
    mouse = await listed(sellerB, admin, categoryId, {
      name: 'Silent Mouse',
      price: '599.00',
      weightGrams: 120,
      dims: ['12', '8', '5'],
      stock: 40,
    });
    keyboard = await listed(sellerB, admin, categoryId, {
      name: 'Mechanical Keyboard',
      price: '2499.00',
      weightGrams: 900,
      dims: ['40', '16', '5'],
      stock: 30,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const addToCart = async (client: TestClient, variantId: string, quantity = 1) =>
    cartSchema.parse(
      (await client.post('/api/v1/cart/items').send({ variantId, quantity }).expect(200)).body,
    );

  it('places one order with a seller suborder each (laptop from A; mouse and keyboard from B)', async () => {
    const buyer = await shopper(app);
    await addToCart(buyer.client, laptop.variantId);
    await addToCart(buyer.client, mouse.variantId);
    const cart = await addToCart(buyer.client, keyboard.variantId);
    expect(cart.groups.map((g) => g.lines.length).sort()).toEqual([1, 2]);
    expect(cart).toMatchObject({ itemCount: 3, subtotal: '36097.00', ready: true });

    const q = await quote(buyer.client, { addressId: buyer.addressId });
    expect(q.problems).toEqual([]);
    expect(q.groups).toHaveLength(2);
    const a = q.groups.find((g) => g.sellerId === sellerA.sellerId)!;
    const b = q.groups.find((g) => g.sellerId === sellerB.sellerId)!;
    expect(a.itemsSubtotal).toBe('32999.00');
    expect(b.itemsSubtotal).toBe('3098.00');
    // Cebu → Quezon City and Davao → Quezon City cross island groups.
    expect(a.shipping.selected?.method).toBe('STANDARD');
    expect(D(a.shipping.fee).greaterThan(0)).toBe(true);
    expect(a.shipping.origin).toContain('City of Cebu');
    const expectedTotal = D(a.total).plus(b.total);
    expect(q.totals.grandTotal).toBe(expectedTotal.toFixed(2));
    expect(q.totals.grandTotal).toBe(
      D(q.totals.itemsSubtotal).plus(q.totals.shippingFee).toFixed(2),
    );
    // VAT is included (12%): total × 12 / 112 per seller order.
    expect(a.vatAmount).toBe(D(a.total).times(12).dividedBy(112).toDecimalPlaces(2).toFixed(2));

    const res = await placeOrder(buyer.client, { addressId: buyer.addressId });
    expect(res.status).toBe(201);
    const order = orderDetailSchema.parse(res.body);
    expect(order).toMatchObject({
      status: 'PLACED',
      paymentMethod: 'COD',
      paymentStatus: 'PAY_ON_DELIVERY',
      grandTotal: q.totals.grandTotal,
      sellerCount: 2,
      itemCount: 3,
      cancellable: true,
    });
    expect(order.sellerOrders.map((so) => so.number)).toEqual([
      `${order.orderNumber}-1`,
      `${order.orderNumber}-2`,
    ]);
    const subA = order.sellerOrders.find((so) => so.sellerId === sellerA.sellerId)!;
    const subB = order.sellerOrders.find((so) => so.sellerId === sellerB.sellerId)!;
    expect(subA.items.map((i) => i.productName)).toEqual(['Aero 14 Laptop']);
    expect(subB.items.map((i) => i.productName).sort()).toEqual([
      'Mechanical Keyboard',
      'Silent Mouse',
    ]);
    expect(subA.shipping).toMatchObject({ method: 'STANDARD', weightGrams: 1900 });
    expect(subB.shipping?.weightGrams).toBe(1020);

    // Stored snapshots: price rule, commission reference, shipping details, address copy.
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.pricingSnapshot).toMatchObject({ source: 'REGULAR', variantId: item.variantId });
      expect(item.commissionRuleId).not.toBeNull();
      expect(item.commissionAmount.toFixed(2)).toBe(
        item.commissionBase.times(item.commissionRate).dividedBy(100).toDecimalPlaces(2).toFixed(2),
      );
    }
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.shippingAddress).toMatchObject({
      city: 'Quezon City',
      barangay: 'Bagong Pag-asa',
    });
    const groups = await prisma.orderShippingGroup.findMany({
      where: { sellerOrder: { orderId: order.id } },
    });
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.warehouseId).sort()).toEqual(
      [sellerA.warehouseId, sellerB.warehouseId].sort(),
    );

    // Stock is held for the order until fulfilment (no expiry), and the cart is empty.
    const holds = await prisma.stockReservation.findMany({
      where: { orderItem: { orderId: order.id } },
    });
    expect(holds).toHaveLength(3);
    expect(holds.every((h) => h.status === 'ACTIVE' && h.expiresAt === null)).toBe(true);
    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { variantId: laptop.variantId },
    });
    expect(level.reservedQuantity).toBe(1);
    const after = cartSchema.parse((await buyer.client.get('/api/v1/cart').expect(200)).body);
    expect(after.itemCount).toBe(0);

    // Emails: the customer, and each seller for their own suborder.
    const customerMail = await findJob<{ orderNumber?: string }>(
      app,
      'email',
      (d, job) => job.name === EMAIL_JOBS.ORDER_PLACED && d.orderNumber === order.orderNumber,
    );
    expect(customerMail.data).toMatchObject({ status: 'PLACED', grandTotal: order.grandTotal });
    const sellerMail = await findJob<{ number?: string }>(
      app,
      'email',
      (d, job) => job.name === EMAIL_JOBS.SELLER_NEW_ORDER && d.number === subB.number,
    );
    expect(sellerMail.data).toMatchObject({
      lines: expect.arrayContaining([expect.objectContaining({ productName: 'Silent Mouse' })]),
    });

    // Each seller sees only their own suborder.
    const listB = sellerOrderListSchema.parse(
      (await sellerB.client.get('/api/v1/seller/orders').expect(200)).body,
    );
    expect(listB.items.map((i) => i.id)).toEqual([subB.id]);
    const detailB = sellerOrderDetailSchema.parse(
      (await sellerB.client.get(`/api/v1/seller/orders/${subB.id}`).expect(200)).body,
    );
    expect(detailB).toMatchObject({
      orderNumber: order.orderNumber,
      address: { city: 'Quezon City' },
    });
    expect(detailB.commission.items).toHaveLength(2);
    await sellerA.client.get(`/api/v1/seller/orders/${subB.id}`).expect(404);
  });

  it('returns the same order when a checkout is retried with the same key', async () => {
    const buyer = await shopper(app);
    const key = randomUUID();
    const body = {
      addressId: buyer.addressId,
      buyNow: { variantId: mouse.variantId, quantity: 1 },
    };
    const first = await placeOrder(buyer.client, body, key);
    expect(first.status).toBe(201);
    const again = await placeOrder(buyer.client, body, key);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.order.count({ where: { customerId: buyer.userId } })).toBe(1);
  });

  it('never accepts a client total: a different expected total is refused', async () => {
    const buyer = await shopper(app);
    const res = await buyer.client
      .post('/api/v1/checkout/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId: buyer.addressId,
        buyNow: { variantId: keyboard.variantId, quantity: 1 },
        paymentMethod: 'COD',
        expectedGrandTotal: '1.00',
      });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CHECKOUT_CHANGED');
    // Unknown fields (a price, a total) are rejected outright.
    const extra = await buyer.client
      .post('/api/v1/checkout/quote')
      .send({ addressId: buyer.addressId, grandTotal: '1.00' });
    expect(extra.status).toBe(400);
    expect(await prisma.order.count({ where: { customerId: buyer.userId } })).toBe(0);
  });
});
