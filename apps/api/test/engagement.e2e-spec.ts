import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expireLoyaltyPoints, Prisma } from '@marketplace/database';
import {
  affiliateAccountSchema,
  apiErrorBodySchema,
  campaignSchema,
  couponSchema,
  loyaltySummarySchema,
  myReferralsSchema,
  notificationListSchema,
  orderDetailSchema,
  otpChallengeResponseSchema,
  reportSchema,
  reviewListSchema,
  sellerRatingSummarySchema,
  ticketDetailSchema,
  ticketListSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  latestOtp,
  randomMobile,
  signedInClient,
  TEST_PASSWORD,
  TestClient,
  uniqueEmail,
} from './auth-helpers';
import { image, testCategory } from './catalog-helpers';
import { acceptAndShip, courier, order, payMock } from './order-helpers';
import {
  type Listed,
  listed,
  place,
  PLACES,
  placeOrder,
  quote,
  type Shopper,
  shopper,
  shopSeller,
  type ShopSeller,
} from './shop-helpers';
import { createTestApp } from './test-app';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const inADay = () => new Date(Date.now() + 86_400_000).toISOString();
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

/**
 * Phase 7: coupon restrictions, the promotion engine and its stacking rules, loyalty points,
 * referrals, affiliates, review images / replies / reports, seller ratings, support tickets,
 * the notification outbox and inbox, and analytics with exports.
 *
 * Every campaign here is restricted to this suite's own products, so suites running at the
 * same time on the shared database are not affected.
 */
