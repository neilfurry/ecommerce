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

  it('creates one order when the same checkout is submitted twice at the same moment', async () => {
    const buyer = await shopper(app);
    const key = randomUUID();
    const body = {
      addressId: buyer.addressId,
      buyNow: { variantId: mouse.variantId, quantity: 1 },
    };
    const [a, b] = await Promise.all([
      placeOrder(buyer.client, body, key),
      placeOrder(buyer.client, body, key),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.order.count({ where: { customerId: buyer.userId } })).toBe(1);
    // Only one order's worth of stock is held.
    expect(
      await prisma.stockReservation.count({
        where: { orderItem: { order: { customerId: buyer.userId } } },
      }),
    ).toBe(1);
  });

  it('checks out the cart without the lines saved for later, and merges a browser cart', async () => {
    const buyer = await shopper(app);
    await addToCart(buyer.client, laptop.variantId);
    const withMouse = await addToCart(buyer.client, mouse.variantId);
    const mouseLine = withMouse.groups
      .flatMap((g) => g.lines)
      .find((l) => l.variantId === mouse.variantId)!;
    const saved = cartSchema.parse(
      (
        await buyer.client
          .patch(`/api/v1/cart/items/${mouseLine.id}`)
          .send({ savedForLater: true })
          .expect(200)
      ).body,
    );
    expect(saved.groups.flatMap((g) => g.lines.map((l) => l.variantId))).toEqual([
      laptop.variantId,
    ]);
    expect(saved.saved.map((l) => l.variantId)).toEqual([mouse.variantId]);

    // Signing in with a browser cart: new lines are added; for a variant already in the
    // cart the larger quantity is kept (so merging twice never doubles it).
    const browserCart = {
      items: [
        { variantId: keyboard.variantId, quantity: 2 },
        { variantId: laptop.variantId, quantity: 1 },
      ],
    };
    await buyer.client.post('/api/v1/cart/merge').send(browserCart).expect(200);
    const merged = cartSchema.parse(
      (await buyer.client.post('/api/v1/cart/merge').send(browserCart).expect(200)).body,
    );
    const quantities = Object.fromEntries(
      merged.groups.flatMap((g) => g.lines.map((l) => [l.variantId, l.quantity])),
    );
    expect(quantities).toEqual({ [laptop.variantId]: 1, [keyboard.variantId]: 2 });

    // The quote and the order cover the cart lines only; the saved mouse stays behind.
    const q = await quote(buyer.client, { addressId: buyer.addressId });
    expect(q.groups.flatMap((g) => g.lines.map((l) => l.variantId)).sort()).toEqual(
      [laptop.variantId, keyboard.variantId].sort(),
    );
    const placed = await placeOrder(buyer.client, { addressId: buyer.addressId });
    expect(placed.status).toBe(201);
    const after = cartSchema.parse((await buyer.client.get('/api/v1/cart').expect(200)).body);
    expect(after.groups).toEqual([]);
    expect(after.saved.map((l) => l.variantId)).toEqual([mouse.variantId]);
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

  describe('pricing', () => {
    it('gives approved wholesale customers tier prices, and retail customers retail', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const rice = await listed(seller, admin, categoryId, {
        price: '500.00',
        weightGrams: 25000,
        stock: 500,
      });
      await seller.client
        .put(`/api/v1/products/${rice.productId}/pricing`)
        .send({
          currency: 'PHP',
          minOrderQuantity: 1,
          wholesaleEnabled: true,
          wholesaleMinOrderQuantity: 10,
        })
        .expect(200);
      await seller.client
        .put(`/api/v1/products/${rice.productId}/price-tiers`)
        .send({
          tiers: [
            { minQuantity: 10, unitPrice: '450.00' },
            { minQuantity: 50, unitPrice: '420.00' },
          ],
        })
        .expect(200);
      const retail = await shopper(app);
      const wholesale = await shopper(app, ['CUSTOMER', 'WHOLESALE_CUSTOMER']);
      const buy = (quantity: number) => ({ buyNow: { variantId: rice.variantId, quantity } });

      const r = await quote(retail.client, buy(50));
      expect(r.buyerType).toBe('RETAIL');
      expect(r.groups[0]!.lines[0]!.price).toMatchObject({
        unitPrice: '500.00',
        source: 'REGULAR',
      });
      expect(r.totals.wholesaleSavings).toBe('0.00');

      const w9 = await quote(wholesale.client, buy(9));
      expect(w9.groups[0]!.lines[0]!.price.source).toBe('REGULAR'); // below the wholesale minimum
      const w = await quote(wholesale.client, buy(50));
      expect(w.buyerType).toBe('WHOLESALE');
      expect(w.groups[0]!.lines[0]!.price).toMatchObject({
        unitPrice: '420.00',
        source: 'WHOLESALE_TIER',
      });
      expect(w.totals).toMatchObject({ itemsSubtotal: '21000.00', wholesaleSavings: '4000.00' });
      // Above the cash-on-delivery limit (₱50,000 by default, with heavy-parcel shipping).
      expect(w.paymentMethods.find((p) => p.method === 'COD')!.unavailableReason).toMatch(
        /up to ₱50000\.00/,
      );

      const res = await placeOrder(wholesale.client, {
        addressId: wholesale.addressId,
        ...buy(50),
        paymentMethod: 'GCASH',
      });
      expect(res.status).toBe(201);
      const order = orderDetailSchema.parse(res.body);
      expect(order.buyerType).toBe('WHOLESALE');
      expect(order.sellerOrders[0]!.items[0]).toMatchObject({
        unitPrice: '420.00',
        regularUnitPrice: '500.00',
        priceSource: 'WHOLESALE_TIER',
      });
    });

    it('re-prices the cart and refuses an order at a price that changed', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { price: '1000.00', stock: 20 });
      const buyer = await shopper(app);
      await addToCart(buyer.client, item.variantId, 2);
      const before = await quote(buyer.client, { addressId: buyer.addressId });

      await seller.client
        .patch(`/api/v1/products/${item.productId}/variants/${item.variantId}`)
        .send({ regularPrice: '1200.00' })
        .expect(200);
      const cart = cartSchema.parse((await buyer.client.get('/api/v1/cart').expect(200)).body);
      expect(cart.groups[0]!.lines[0]).toMatchObject({
        previousUnitPrice: '1000.00',
        price: expect.objectContaining({ unitPrice: '1200.00' }),
      });
      const stale = await buyer.client
        .post('/api/v1/checkout/orders')
        .set('Idempotency-Key', randomUUID())
        .send({
          addressId: buyer.addressId,
          paymentMethod: 'COD',
          expectedGrandTotal: before.totals.grandTotal,
        });
      expect(stale.status).toBe(409);
      expect(errorCode(stale)).toBe('CHECKOUT_CHANGED');
      const ok = await placeOrder(buyer.client, { addressId: buyer.addressId });
      expect(ok.status).toBe(201);
      expect(ok.body.totals.itemsSubtotal).toBe('2400.00');
    });

    it('adds configured charges and works out VAT from the settings', async () => {
      const { client: settings } = await signedInClient(app, 'admin', ['ADMIN'], 'settings');
      const current = (await settings.get('/api/v1/settings').expect(200)).body as {
        checkout: Record<string, unknown>;
      };
      await settings
        .put('/api/v1/settings/checkout')
        .send({
          ...current.checkout,
          charges: [
            {
              code: 'COD_FEE',
              label: 'Cash on delivery fee',
              type: 'FIXED',
              amount: '20.00',
              paymentMethods: ['COD'],
            },
          ],
        })
        .expect(200);
      try {
        const buyer = await shopper(app);
        const body = {
          addressId: buyer.addressId,
          buyNow: { variantId: keyboard.variantId, quantity: 1 },
        };
        const cod = await quote(buyer.client, { ...body, paymentMethod: 'COD' });
        expect(cod.groups[0]!.charges).toEqual([
          { code: 'COD_FEE', label: 'Cash on delivery fee', amount: '20.00' },
        ]);
        expect(cod.totals.chargesTotal).toBe('20.00');
        const gcash = await quote(buyer.client, { ...body, paymentMethod: 'GCASH' });
        expect(gcash.totals.chargesTotal).toBe('0.00');
        expect(D(cod.totals.grandTotal).minus(gcash.totals.grandTotal).toFixed(2)).toBe('20.00');
        expect(cod.vat).toEqual({ rate: '0.12', included: true });
      } finally {
        await settings
          .put('/api/v1/settings/checkout')
          .send({ ...current.checkout, charges: [] })
          .expect(200);
      }
    });

    it('applies a running flash sale price and never sells more than its cap', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { price: '800.00', stock: 100 });
      const { client: marketing } = await signedInClient(app, 'admin', ['ADMIN'], 'flash');
      const sale = await marketing
        .post('/api/v1/flash-sales')
        .send({
          title: 'Test flash sale',
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .expect(201);
      await seller.client
        .post(`/api/v1/seller/flash-sales/${sale.body.id}/items`)
        .send({
          variantId: item.variantId,
          flashPrice: '500.00',
          quantityLimit: 3,
          perOrderLimit: 1,
        })
        .expect(201);
      // The flash price must be below the regular price.
      await sellerA.client
        .post(`/api/v1/seller/flash-sales/${sale.body.id}/items`)
        .send({ variantId: laptop.variantId, flashPrice: '40000.00', quantityLimit: 3 })
        .expect(422);

      const buyers = await Promise.all(Array.from({ length: 6 }, () => shopper(app)));
      const results = await Promise.all(
        buyers.map(async (b) => {
          const q = await quote(b.client, { buyNow: { variantId: item.variantId, quantity: 1 } });
          return b.client
            .post('/api/v1/checkout/orders')
            .set('Idempotency-Key', randomUUID())
            .send({
              addressId: b.addressId,
              buyNow: { variantId: item.variantId, quantity: 1 },
              paymentMethod: 'COD',
              expectedGrandTotal: q.totals.grandTotal,
            });
        }),
      );
      const placed = results.filter((r) => r.status === 201);
      // Every order at the flash price fits in the cap of 3; the rest were told the price changed.
      const atFlash = placed.filter(
        (r) => r.body.sellerOrders[0].items[0].priceSource === 'FLASH_SALE',
      );
      expect(atFlash.length).toBeLessThanOrEqual(3);
      expect(
        results.filter((r) => r.status !== 201).every((r) => errorCode(r) === 'CHECKOUT_CHANGED'),
      ).toBe(true);
      const flashItem = await prisma.flashSaleItem.findFirstOrThrow({
        where: { variantId: item.variantId },
      });
      expect(flashItem.soldQuantity).toBe(atFlash.length);
      expect(flashItem.soldQuantity).toBeLessThanOrEqual(flashItem.quantityLimit);
      // Above the per-order limit the line is priced at retail.
      const two = await quote(buyers[0]!.client, {
        buyNow: { variantId: item.variantId, quantity: 2 },
      });
      expect(two.groups[0]!.lines[0]!.price.source).toBe('REGULAR');
    });
  });

  describe('coupons', () => {
    const coupon = async (client: TestClient, path: string, body: Record<string, unknown>) =>
      (
        await client
          .post(path)
          .send({
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 86_400_000).toISOString(),
            ...body,
          })
          .expect(201)
      ).body as { id: string; code: string };
    const code = (prefix: string) =>
      `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

    it('applies one marketplace coupon and one per seller, shared across seller orders', async () => {
      const platform = await coupon(admin, '/api/v1/coupons', {
        code: code('ALL'),
        name: 'Marketplace ₱300 off',
        type: 'FIXED_AMOUNT',
        value: '300',
        minSpend: '1000',
      });
      const second = await coupon(admin, '/api/v1/coupons', {
        code: code('TWO'),
        name: 'Another',
        type: 'FIXED_AMOUNT',
        value: '50',
      });
      const ofB = await coupon(sellerB.client, '/api/v1/seller/coupons', {
        code: code('BEE'),
        name: 'B 10% off',
        type: 'PERCENTAGE',
        value: '10',
        maxDiscount: '200',
      });
      const ofA = await coupon(sellerA.client, '/api/v1/seller/coupons', {
        code: code('AYE'),
        name: 'A free shipping',
        type: 'FREE_SHIPPING',
        value: '0',
      });
      const buyer = await shopper(app);
      await addToCart(buyer.client, laptop.variantId);
      await addToCart(buyer.client, mouse.variantId);
      await addToCart(buyer.client, keyboard.variantId);
      const q = await quote(buyer.client, {
        addressId: buyer.addressId,
        couponCodes: [platform.code, second.code, ofB.code, ofA.code],
      });
      const byCode = Object.fromEntries(q.coupons.map((c) => [c.code, c]));
      expect(byCode[second.code]).toMatchObject({
        status: 'NOT_APPLIED',
        message: expect.stringMatching(/one marketplace coupon/),
      });
      // Seller B: 10% of ₱3,098 = ₱309.80, capped at ₱200.
      expect(byCode[ofB.code]).toMatchObject({ status: 'APPLIED', amount: '200.00' });
      const a = q.groups.find((g) => g.sellerId === sellerA.sellerId)!;
      const b = q.groups.find((g) => g.sellerId === sellerB.sellerId)!;
      expect(b.sellerDiscount).toBe('200.00');
      // Seller A's free shipping takes off A's whole shipping fee.
      expect(a.shipping.sellerDiscount).toBe(a.shipping.fee);
      expect(byCode[ofA.code]!.amount).toBe(a.shipping.fee);
      // The marketplace ₱300 is shared by what each seller sells (after seller discounts).
      expect(byCode[platform.code]!.amount).toBe('300.00');
      expect(D(a.platformDiscount).plus(b.platformDiscount).toFixed(2)).toBe('300.00');
      expect(D(a.platformDiscount).greaterThan(b.platformDiscount)).toBe(true);
      for (const group of q.groups) {
        const lineDiscounts = group.lines.reduce(
          (sum, l) => sum.plus(l.sellerDiscount).plus(l.platformDiscount),
          D('0'),
        );
        expect(lineDiscounts.toFixed(2)).toBe(
          D(group.sellerDiscount).plus(group.platformDiscount).toFixed(2),
        );
      }
      expect(q.totals.couponDiscount).toBe(D('500.00').toFixed(2));

      // Placing needs every coupon to apply: drop the rejected one.
      const res = await placeOrder(buyer.client, {
        addressId: buyer.addressId,
        couponCodes: [platform.code, ofB.code, ofA.code],
      });
      expect(res.status).toBe(201);
      const order = orderDetailSchema.parse(res.body);
      expect(order.coupons.map((c) => c.code).sort()).toEqual(
        [platform.code, ofA.code, ofB.code].sort(),
      );
      const subB = await prisma.sellerOrder.findFirstOrThrow({
        where: { orderId: order.id, sellerId: sellerB.sellerId },
      });
      expect(subB.sellerDiscount.toFixed(2)).toBe('200.00');
      // Commission is on what B sold after B's own discount (the marketplace's share is not deducted).
      const itemsB = await prisma.orderItem.findMany({ where: { sellerOrderId: subB.id } });
      for (const i of itemsB)
        expect(i.commissionBase.toFixed(2)).toBe(i.lineSubtotal.minus(i.sellerDiscount).toFixed(2));
      expect(
        (await prisma.coupon.findUniqueOrThrow({ where: { id: platform.id } })).usedCount,
      ).toBe(1);

      // One use per customer (the default), and the used count is given back on cancellation.
      const again = await quote(buyer.client, {
        buyNow: { variantId: keyboard.variantId, quantity: 1 },
        couponCodes: [platform.code],
      });
      expect(again.coupons[0]).toMatchObject({
        status: 'NOT_APPLIED',
        message: 'You have already used this coupon.',
      });
      await buyer.client
        .post(`/api/v1/account/orders/${order.id}/cancel`)
        .send({ reason: 'Changed my mind' })
        .expect(200);
      expect(
        (await prisma.coupon.findUniqueOrThrow({ where: { id: platform.id } })).usedCount,
      ).toBe(0);
    });

    it('checks minimum spend, dates, store and usage limits', async () => {
      const buyer = await shopper(app);
      const minSpend = await coupon(admin, '/api/v1/coupons', {
        code: code('MIN'),
        name: 'Big spend',
        type: 'FIXED_AMOUNT',
        value: '100',
        minSpend: '5000',
      });
      const ofA = await coupon(sellerA.client, '/api/v1/seller/coupons', {
        code: code('ONLYA'),
        name: 'A only',
        type: 'FIXED_AMOUNT',
        value: '100',
      });
      const later = await coupon(admin, '/api/v1/coupons', {
        code: code('LATER'),
        name: 'Not yet',
        type: 'FIXED_AMOUNT',
        value: '100',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      });
      const q = await quote(buyer.client, {
        buyNow: { variantId: mouse.variantId, quantity: 1 },
        couponCodes: [minSpend.code, ofA.code, later.code, 'NOSUCHCODE'],
      });
      expect(q.coupons.map((c) => [c.code, c.status, c.message])).toEqual([
        [minSpend.code, 'NOT_APPLIED', 'Spend at least ₱5000.00 to use this coupon.'],
        [ofA.code, 'NOT_APPLIED', 'This coupon is for a store that is not in your order.'],
        [later.code, 'NOT_APPLIED', 'This coupon is not active.'],
        ['NOSUCHCODE', 'NOT_APPLIED', 'This code is not valid.'],
      ]);
      expect(q.totals.couponDiscount).toBe('0.00');
      // Sellers cannot create marketplace coupons; customers cannot create any.
      await sellerA.client.post('/api/v1/coupons').send({}).expect(403);
      await buyer.client.post('/api/v1/seller/coupons').send({}).expect(403);

      // Once per customer: the second order cannot use it again.
      const once = await coupon(admin, '/api/v1/coupons', {
        code: code('ONCE'),
        name: 'Once each',
        type: 'FIXED_AMOUNT',
        value: '50',
        perCustomerLimit: 1,
      });
      const body = {
        addressId: buyer.addressId,
        buyNow: { variantId: mouse.variantId, quantity: 1 },
        couponCodes: [once.code],
      };
      expect((await placeOrder(buyer.client, body)).status).toBe(201);
      const again = await quote(buyer.client, body);
      expect(again.coupons).toEqual([
        expect.objectContaining({
          code: once.code,
          status: 'NOT_APPLIED',
          message: 'You have already used this coupon.',
        }),
      ]);
    });

    it('never lets a limited coupon be used more often than its limit, even at once', async () => {
      const limited = await coupon(admin, '/api/v1/coupons', {
        code: code('LIMIT'),
        name: 'First three',
        type: 'FIXED_AMOUNT',
        value: '50',
        usageLimit: 3,
      });
      const buyers = await Promise.all(Array.from({ length: 8 }, () => shopper(app)));
      const results = await Promise.all(
        buyers.map((b) =>
          placeOrder(b.client, {
            addressId: b.addressId,
            buyNow: { variantId: mouse.variantId, quantity: 1 },
            couponCodes: [limited.code],
          }),
        ),
      );
      const ok = results.filter((r) => r.status === 201);
      expect(ok).toHaveLength(3);
      expect(
        results.filter((r) => r.status === 409).every((r) => errorCode(r) === 'CHECKOUT_CHANGED'),
      ).toBe(true);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { id: limited.id } })).usedCount).toBe(
        3,
      );
    });
  });

  describe('validation', () => {
    it('lists what blocks the order: empty cart, missing address, stock', async () => {
      const buyer = await shopper(app);
      const empty = await quote(buyer.client, {});
      expect(empty.problems.map((p) => p.message)).toContain('Your cart is empty.');
      const placeEmpty = await placeOrder(buyer.client, { addressId: buyer.addressId });
      expect(placeEmpty.status).toBe(422);

      const { client: noAddress } = await signedInClient(
        app,
        'storefront',
        ['CUSTOMER'],
        'no-address',
      );
      const q = await quote(noAddress, { buyNow: { variantId: mouse.variantId, quantity: 1 } });
      expect(q.problems.map((p) => p.message)).toContain('Add a delivery address.');

      const tooMany = await quote(buyer.client, {
        buyNow: { variantId: laptop.variantId, quantity: 999 },
      });
      expect(tooMany.problems[0]!.message).toMatch(/^Only \d+ of Aero 14 Laptop/);
      const add = await buyer.client
        .post('/api/v1/cart/items')
        .send({ variantId: laptop.variantId, quantity: 999 });
      expect(add.status).toBe(409);
      expect(errorCode(add)).toBe('INSUFFICIENT_STOCK');

      // An order cannot be placed without an idempotency key.
      const noKey = await buyer.client.post('/api/v1/checkout/orders').send({
        addressId: buyer.addressId,
        buyNow: { variantId: mouse.variantId, quantity: 1 },
        paymentMethod: 'COD',
        expectedGrandTotal: '1.00',
      });
      expect(noKey.status).toBe(400);
      expect(await prisma.order.count({ where: { customerId: buyer.userId } })).toBe(0);
    });

    it('reports sellers that cannot ship yet and products that stopped selling', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 5 });
      await prisma.warehouse.updateMany({
        where: { sellerId: seller.sellerId },
        data: { regionCode: null, provinceCode: null, cityCode: null, barangayCode: null },
      });
      const buyer = await shopper(app);
      const q = await quote(buyer.client, { buyNow: { variantId: item.variantId, quantity: 1 } });
      expect(q.problems.map((p) => p.message)).toContain('Test Store cannot ship orders yet.');

      await seller.client.post(`/api/v1/products/${item.productId}/deactivate`).expect(201);
      const gone = await quote(buyer.client, {
        buyNow: { variantId: item.variantId, quantity: 1 },
      });
      expect(gone.problems[0]!.message).toMatch(/no longer available/);
    });
  });

  describe('payment and reservations', () => {
    it('holds stock for unpaid online orders and cancels them after the deadline', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 4 });
      const buyer = await shopper(app);
      const res = await placeOrder(buyer.client, {
        addressId: buyer.addressId,
        buyNow: { variantId: item.variantId, quantity: 3 },
        paymentMethod: 'GCASH',
      });
      expect(res.status).toBe(201);
      const order = orderDetailSchema.parse(res.body);
      expect(order).toMatchObject({
        status: 'AWAITING_PAYMENT',
        paymentStatus: 'PENDING',
        cancellable: true,
      });
      expect(order.sellerOrders[0]!.status).toBe('AWAITING_PAYMENT');
      const due = new Date(order.paymentDueAt!);
      const hold = await prisma.stockReservation.findFirstOrThrow({
        where: { orderItem: { orderId: order.id } },
      });
      expect(hold.expiresAt!.getTime()).toBe(due.getTime() + 5 * 60_000);

      // Only one unit left for anyone else.
      const other = await shopper(app);
      const blocked = await quote(other.client, {
        buyNow: { variantId: item.variantId, quantity: 2 },
      });
      expect(blocked.problems[0]!.message).toMatch(/^Only 1 of/);

      const { expireUnpaidOrders } = await import('@marketplace/database');
      const expired = await expireUnpaidOrders(prisma, { now: new Date(due.getTime() + 1000) });
      expect(expired.map((e) => e.id)).toContain(order.id);
      const after = orderDetailSchema.parse(
        (await buyer.client.get(`/api/v1/account/orders/${order.id}`).expect(200)).body,
      );
      expect(after).toMatchObject({
        status: 'CANCELLED',
        paymentStatus: 'VOIDED',
        cancellable: false,
      });
      // The order's history and the seller order's own status change (state machine).
      expect(after.events.map((e) => [e.type, e.sellerOrderId ? 'seller order' : 'order'])).toEqual(
        [
          ['AWAITING_PAYMENT', 'order'],
          ['PAYMENT_EXPIRED', 'seller order'],
          ['PAYMENT_EXPIRED', 'order'],
        ],
      );
      expect(after.payment.attempts[0]).toMatchObject({
        provider: 'MOCK',
        status: 'EXPIRED',
        test: true,
      });
      const level = await prisma.stockLevel.findFirstOrThrow({
        where: { variantId: item.variantId },
      });
      expect(level.reservedQuantity).toBe(0);
      expect(
        (await prisma.stockReservation.findUniqueOrThrow({ where: { id: hold.id } })).status,
      ).toBe('RELEASED');
    });

    it('gives the stock back when a customer cancels a cash-on-delivery order', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 5 });
      const buyer = await shopper(app);
      const order = orderDetailSchema.parse(
        (
          await placeOrder(buyer.client, {
            addressId: buyer.addressId,
            buyNow: { variantId: item.variantId, quantity: 2 },
          })
        ).body,
      );
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: item.productId } })).soldCount,
      ).toBe(2);
      const cancelled = await buyer.client
        .post(`/api/v1/account/orders/${order.id}/cancel`)
        .send({ reason: 'Ordered by mistake' })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Ordered by mistake',
      });
      await buyer.client
        .post(`/api/v1/account/orders/${order.id}/cancel`)
        .send({ reason: 'Again' })
        .expect(409);
      const level = await prisma.stockLevel.findFirstOrThrow({
        where: { variantId: item.variantId },
      });
      expect(level).toMatchObject({ quantityOnHand: 5, reservedQuantity: 0 });
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: item.productId } })).soldCount,
      ).toBe(0);
      expect(
        await findJob<{ orderNumber?: string }>(
          app,
          'email',
          (d, job) =>
            job.name === EMAIL_JOBS.ORDER_CANCELLED && d.orderNumber === order.orderNumber,
        ),
      ).toBeTruthy();
    });

    it('never oversells when many customers check out the last units at once', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 5 });
      const buyers = await Promise.all(Array.from({ length: 12 }, () => shopper(app)));
      const quotes = await Promise.all(
        buyers.map((b) => quote(b.client, { buyNow: { variantId: item.variantId, quantity: 1 } })),
      );
      const results = await Promise.all(
        buyers.map((b, i) =>
          b.client
            .post('/api/v1/checkout/orders')
            .set('Idempotency-Key', randomUUID())
            .send({
              addressId: b.addressId,
              buyNow: { variantId: item.variantId, quantity: 1 },
              paymentMethod: 'COD',
              expectedGrandTotal: quotes[i]!.totals.grandTotal,
            }),
        ),
      );
      const failures = results
        .filter((r) => r.status !== 201)
        .map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      expect({ placed: results.filter((r) => r.status === 201).length, failures }).toMatchObject({
        placed: 5,
      });
      for (const r of results.filter((x) => x.status !== 201)) {
        expect([409, 422]).toContain(r.status);
      }
      const level = await prisma.stockLevel.findFirstOrThrow({
        where: { variantId: item.variantId },
      });
      expect(level).toMatchObject({ quantityOnHand: 5, reservedQuantity: 5 });
      expect(await prisma.orderItem.count({ where: { variantId: item.variantId } })).toBe(5);
    }, 90_000);
  });

  describe('customer data isolation', () => {
    it('keeps orders, addresses and carts private to their customer', async () => {
      const owner = await shopper(app);
      const other = await shopper(app);
      const order = orderDetailSchema.parse(
        (
          await placeOrder(owner.client, {
            addressId: owner.addressId,
            buyNow: { variantId: mouse.variantId, quantity: 1 },
          })
        ).body,
      );
      await other.client.get(`/api/v1/account/orders/${order.id}`).expect(404);
      await other.client
        .post(`/api/v1/account/orders/${order.id}/cancel`)
        .send({ reason: 'Not mine' })
        .expect(404);
      const list = await other.client.get('/api/v1/account/orders').expect(200);
      expect(list.body.items).toEqual([]);
      // Another customer's address cannot be used, edited or deleted.
      const q = await quote(other.client, {
        addressId: owner.addressId,
        buyNow: { variantId: mouse.variantId, quantity: 1 },
      });
      expect(q.problems.map((p) => p.path)).toContain('addressId');
      await other.client.delete(`/api/v1/account/addresses/${owner.addressId}`).expect(404);
      const cart = cartSchema.parse(
        (
          await owner.client
            .post('/api/v1/cart/items')
            .send({ variantId: mouse.variantId, quantity: 1 })
            .expect(200)
        ).body,
      );
      const lineId = cart.groups[0]!.lines[0]!.id;
      await other.client.patch(`/api/v1/cart/items/${lineId}`).send({ quantity: 5 }).expect(404);
      await other.client.delete(`/api/v1/cart/items/${lineId}`).expect(404);
      // Staff see every order; sellers and customers cannot use the staff list.
      await admin.get(`/api/v1/orders/${order.id}`).expect(200);
      await owner.client.get('/api/v1/orders').expect(403);
      await sellerA.client.get('/api/v1/orders').expect(403);
    });
  });
});