describe('Engagement (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let support: TestClient;
  let categoryId: string;
  let otherCategoryId: string;
  let sellerA: ShopSeller;
  let sellerB: ShopSeller;
  let lamp: Listed; // sellerA, 1000
  let tee: Listed; // sellerA, 200, other category
  let mug: Listed; // sellerB, 500

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'engage-admin')).client;
    support = (await signedInClient(app, 'admin', ['CUSTOMER_SUPPORT'], 'engage-support')).client;
    categoryId = (await testCategory(app)).id;
    otherCategoryId = (await testCategory(app)).id;
    sellerA = await shopSeller(app, PLACES.quezonCity);
    sellerB = await shopSeller(app, PLACES.cebuCity);
    lamp = await listed(sellerA, admin, categoryId, {
      name: 'Engage Lamp',
      price: '1000.00',
      stock: 200,
    });
    tee = await listed(sellerA, admin, otherCategoryId, {
      name: 'Engage Tee',
      price: '200.00',
      stock: 200,
    });
    mug = await listed(sellerB, admin, categoryId, {
      name: 'Engage Mug',
      price: '500.00',
      stock: 200,
    });
  });

  afterAll(async () => {
    await prisma.campaign.updateMany({
      where: {
        products: { some: { productId: { in: [lamp.productId, tee.productId, mug.productId] } } },
      },
      data: { status: 'INACTIVE' },
    });
    await app.close();
  });

  const cart = async (buyer: Shopper, items: { variantId: string; quantity: number }[]) => {
    for (const item of items) await buyer.client.post('/api/v1/cart/items').send(item).expect(200);
  };

  const campaign = async (
    client: TestClient,
    path: '/api/v1/campaigns' | '/api/v1/seller/campaigns',
    body: Record<string, unknown>,
  ) =>
    campaignSchema.parse(
      (
        await client
          .post(path)
          .send({ startsAt: hourAgo(), endsAt: inADay(), appliesTo: 'PRODUCTS', ...body })
          .expect(201)
      ).body,
    );

  const coupon = async (
    client: TestClient,
    path: '/api/v1/coupons' | '/api/v1/seller/coupons',
    body: Record<string, unknown>,
  ) =>
    couponSchema.parse(
      (
        await client
          .post(path)
          .send({
            code: `E${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
            name: 'Engage coupon',
            startsAt: hourAgo(),
            endsAt: inADay(),
            ...body,
          })
          .expect(201)
      ).body,
    );

  /** Paid online, shipped and delivered by the mock courier. */
  async function delivered(
    buyer: Shopper,
    seller: ShopSeller,
    item: Listed,
    extra: Record<string, unknown> = {},
  ) {
    const res = await placeOrder(buyer.client, {
      addressId: buyer.addressId,
      buyNow: { variantId: item.variantId, quantity: 1 },
      paymentMethod: 'GCASH',
      ...extra,
    });
    expect(res.status).toBe(201);
    const placed = orderDetailSchema.parse(res.body);
    await payMock(buyer.client, placed);
    const so = placed.sellerOrders[0]!;
    const shipment = await acceptAndShip(seller.client, so.id);
    await courier(admin, shipment.id, 'PICKED_UP');
    await courier(admin, shipment.id, 'DELIVERED');
    return { placed, so };
  }

  const complete = (sellerOrderId: string) =>
    admin
      .post(`/api/v1/seller-orders/${sellerOrderId}/transition`)
      .send({ to: 'COMPLETED', note: 'Return window waived for the test' })
      .expect(200);

  const journal = (key: string) =>
    prisma.journalTransaction.findUnique({
      where: { idempotencyKey: key },
      include: { entries: { include: { account: { select: { code: true } } } } },
    });

  // ---- Coupons ------------------------------------------------------------------------------

  describe('coupon eligibility', () => {
    it('discounts only the products a restricted coupon covers, and counts only them for the minimum', async () => {
      const c = await coupon(sellerA.client, '/api/v1/seller/coupons', {
        type: 'PERCENTAGE',
        value: '10',
        appliesTo: 'PRODUCTS',
        productIds: [lamp.productId],
      });
      expect(c.products).toEqual([{ id: lamp.productId, name: 'Engage Lamp' }]);
      const buyer = await shopper(app);
      await cart(buyer, [
        { variantId: lamp.variantId, quantity: 1 },
        { variantId: tee.variantId, quantity: 1 },
      ]);
      const q = await quote(buyer.client, { couponCodes: [c.code] });
      expect(q.coupons[0]).toMatchObject({ status: 'APPLIED', amount: '100.00' });
      const lines = q.groups[0]!.lines;
      expect(lines.find((l) => l.variantId === lamp.variantId)!.sellerDiscount).toBe('100.00');
      expect(lines.find((l) => l.variantId === tee.variantId)!.sellerDiscount).toBe('0.00');

      // ₱1,200 in the cart, but only the ₱1,000 lamp counts towards a ₱1,100 minimum.
      const high = await coupon(sellerA.client, '/api/v1/seller/coupons', {
        type: 'FIXED_AMOUNT',
        value: '50',
        minSpend: '1100',
        appliesTo: 'PRODUCTS',
        productIds: [lamp.productId],
      });
      const q2 = await quote(buyer.client, { couponCodes: [high.code] });
      expect(q2.coupons[0]).toMatchObject({ status: 'NOT_APPLIED' });
      expect(q2.coupons[0]!.message).toContain('1100.00');
    });

    it('applies category coupons to products in the category (and its subcategories)', async () => {
      const c = await coupon(admin, '/api/v1/coupons', {
        type: 'FIXED_AMOUNT',
        value: '30',
        appliesTo: 'CATEGORIES',
        categoryIds: [otherCategoryId],
      });
      const buyer = await shopper(app);
      const onLamp = await quote(buyer.client, {
        buyNow: { variantId: lamp.variantId, quantity: 1 },
        couponCodes: [c.code],
      });
      expect(onLamp.coupons[0]!.status).toBe('NOT_APPLIED');
      const onTee = await quote(buyer.client, {
        buyNow: { variantId: tee.variantId, quantity: 1 },
        couponCodes: [c.code],
      });
      expect(onTee.coupons[0]).toMatchObject({ status: 'APPLIED', amount: '30.00' });
    });

    it('accepts first-order coupons only before the customer’s first order', async () => {
      const c = await coupon(admin, '/api/v1/coupons', {
        type: 'FIXED_AMOUNT',
        value: '25',
        firstOrderOnly: true,
        perCustomerLimit: 5,
      });
      expect(c.firstOrderOnly).toBe(true);
      const buyer = await shopper(app);
      const body = { buyNow: { variantId: tee.variantId, quantity: 1 }, couponCodes: [c.code] };
      expect((await quote(buyer.client, body)).coupons[0]!.status).toBe('APPLIED');
      const res = await placeOrder(buyer.client, { addressId: buyer.addressId, ...body });
      expect(res.status).toBe(201);
      const again = await quote(buyer.client, body);
      expect(again.coupons[0]).toMatchObject({
        status: 'NOT_APPLIED',
        message: 'This coupon is for your first order only.',
      });
    });
  });

  // ---- Promotion engine ---------------------------------------------------------------------

  describe('promotion engine and stacking', () => {
    it('gives buy 1, take 1 on pairs only', async () => {
      const promo = await campaign(sellerA.client, '/api/v1/seller/campaigns', {
        name: 'Tee B1T1',
        type: 'BUY_X_GET_Y',
        value: '100',
        buyQuantity: 1,
        getQuantity: 1,
        productIds: [tee.productId],
      });
      const buyer = await shopper(app);
      const two = await quote(buyer.client, { buyNow: { variantId: tee.variantId, quantity: 2 } });
      expect(two.groups[0]!.lines[0]!).toMatchObject({
        promotionDiscount: '200.00',
        sellerDiscount: '200.00',
        promotion: { campaignId: promo.id, type: 'BUY_X_GET_Y' },
      });
      expect(two.totals.promotionDiscount).toBe('200.00');
      expect(two.totals.couponDiscount).toBe('0.00');
      const three = await quote(buyer.client, {
        buyNow: { variantId: tee.variantId, quantity: 3 },
      });
      expect(three.groups[0]!.lines[0]!.promotionDiscount).toBe('200.00');
      await sellerA.client
        .patch(`/api/v1/seller/campaigns/${promo.id}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
    });

    it('needs the bundle minimum within the store’s part of the order', async () => {
      const bundle = await campaign(admin, '/api/v1/campaigns', {
        name: 'Mug bundle',
        type: 'BUNDLE',
        value: '10',
        minQuantity: 2,
        productIds: [mug.productId],
      });
      const buyer = await shopper(app);
      const one = await quote(buyer.client, { buyNow: { variantId: mug.variantId, quantity: 1 } });
      expect(one.groups[0]!.lines[0]!.promotion).toBeNull();
      const two = await quote(buyer.client, { buyNow: { variantId: mug.variantId, quantity: 2 } });
      expect(two.groups[0]!.lines[0]!).toMatchObject({
        promotionDiscount: '100.00',
        // A marketplace campaign is paid by the marketplace.
        platformDiscount: '100.00',
        sellerDiscount: '0.00',
      });
      await admin.patch(`/api/v1/campaigns/${bundle.id}`).send({ status: 'INACTIVE' }).expect(200);
    });

    it('gives each item the better of its flash sale or a campaign, never both', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { price: '1000.00', stock: 50 });
      const sale = await admin
        .post('/api/v1/flash-sales')
        .send({ title: 'Engagement flash sale', startsAt: hourAgo(), endsAt: inADay() })
        .expect(201);
      await seller.client
        .post(`/api/v1/seller/flash-sales/${sale.body.id}/items`)
        .send({ variantId: item.variantId, flashPrice: '900.00', quantityLimit: 10 })
        .expect(201);
      const promo = await campaign(seller.client, '/api/v1/seller/campaigns', {
        name: 'Small discount',
        type: 'PERCENTAGE_OFF',
        value: '5',
        productIds: [item.productId],
      });
      const buyer = await shopper(app);
      const body = { buyNow: { variantId: item.variantId, quantity: 1 } };
      // 5% (₱50) saves less than the flash price (₱100): the flash sale stays.
      let q = await quote(buyer.client, body);
      expect(q.groups[0]!.lines[0]!).toMatchObject({ promotion: null, promotionDiscount: '0.00' });
      expect(q.groups[0]!.lines[0]!.price).toMatchObject({
        source: 'FLASH_SALE',
        unitPrice: '900.00',
      });

      // 15% (₱150) beats it: regular price less the campaign, and no flash unit is taken.
      await seller.client
        .patch(`/api/v1/seller/campaigns/${promo.id}`)
        .send({ value: '15' })
        .expect(200);
      q = await quote(buyer.client, body);
      expect(q.groups[0]!.lines[0]!.price).toMatchObject({
        source: 'REGULAR',
        unitPrice: '1000.00',
      });
      expect(q.groups[0]!.lines[0]!).toMatchObject({
        promotionDiscount: '150.00',
        lineTotal: '850.00',
      });
      const res = await placeOrder(buyer.client, { addressId: buyer.addressId, ...body });
      expect(res.status).toBe(201);
      const flash = await prisma.flashSaleItem.findFirstOrThrow({
        where: { variantId: item.variantId },
      });
      expect(flash.soldQuantity).toBe(0);
      const placed = orderDetailSchema.parse(res.body);
      const so = placed.sellerOrders[0]!;
      expect(so.promotions).toEqual([
        expect.objectContaining({ campaignId: promo.id, amount: '150.00', scope: 'SELLER' }),
      ]);
      const row = await prisma.orderItem.findFirstOrThrow({ where: { sellerOrderId: so.id } });
      expect(row).toMatchObject({ campaignId: promo.id, flashSaleItemId: null });
      expect(row.promotionDiscount.toFixed(2)).toBe('150.00');
      // Seller-paid: the commission base is what the item sold for after the campaign.
      expect(row.commissionBase.toFixed(2)).toBe('850.00');
    });

    it('gives free shipping from a campaign or a coupon, never both, and stacks coupons on campaigns', async () => {
      const ship = await campaign(admin, '/api/v1/campaigns', {
        name: 'Free shipping on mugs',
        type: 'FREE_SHIPPING',
        productIds: [mug.productId],
      });
      const freeShip = await coupon(admin, '/api/v1/coupons', {
        type: 'FREE_SHIPPING',
        value: '0',
      });
      const pct = await campaign(sellerB.client, '/api/v1/seller/campaigns', {
        name: 'Mug 20% off',
        type: 'PERCENTAGE_OFF',
        value: '20',
        productIds: [mug.productId],
      });
      const sellerCoupon = await coupon(sellerB.client, '/api/v1/seller/coupons', {
        type: 'FIXED_AMOUNT',
        value: '50',
      });
      const buyer = await shopper(app);
      const q = await quote(buyer.client, {
        buyNow: { variantId: mug.variantId, quantity: 1 },
        couponCodes: [freeShip.code, sellerCoupon.code],
      });
      const g = q.groups[0]!;
      expect(D(g.shipping.fee).gt(0)).toBe(true);
      expect(g.shipping.platformDiscount).toBe(g.shipping.fee);
      expect(g.promotions.map((p) => p.campaignId).sort()).toEqual([pct.id, ship.id].sort());
      expect(q.coupons.find((c) => c.code === freeShip.code)).toMatchObject({
        status: 'NOT_APPLIED',
        message: 'Shipping is already free with a promotion.',
      });
      // 20% campaign first (₱100), then the seller coupon on what is left (₱50).
      expect(g.lines[0]!).toMatchObject({ promotionDiscount: '100.00', sellerDiscount: '150.00' });
      expect(q.totals).toMatchObject({ promotionDiscount: '100.00', couponDiscount: '50.00' });
      // Every amount adds up on the server.
      const t = q.totals;
      expect(
        D(t.itemsSubtotal)
          .sub(t.promotionDiscount)
          .sub(t.couponDiscount)
          .sub(t.pointsDiscount)
          .add(t.shippingFee)
          .sub(t.shippingDiscount)
          .add(t.chargesTotal)
          .toFixed(2),
      ).toBe(t.grandTotal);
      for (const id of [ship.id])
        await admin.patch(`/api/v1/campaigns/${id}`).send({ status: 'INACTIVE' }).expect(200);
      await sellerB.client
        .patch(`/api/v1/seller/campaigns/${pct.id}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
    });

    it('rejects campaigns that target another seller’s products', async () => {
      const res = await sellerB.client.post('/api/v1/seller/campaigns').send({
        name: 'Not mine',
        type: 'PERCENTAGE_OFF',
        value: '10',
        appliesTo: 'PRODUCTS',
        productIds: [lamp.productId],
        startsAt: hourAgo(),
        endsAt: inADay(),
      });
      expect(res.status).toBe(422);
    });
  });

  // ---- Loyalty ------------------------------------------------------------------------------

  describe('loyalty points', () => {
    const summary = async (client: TestClient) =>
      loyaltySummarySchema.parse((await client.get('/api/v1/account/loyalty').expect(200)).body);

    it('caps redemption, earns on completion, follows refunds and expires first-in first-out', async () => {
      const buyer = await shopper(app);
      await admin
        .post(`/api/v1/loyalty/accounts/${buyer.userId}/adjustments`)
        .send({ points: 500, reason: 'Welcome gift for testing' })
        .expect(200);
      expect((await summary(buyer.client)).balance).toBe(500);
      const adjust = await prisma.loyaltyTransaction.findFirstOrThrow({
        where: { userId: buyer.userId, type: 'ADJUST' },
      });
      const adjustJournal = await journal(`loyalty:${adjust.id}`);
      expect(adjustJournal!.entries.map((e) => e.account.code).sort()).toEqual(['2410', '5050']);

      // At most 20% of the ₱1,000 lamp: 200 points.
      const body = { buyNow: { variantId: lamp.variantId, quantity: 1 }, pointsToRedeem: 400 };
      const q = await quote(buyer.client, body);
      expect(q.loyalty).toMatchObject({
        balance: 500,
        maxRedeemablePoints: 200,
        pointsApplied: 200,
      });
      expect(q.totals.pointsDiscount).toBe('200.00');
      expect(q.loyalty!.message).toContain('200');

      const { placed, so } = await delivered(buyer, sellerA, lamp, { pointsToRedeem: 200 });
      expect(placed.pointsRedeemed).toBe(200);
      expect((await summary(buyer.client)).balance).toBe(300);
      // The sale uses up the points liability (2410) instead of the voucher expense.
      const sale = await journal(`sale:${so.id}`);
      const points = sale!.entries.find((e) => e.kind === 'POINTS')!;
      expect(points.account.code).toBe('2410');
      expect(points.debit.toFixed(2)).toBe('200.00');

      await complete(so.id);
      // ₱800 paid for merchandise: 8 points, expiring in 12 months.
      const earn = await prisma.loyaltyTransaction.findUniqueOrThrow({
        where: { idempotencyKey: `earn:${so.id}` },
      });
      expect(earn.points).toBe(8);
      expect(earn.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);
      expect(await journal(`loyalty:${earn.id}`)).not.toBeNull();
      expect((await summary(buyer.client)).balance).toBe(308);

      // Refund half the items: half the spent points come back, earned points follow the net.
      await admin
        .post('/api/v1/refunds')
        .send({
          sellerOrderId: so.id,
          reason: 'OTHER',
          kind: 'PARTIAL',
          amount: '400.00',
          note: 'Half refunded as goodwill',
          idempotencyKey: randomUUID(),
        })
        .expect(200);
      const refund = await prisma.refund.findFirstOrThrow({ where: { sellerOrderId: so.id } });
      expect(refund.status).toBe('SUCCEEDED');
      const txs = await prisma.loyaltyTransaction.findMany({ where: { refundId: refund.id } });
      // In proportion to the items part of the refund (a partial refund also covers shipping).
      const restored = refund.itemsAmount.dividedBy(800).times(200).round().toNumber();
      const keep = Math.floor((800 - refund.itemsAmount.toNumber()) / 100);
      expect(restored).toBeGreaterThan(0);
      expect(txs.find((t) => t.type === 'RESTORE')?.points).toBe(restored);
      expect(txs.find((t) => t.type === 'REVERSE')?.points).toBe(keep - 8);
      const balance = 300 + restored + keep;
      expect((await summary(buyer.client)).balance).toBe(balance);

      // A year and a month later the lots have expired (whatever was not spent).
      await expireLoyaltyPoints(prisma, {
        now: new Date(Date.now() + 400 * 86_400_000),
        userId: buyer.userId,
      });
      const after = await summary(buyer.client);
      expect(after.balance).toBe(0);
      const history = await buyer.client.get('/api/v1/account/loyalty/transactions').expect(200);
      expect(history.body.items[0]).toMatchObject({ type: 'EXPIRE', points: -balance });
    });

    it('gives every spent point back when an unpaid order is cancelled', async () => {
      const buyer = await shopper(app);
      await admin
        .post(`/api/v1/loyalty/accounts/${buyer.userId}/adjustments`)
        .send({ points: 100, reason: 'Testing a cancellation' })
        .expect(200);
      const res = await placeOrder(buyer.client, {
        addressId: buyer.addressId,
        buyNow: { variantId: lamp.variantId, quantity: 1 },
        pointsToRedeem: 100,
      });
      expect(res.status).toBe(201);
      const placed = orderDetailSchema.parse(res.body);
      expect((await summary(buyer.client)).balance).toBe(0);
      await buyer.client
        .post(`/api/v1/account/orders/${placed.id}/cancel`)
        .send({ reason: 'Changed my mind' })
        .expect(200);
      expect((await summary(buyer.client)).balance).toBe(100);
      const restore = await prisma.loyaltyTransaction.findFirstOrThrow({
        where: { orderId: placed.id, type: 'RESTORE' },
      });
      // The sale was never posted, so there is nothing to reverse in the ledger.
      expect(await journal(`loyalty:${restore.id}`)).toBeNull();
    });

    it('refuses to take away more points than the customer has', async () => {
      const buyer = await shopper(app);
      const res = await admin
        .post(`/api/v1/loyalty/accounts/${buyer.userId}/adjustments`)
        .send({ points: -10, reason: 'Testing the floor' });
      expect(res.status).toBe(409);
    });
  });

  // ---- Referrals and affiliates ---------------------------------------------------------------

  describe('referrals', () => {
    it('rewards both customers when the friend’s first order completes', async () => {
      const referrer = await shopper(app);
      const mine = myReferralsSchema.parse(
        (await referrer.client.get('/api/v1/account/referrals').expect(200)).body,
      );
      expect(mine.link).toContain(`ref=${mine.code}`);

      const c = await new TestClient(app.getHttpServer(), 'storefront').init();
      const mobile = randomMobile();
      const body = {
        firstName: 'Referred',
        lastName: 'Friend',
        email: uniqueEmail('referred'),
        mobile,
        password: TEST_PASSWORD,
        referralCode: mine.code,
      };
      const bad = await c
        .post('/api/v1/auth/customers/sign-up')
        .send({ ...body, referralCode: 'NOPE1234' });
      expect(bad.status).toBe(422);
      const start = otpChallengeResponseSchema.parse(
        (await c.post('/api/v1/auth/customers/sign-up').send(body).expect(202)).body,
      );
      await c
        .post('/api/v1/auth/customers/sign-up/verify')
        .send({ challengeId: start.challengeId, code: await latestOtp(app, mobile) })
        .expect(201);
      const friend = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
      const referral = await prisma.referral.findUniqueOrThrow({ where: { refereeId: friend.id } });
      expect(referral).toMatchObject({ referrerId: referrer.userId, status: 'PENDING' });
      // The welcome notification was written to the outbox with the account.
      expect(
        await prisma.notificationEvent.count({
          where: { event: 'CUSTOMER_REGISTERED', userIds: { has: friend.id } },
        }),
      ).toBe(1);

      const address = await c
        .post('/api/v1/account/addresses')
        .send({
          recipientName: 'Referred Friend',
          mobile: '0917 123 4567',
          ...(await place(app, ...PLACES.quezonCity)),
          postalCode: '1105',
          streetAddress: '45 Kalayaan Street',
        })
        .expect(201);
      const friendShopper: Shopper = { client: c, userId: friend.id, addressId: address.body.id };
      const { so } = await delivered(friendShopper, sellerA, tee);
      await complete(so.id);
      expect((await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).status).toBe(
        'REWARDED',
      );
      const bonuses = await prisma.loyaltyTransaction.findMany({
        where: { referralId: referral.id },
      });
      expect(bonuses.map((b) => [b.userId, b.points]).sort()).toEqual(
        [
          [referrer.userId, 100],
          [friend.id, 50],
        ].sort(),
      );
    });
  });

  describe('affiliates', () => {
    it('attributes orders, accrues commission in the ledger on completion and records the payout', async () => {
      const affiliate = await shopper(app);
      const applied = affiliateAccountSchema.parse(
        (
          await affiliate.client
            .post('/api/v1/account/affiliate')
            .send({ displayName: 'Lamp Reviews PH', website: 'https://example.com' })
            .expect(201)
        ).body,
      );
      expect(applied.status).toBe('PENDING');
      // Not active until approved.
      const buyer = await shopper(app);
      let q = await quote(buyer.client, {
        buyNow: { variantId: lamp.variantId, quantity: 1 },
        affiliateCode: applied.code,
      });
      expect(q.affiliate).toMatchObject({ applied: false });
      await admin
        .patch(`/api/v1/affiliates/${applied.id}`)
        .send({ status: 'APPROVED', commissionRate: '10', note: 'Good content' })
        .expect(200);
      await buyer.client
        .post('/api/v1/storefront/affiliate-clicks')
        .send({ code: applied.code, landingPath: '/products/lamp' })
        .expect(200);
      q = await quote(buyer.client, {
        buyNow: { variantId: lamp.variantId, quantity: 1 },
        affiliateCode: applied.code,
      });
      expect(q.affiliate).toMatchObject({ applied: true });
      // Never on the affiliate's own orders.
      const own = await quote(affiliate.client, {
        buyNow: { variantId: lamp.variantId, quantity: 1 },
        affiliateCode: applied.code,
      });
      expect(own.affiliate).toMatchObject({ applied: false });

      const { so } = await delivered(buyer, sellerA, lamp, { affiliateCode: applied.code });
      const conversion = await prisma.affiliateConversion.findUniqueOrThrow({
        where: { sellerOrderId: so.id },
      });
      expect(conversion).toMatchObject({ status: 'PENDING' });
      expect(conversion.commissionAmount.toFixed(2)).toBe('100.00');
      await complete(so.id);
      const accrued = await prisma.affiliateConversion.findUniqueOrThrow({
        where: { id: conversion.id },
      });
      expect(accrued.status).toBe('ACCRUED');
      const accrual = await journal(`affiliate:${conversion.id}`);
      expect(accrual!.entries.map((e) => e.account.code).sort()).toEqual(['2420', '5060']);
      // The frozen amounts cannot be edited.
      await expect(
        prisma.affiliateConversion.update({ where: { id: conversion.id }, data: { rate: D(50) } }),
      ).rejects.toThrow();

      const report = await affiliate.client.get('/api/v1/account/affiliate/report').expect(200);
      // Below the minimum payout (₱500 by default) nothing can be paid out yet.
      const early = await admin
        .post(`/api/v1/affiliates/${applied.id}/payouts`)
        .send({ method: 'GCash' });
      expect(early.status).toBe(409);
      const settings = (await admin.get('/api/v1/settings/affiliates').expect(200)).body;
      await admin
        .put('/api/v1/settings/affiliates')
        .send({ ...settings, minPayout: '50' })
        .expect(200);
      expect(report.body.totals).toMatchObject({ clicks: 1, conversions: 1, payable: '100.00' });
      const payout = await admin
        .post(`/api/v1/affiliates/${applied.id}/payouts`)
        .send({ method: 'GCash transfer', externalReference: 'GC-123' })
        .expect(201);
      expect(payout.body).toMatchObject({ amount: '100.00', conversions: 1 });
      expect(await journal(`affiliate-payout:${payout.body.id}`)).not.toBeNull();
      expect(
        (await prisma.affiliateConversion.findUniqueOrThrow({ where: { id: conversion.id } }))
          .status,
      ).toBe('PAID');
      // Nothing left to pay.
      const again = await admin
        .post(`/api/v1/affiliates/${applied.id}/payouts`)
        .send({ method: 'GCash' });
      expect(again.status).toBe(409);
      await admin.put('/api/v1/settings/affiliates').send(settings).expect(200);
    });
  });

  // ---- Reviews and ratings ----------------------------------------------------------------

  describe('reviews and seller ratings', () => {
    it('handles photos, verified purchase, seller replies, reports and seller ratings', async () => {
      const buyer = await shopper(app);
      const ordered = await order(buyer, [{ variantId: mug.variantId, quantity: 1 }], 'COD');
      const item = ordered.sellerOrders[0]!.items[0]!;
      // Rating the seller needs a delivered order.
      const early = await buyer.client
        .put(`/api/v1/account/seller-orders/${ordered.sellerOrders[0]!.id}/rating`)
        .send({ productQuality: 5, shippingSpeed: 4, communication: 5 });
      expect(early.status).toBe(422);

      const created = await buyer.client
        .post('/api/v1/account/reviews')
        .send({ orderItemId: item.id, rating: 4, body: 'Nice mug' })
        .expect(200);
      const review = created.body.reviews.find(
        (r: { orderItemId: string }) => r.orderItemId === item.id,
      );
      // One review per purchased item.
      expect(
        (
          await buyer.client
            .post('/api/v1/account/reviews')
            .send({ orderItemId: item.id, rating: 5 })
        ).status,
      ).toBe(409);
      const withPhoto = await buyer.client
        .post(`/api/v1/account/reviews/${review.id}/images`)
        .attach('images', await image(400, 300), 'mug.jpg')
        .expect(200);
      const photo = withPhoto.body.reviews.find((r: { id: string }) => r.id === review.id)
        .images[0];
      expect(photo.url).toMatch(/^\/api\/v1\/catalog\/review-images\//);
      const served = await buyer.client.get(photo.url).expect(200);
      expect(served.headers['content-type']).toBe('image/webp');

      // Seller reply (seller.reviews.reply), shown with the review.
      await sellerB.client
        .put(`/api/v1/seller/reviews/${review.id}/reply`)
        .send({ body: 'Thank you!' })
        .expect(200);
      await sellerA.client
        .put(`/api/v1/seller/reviews/${review.id}/reply`)
        .send({ body: 'Not mine' })
        .expect(404);
      const listing = reviewListSchema.parse(
        (await buyer.client.get(`/api/v1/catalog/products/${mug.productId}/reviews`).expect(200))
          .body,
      );
      const shown = listing.items.find((r) => r.id === review.id)!;
      expect(shown).toMatchObject({ verifiedPurchase: false, sellerReply: { body: 'Thank you!' } });
      expect(
        await prisma.notificationEvent.count({
          where: { event: 'REVIEW_REPLIED', userIds: { has: buyer.userId } },
        }),
      ).toBe(1);

      // Reports: once per customer, never one's own; staff uphold and the review is hidden.
      const other = await shopper(app);
      await buyer.client
        .post(`/api/v1/catalog/reviews/${review.id}/report`)
        .send({ reason: 'SPAM' })
        .expect(409);
      await other.client
        .post(`/api/v1/catalog/reviews/${review.id}/report`)
        .send({ reason: 'OFFENSIVE' })
        .expect(204);
      await other.client
        .post(`/api/v1/catalog/reviews/${review.id}/report`)
        .send({ reason: 'SPAM' })
        .expect(409);
      const reported = await admin.get('/api/v1/reviews?reported=true&pageSize=100').expect(200);
      expect(reported.body.items.find((r: { id: string }) => r.id === review.id).openReports).toBe(
        1,
      );
      await admin
        .post(`/api/v1/reviews/${review.id}/reports/resolve`)
        .send({ action: 'UPHOLD' })
        .expect(422);
      await admin
        .post(`/api/v1/reviews/${review.id}/reports/resolve`)
        .send({ action: 'UPHOLD', note: 'Abusive language' })
        .expect(204);
      expect(
        (await prisma.productReview.findUniqueOrThrow({ where: { id: review.id } })).status,
      ).toBe('HIDDEN');
      await buyer.client.get(photo.url).expect(404);

      // Deliver, then rate the seller.
      const so = ordered.sellerOrders[0]!;
      const shipment = await acceptAndShip(sellerB.client, so.id);
      await courier(admin, shipment.id, 'PICKED_UP');
      await courier(admin, shipment.id, 'DELIVERED', ordered.grandTotal);
      await buyer.client
        .put(`/api/v1/account/seller-orders/${so.id}/rating`)
        .send({ productQuality: 5, shippingSpeed: 4, communication: 3, comment: 'Fast enough' })
        .expect(200);
      const store = await prisma.store.findFirstOrThrow({ where: { sellerId: sellerB.sellerId } });
      const rating = sellerRatingSummarySchema.parse(
        (await buyer.client.get(`/api/v1/catalog/stores/${store.id}/ratings`).expect(200)).body,
      );
      expect(rating.count).toBeGreaterThanOrEqual(1);
      expect(Number(rating.overall)).toBeGreaterThan(0);
    });
  });

  // ---- Support ------------------------------------------------------------------------------

  describe('support tickets', () => {
    it('routes order tickets to the seller, lets support take over and enforces access', async () => {
      const buyer = await shopper(app);
      const ordered = await order(buyer, [{ variantId: lamp.variantId, quantity: 1 }], 'COD');
      const so = ordered.sellerOrders[0]!;
      const created = ticketDetailSchema.parse(
        (
          await buyer.client
            .post('/api/v1/account/support/tickets')
            .field(
              'data',
              JSON.stringify({
                subject: 'Lamp colour',
                category: 'ORDER',
                sellerOrderId: so.id,
                body: 'Can I get the black one instead?',
              }),
            )
            .attach('attachments', await image(300, 300, 'png'), 'photo.png')
            .expect(200)
        ).body,
      );
      expect(created).toMatchObject({ status: 'AWAITING_SELLER', sellerOrderNumber: so.number });
      const attachment = created.messages[0]!.attachments[0]!;

      // The other seller and other customers cannot see it.
      await sellerB.client.get(`/api/v1/seller/support/tickets/${created.id}`).expect(404);
      const stranger = await shopper(app);
      await stranger.client.get(`/api/v1/account/support/tickets/${created.id}`).expect(404);
      await stranger.client
        .get(`/api/v1/account/support/tickets/${created.id}/attachments/${attachment.id}`)
        .expect(404);

      const seller = sellerA.client;
      const list = ticketListSchema.parse(
        (await seller.get('/api/v1/seller/support/tickets').expect(200)).body,
      );
      expect(list.items.map((t) => t.id)).toContain(created.id);
      await seller
        .post(`/api/v1/seller/support/tickets/${created.id}/messages`)
        .field('data', JSON.stringify({ body: 'Check stock first', internal: true }))
        .expect(200);
      const answered = ticketDetailSchema.parse(
        (
          await seller
            .post(`/api/v1/seller/support/tickets/${created.id}/messages`)
            .field('data', JSON.stringify({ body: 'Yes, we can swap it.' }))
            .expect(200)
        ).body,
      );
      expect(answered.status).toBe('AWAITING_CUSTOMER');
      // Customers never see internal notes.
      const mine = ticketDetailSchema.parse(
        (await buyer.client.get(`/api/v1/account/support/tickets/${created.id}`).expect(200)).body,
      );
      expect(mine.messages.map((m) => m.body)).toEqual([
        'Can I get the black one instead?',
        'Yes, we can swap it.',
      ]);
      await buyer.client
        .post(`/api/v1/account/support/tickets/${created.id}/messages`)
        .field('data', JSON.stringify({ body: 'Note', internal: true }))
        .expect(403);
      const file = await buyer.client
        .get(`/api/v1/account/support/tickets/${created.id}/attachments/${attachment.id}`)
        .expect(200);
      expect(file.headers['content-type']).toBe('image/png');

      // Support takes over: the customer's next reply goes to the marketplace.
      const taken = ticketDetailSchema.parse(
        (
          await support
            .post(`/api/v1/support/tickets/${created.id}/actions`)
            .send({ action: 'TAKE_OVER' })
            .expect(200)
        ).body,
      );
      expect(taken.supportJoined).toBe(true);
      const replied = ticketDetailSchema.parse(
        (
          await buyer.client
            .post(`/api/v1/account/support/tickets/${created.id}/messages`)
            .field('data', JSON.stringify({ body: 'Thanks, any update?' }))
            .expect(200)
        ).body,
      );
      expect(replied.status).toBe('AWAITING_SUPPORT');
      await buyer.client
        .post(`/api/v1/account/support/tickets/${created.id}/actions`)
        .send({ action: 'CLOSE' })
        .expect(200);
      await seller
        .post(`/api/v1/seller/support/tickets/${created.id}/messages`)
        .field('data', JSON.stringify({ body: 'Too late' }))
        .expect(409);
      // General inquiries go straight to marketplace support.
      const general = ticketDetailSchema.parse(
        (
          await buyer.client
            .post('/api/v1/account/support/tickets')
            .field(
              'data',
              JSON.stringify({
                subject: 'Account email',
                category: 'ACCOUNT',
                body: 'How do I change it?',
              }),
            )
            .expect(200)
        ).body,
      );
      expect(general).toMatchObject({ status: 'AWAITING_SUPPORT', store: null });
      await sellerA.client.get(`/api/v1/seller/support/tickets/${general.id}`).expect(404);
    });
  });

  // ---- Notifications ------------------------------------------------------------------------

  describe('notifications', () => {
    it('writes order events to the outbox for the worker, and serves the inbox and preferences', async () => {
      const buyer = await shopper(app);
      const ordered = await order(buyer, [{ variantId: tee.variantId, quantity: 1 }], 'COD');
      const events = await prisma.notificationEvent.findMany({
        where: {
          OR: [
            { userIds: { has: buyer.userId } },
            {
              event: 'SELLER_NEW_ORDER',
              data: { path: ['orderNumber'], string_starts_with: ordered.orderNumber },
            },
          ],
        },
      });
      expect(events.map((e) => e.event).sort()).toEqual(['ORDER_PLACED', 'SELLER_NEW_ORDER']);
      expect(events.every((e) => e.status === 'PENDING')).toBe(true);

      // The worker writes inbox rows; here one is written directly to exercise the API.
      await prisma.notification.create({
        data: {
          userId: buyer.userId,
          event: 'ORDER_PLACED',
          title: 'Order placed',
          body: 'Thanks',
        },
      });
      let inbox = notificationListSchema.parse(
        (await buyer.client.get('/api/v1/notifications').expect(200)).body,
      );
      expect(inbox.unread).toBe(1);
      await buyer.client.post('/api/v1/notifications/read').send({ all: true }).expect(200);
      inbox = notificationListSchema.parse(
        (await buyer.client.get('/api/v1/notifications').expect(200)).body,
      );
      expect(inbox.unread).toBe(0);

      const prefs = await buyer.client
        .put('/api/v1/notifications/preferences')
        .send({
          channels: [
            { channel: 'SMS', enabled: false },
            { channel: 'IN_APP', enabled: false },
          ],
        })
        .expect(200);
      expect(prefs.body.channels).toEqual(
        expect.arrayContaining([
          { channel: 'SMS', enabled: false },
          { channel: 'IN_APP', enabled: true },
        ]),
      );
      await buyer.client
        .post('/api/v1/notifications/push-subscriptions')
        .send({
          endpoint: `https://push.example.com/${randomUUID()}`,
          keys: { p256dh: 'p256dh-key-value', auth: 'auth-key' },
        })
        .expect(200);
    });

    it('validates template variables and keeps built-in emails built in', async () => {
      const bad = await admin
        .put('/api/v1/notification-templates/ORDER_SHIPPED/SMS')
        .send({ body: 'Shipped {{secretThing}}' });
      expect(bad.status).toBe(422);
      const builtIn = await admin
        .put('/api/v1/notification-templates/ORDER_PLACED/EMAIL')
        .send({ subject: 'Subject', body: 'Body text' });
      expect(builtIn.status).toBe(422);
      const list = await admin.get('/api/v1/notification-templates').expect(200);
      expect(
        list.body.events.find((e: { code: string }) => e.code === 'ORDER_PLACED').builtInEmail,
      ).toBe(true);
      await support.get('/api/v1/notification-templates').expect(403);
    });
  });

  // ---- Analytics ----------------------------------------------------------------------------

  describe('analytics', () => {
    it('reports from live data and exports CSV, Excel and PDF', async () => {
      const report = reportSchema.parse(
        (
          await admin
            .get(`/api/v1/reports/sales?from=${today()}&to=${today()}&sellerId=${sellerA.sellerId}`)
            .expect(200)
        ).body,
      );
      const start = new Date(`${today()}T00:00:00+08:00`);
      const expected = await prisma.sellerOrder.aggregate({
        where: {
          sellerId: sellerA.sellerId,
          status: { notIn: ['CANCELLED', 'AWAITING_PAYMENT'] },
          order: { placedAt: { gte: start } },
        },
        _sum: { itemsSubtotal: true },
      });
      expect(report.kpis.find((k) => k.key === 'gmv')!.value).toBe(
        expected._sum.itemsSubtotal!.toFixed(2),
      );
      expect(report.series.points).toHaveLength(1);

      const seller = reportSchema.parse(
        (
          await sellerA.client
            .get(`/api/v1/seller/reports/sales?from=${today()}&to=${today()}`)
            .expect(200)
        ).body,
      );
      expect(seller.kpis.find((k) => k.key === 'gmv')!.value).toBe(
        expected._sum.itemsSubtotal!.toFixed(2),
      );
      await sellerA.client.get('/api/v1/reports/sales').expect(403);
      const inventory = reportSchema.parse(
        (await sellerA.client.get('/api/v1/seller/reports/inventory').expect(200)).body,
      );
      expect(inventory.table.rows.map((r) => r.sku)).toEqual(
        expect.arrayContaining([lamp.sku, tee.sku]),
      );

      const csv = await admin
        .get(`/api/v1/reports/sellers/export?format=csv&from=${today()}`)
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toContain('Seller,Orders,GMV');
      const xlsx = await admin
        .get(`/api/v1/reports/products/export?format=xlsx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const pdf = await sellerA.client
        .get('/api/v1/seller/reports/commissions/export?format=pdf')
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      const invalid = await admin.get('/api/v1/reports/sales?from=2026-12-02&to=2026-12-01');
      expect(invalid.status).toBe(400);
      expect(errorCode(invalid)).toBe('VALIDATION_FAILED');
    });
  });
});
