import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  customerAddressListSchema,
  customerAddressSchema,
  homePageSchema,
  locationListSchema,
  myReviewsSchema,
  orderDetailSchema,
  productSearchResultSchema,
  reviewListSchema,
  storefrontProductSchema,
  wishlistSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, TestClient } from './auth-helpers';
import { image, testCategory, unique } from './catalog-helpers';
import {
  listed,
  PLACES,
  place,
  placeOrder,
  shopper,
  shopSeller,
  type ShopSeller,
} from './shop-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

/** Storefront: locations, addresses, search, home page, product pages, wishlist and reviews. */
describe('Storefront (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let guest: TestClient;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'storefront-admin')).client;
    guest = await new TestClient(app.getHttpServer(), 'storefront').init();
    categoryId = (await testCategory(app)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('locations and addresses', () => {
    const children = async (parentCode?: string) =>
      locationListSchema.parse(
        (
          await guest
            .get(`/api/v1/locations${parentCode ? `?parentCode=${parentCode}` : ''}`)
            .expect(200)
        ).body,
      ).items;

    it('walks the PSGC tree: regions, provinces or cities, then barangays', async () => {
      const regions = await children();
      expect(regions).toHaveLength(17);
      const ncr = regions.find((r) => r.code === '1300000000')!;
      // Metro Manila has no provinces: its cities come straight after the region.
      const ncrCities = await children(ncr.code);
      expect(ncrCities.every((c) => c.level === 'CITY' || c.level === 'MUNICIPALITY')).toBe(true);
      expect(ncrCities.map((c) => c.name)).toEqual(
        expect.arrayContaining(['Quezon City', 'Pateros']),
      );
      // Central Visayas: provinces, then the independent cities (Cebu City is no province's).
      const r7 = regions.find((r) => r.name.startsWith('Region VII '))!;
      const r7Children = await children(r7.code);
      expect(r7Children.filter((c) => c.level === 'PROVINCE').map((c) => c.name)).toEqual(
        expect.arrayContaining(['Bohol', 'Cebu', 'Siquijor']),
      );
      expect(r7Children.find((c) => c.name === 'City of Cebu')?.level).toBe('CITY');
      const qc = ncrCities.find((c) => c.name === 'Quezon City')!;
      const barangays = await children(qc.code);
      expect(barangays.length).toBeGreaterThan(100);
      expect(barangays.every((b) => b.level === 'BARANGAY')).toBe(true);
      // Manila's barangays sit in districts; they are listed under the city.
      const manila = ncrCities.find((c) => c.name === 'City of Manila')!;
      expect((await children(manila.code)).length).toBeGreaterThan(800);
      await guest.get('/api/v1/locations?parentCode=9999999999').expect(404);
    });

    it('saves addresses that really fit together, with one default', async () => {
      const buyer = await shopper(app);
      const cebu = await place(app, 'Lahug', 'City of Cebu');
      const added = customerAddressSchema.parse(
        (
          await buyer.client
            .post('/api/v1/account/addresses')
            .send({
              label: 'Office',
              recipientName: 'Ana Reyes',
              mobile: '09181234567',
              ...cebu,
              postalCode: '6000',
              streetAddress: '88 Gorordo Avenue',
              addressLine2: 'Unit 5B, IT Park Tower',
              isDefault: true,
            })
            .expect(201)
        ).body,
      );
      expect(added).toMatchObject({
        isDefault: true,
        mobile: '+639181234567',
        province: null,
        city: { name: 'City of Cebu', level: 'CITY' },
        formatted:
          '88 Gorordo Avenue, Unit 5B, IT Park Tower, Lahug, City of Cebu, Region VII (Central Visayas), 6000',
      });
      const list = customerAddressListSchema.parse(
        (await buyer.client.get('/api/v1/account/addresses').expect(200)).body,
      );
      expect(list.items.filter((a) => a.isDefault).map((a) => a.id)).toEqual([added.id]);

      // A barangay from another city is refused.
      const qc = await place(app, 'Bagong Pag-asa', 'Quezon City');
      const mismatch = await buyer.client.post('/api/v1/account/addresses').send({
        recipientName: 'X Y',
        mobile: '09181234567',
        ...cebu,
        barangayCode: qc.barangayCode,
        postalCode: '6000',
        streetAddress: '1 Street',
      });
      expect(mismatch.status).toBe(422);
      expect(apiErrorBodySchema.parse(mismatch.body).error.fieldErrors?.[0]?.path).toBe(
        'barangayCode',
      );

      // Deleting the default promotes another address.
      await buyer.client.delete(`/api/v1/account/addresses/${added.id}`).expect(204);
      const after = customerAddressListSchema.parse(
        (await buyer.client.get('/api/v1/account/addresses').expect(200)).body,
      );
      expect(after.items).toHaveLength(1);
      expect(after.items[0]!.isDefault).toBe(true);
      // Staff and sellers have no address book here.
      await admin.get('/api/v1/account/addresses').expect(403);
    });
  });

  describe('search and filters', () => {
    let seller: ShopSeller;
    let other: ShopSeller;
    let brandId: string;
    const word = unique('zq').replace(/-/g, '');
    let ids: Record<string, string>;

    beforeAll(async () => {
      seller = await shopSeller(app, PLACES.quezonCity);
      other = await shopSeller(app, PLACES.cebuCity);
      brandId = (
        await prisma.brand.create({
          data: { name: `Brand ${word}`, slug: `brand-${word}`, status: 'ACTIVE' },
        })
      ).id;
      const cheap = await listed(seller, admin, categoryId, {
        name: `${word} Basic Mug`,
        price: '150.00',
        stock: 5,
      });
      const mid = await listed(seller, admin, categoryId, {
        name: `${word} Steel Tumbler`,
        price: '450.00',
        stock: 0,
        overrides: { brandId },
      });
      const dear = await listed(other, admin, categoryId, {
        name: `${word} Ceramic Teapot`,
        price: '1200.00',
        stock: 3,
      });
      await prisma.product.update({
        where: { id: dear.productId },
        data: { ratingAverage: 4.8, ratingCount: 5, soldCount: 40 },
      });
      await prisma.product.update({
        where: { id: cheap.productId },
        data: { wholesaleEnabled: true, soldCount: 3 },
      });
      ids = { cheap: cheap.productId, mid: mid.productId, dear: dear.productId };
    });

    const search = async (query: string) =>
      productSearchResultSchema.parse(
        (await guest.get(`/api/v1/catalog/products?${query}`).expect(200)).body,
      );

    it('finds products by keyword, including partial words, with facets', async () => {
      const all = await search(`q=${word}`);
      expect(all.engine).toBe('postgres');
      expect(all.totalItems).toBe(3);
      expect(all.facets.stores).toHaveLength(2);
      expect(all.facets.brands).toEqual([expect.objectContaining({ id: brandId, count: 1 })]);
      expect(all.facets.priceRange).toEqual({ min: '150.00', max: '1200.00' });
      const partial = await search(`q=${word}%20tumb`);
      expect(partial.items.map((i) => i.id)).toEqual([ids.mid]);
      const suggest = (await guest.get(`/api/v1/catalog/suggest?q=${word}`).expect(200)).body as {
        products: { id: string }[];
      };
      expect(suggest.products).toHaveLength(3);
    });

    it('filters by category, store, seller, brand, price, rating, stock and wholesale', async () => {
      const base = `q=${word}`;
      expect((await search(`${base}&categoryId=${categoryId}`)).totalItems).toBe(3);
      expect((await search(`${base}&storeId=${other.storeId}`)).items.map((i) => i.id)).toEqual([
        ids.dear,
      ]);
      expect((await search(`${base}&sellerId=${seller.sellerId}`)).totalItems).toBe(2);
      expect((await search(`${base}&brandIds=${brandId}`)).items.map((i) => i.id)).toEqual([
        ids.mid,
      ]);
      expect((await search(`${base}&minPrice=200&maxPrice=1000`)).items.map((i) => i.id)).toEqual([
        ids.mid,
      ]);
      expect((await search(`${base}&minRating=4`)).items.map((i) => i.id)).toEqual([ids.dear]);
      const inStock = await search(`${base}&inStock=true`);
      expect(inStock.items.map((i) => i.id).sort()).toEqual([ids.cheap, ids.dear].sort());
      expect((await search(`${base}&wholesale=true`)).items.map((i) => i.id)).toEqual([ids.cheap]);
      // The brand facet ignores the brand filter, so other brands stay choosable.
      expect((await search(`${base}&brandIds=${brandId}`)).facets.brands).toHaveLength(1);
      await guest.get(`/api/v1/catalog/products?brandIds=not-a-uuid`).expect(400);
    });

    it('sorts by price, newest, best selling and rating', async () => {
      const base = `q=${word}`;
      expect((await search(`${base}&sort=price_asc`)).items.map((i) => i.id)).toEqual([
        ids.cheap,
        ids.mid,
        ids.dear,
      ]);
      expect((await search(`${base}&sort=price_desc`)).items.map((i) => i.id)).toEqual([
        ids.dear,
        ids.mid,
        ids.cheap,
      ]);
      expect((await search(`${base}&sort=newest`)).items[0]!.id).toBe(ids.dear);
      expect((await search(`${base}&sort=best_selling`)).items.map((i) => i.id)).toEqual([
        ids.dear,
        ids.cheap,
        ids.mid,
      ]);
      expect((await search(`${base}&sort=rating`)).items[0]!.id).toBe(ids.dear);
      const card = (await search(`${base}&sort=rating`)).items[0]!;
      expect(card).toMatchObject({
        ratingAverage: 4.8,
        ratingCount: 5,
        soldCount: 40,
        inStock: true,
      });
    });

    it('hides products of suspended stores and paginates', async () => {
      await prisma.store.update({ where: { id: other.storeId }, data: { status: 'SUSPENDED' } });
      try {
        expect((await search(`q=${word}`)).totalItems).toBe(2);
        await guest.get(`/api/v1/catalog/products/${ids.dear}`).expect(404);
      } finally {
        await prisma.store.update({ where: { id: other.storeId }, data: { status: 'ACTIVE' } });
      }
      const pageOne = await search(`q=${word}&pageSize=2&sort=price_asc`);
      const pageTwo = await search(`q=${word}&pageSize=2&page=2&sort=price_asc`);
      expect(pageOne).toMatchObject({ totalItems: 3, totalPages: 2 });
      expect(pageTwo.items.map((i) => i.id)).toEqual([ids.dear]);
    });
  });

  describe('product pages', () => {
    it('shows stock, wholesale tiers to everyone and prices for who is asking', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { price: '500.00', stock: 7 });
      await seller.client
        .put(`/api/v1/products/${item.productId}/pricing`)
        .send({
          currency: 'PHP',
          minOrderQuantity: 1,
          wholesaleEnabled: true,
          wholesaleMinOrderQuantity: 1,
        })
        .expect(200);
      await seller.client
        .put(`/api/v1/products/${item.productId}/price-tiers`)
        .send({ tiers: [{ minQuantity: 1, unitPrice: '440.00' }] })
        .expect(200);
      const asGuest = storefrontProductSchema.parse(
        (await guest.get(`/api/v1/catalog/products/${item.productId}`).expect(200)).body,
      );
      expect(asGuest).toMatchObject({
        buyerIsWholesale: false,
        wishlisted: false,
        wholesale: { minOrderQuantity: 1, tiers: [{ minQuantity: 1, unitPrice: '440.00' }] },
        variants: [expect.objectContaining({ availableQuantity: 7, available: true })],
        ratingBreakdown: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })),
      });
      expect(asGuest.prices[0]).toMatchObject({ unitPrice: '500.00', source: 'REGULAR' });
      expect(asGuest.category.path.at(-1)).toMatchObject({ id: categoryId });
      const wholesale = await shopper(app, ['CUSTOMER', 'WHOLESALE_CUSTOMER']);
      const asWholesale = storefrontProductSchema.parse(
        (await wholesale.client.get(`/api/v1/catalog/products/${item.productId}`).expect(200)).body,
      );
      expect(asWholesale.buyerIsWholesale).toBe(true);
      expect(asWholesale.prices[0]).toMatchObject({
        unitPrice: '440.00',
        source: 'WHOLESALE_TIER',
      });
    });
  });

  describe('wishlist and reviews', () => {
    it('saves products to the wishlist', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 2 });
      const buyer = await shopper(app);
      const added = wishlistSchema.parse(
        (await buyer.client.put(`/api/v1/account/wishlist/${item.productId}`).expect(200)).body,
      );
      expect(added.items.map((i) => i.id)).toEqual([item.productId]);
      await buyer.client.put(`/api/v1/account/wishlist/${item.productId}`).expect(200);
      const page = storefrontProductSchema.parse(
        (await buyer.client.get(`/api/v1/catalog/products/${item.productId}`).expect(200)).body,
      );
      expect(page.wishlisted).toBe(true);
      const removed = wishlistSchema.parse(
        (await buyer.client.delete(`/api/v1/account/wishlist/${item.productId}`).expect(200)).body,
      );
      expect(removed.items).toEqual([]);
      await guest.put(`/api/v1/account/wishlist/${item.productId}`).expect(401);
    });

    it('lets buyers review what they bought, once per item, and staff hide reviews', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 10 });
      const buyer = await shopper(app);
      const stranger = await shopper(app);
      const order = orderDetailSchema.parse(
        (
          await placeOrder(buyer.client, {
            addressId: buyer.addressId,
            buyNow: { variantId: item.variantId, quantity: 1 },
          })
        ).body,
      );
      const orderItemId = order.sellerOrders[0]!.items[0]!.id;
      const mine = myReviewsSchema.parse(
        (await buyer.client.get('/api/v1/account/reviews').expect(200)).body,
      );
      expect(mine.toReview.map((t) => t.orderItemId)).toEqual([orderItemId]);

      await stranger.client
        .post('/api/v1/account/reviews')
        .send({ orderItemId, rating: 1 })
        .expect(404);
      await buyer.client
        .post('/api/v1/account/reviews')
        .send({ orderItemId, rating: 4, title: 'Good', body: 'Works well.' })
        .expect(200);
      const twice = await buyer.client
        .post('/api/v1/account/reviews')
        .send({ orderItemId, rating: 5 });
      expect(twice.status).toBe(409);
      expect(errorCode(twice)).toBe('CONFLICT');
      let product = await prisma.product.findUniqueOrThrow({ where: { id: item.productId } });
      expect([product.ratingAverage.toNumber(), product.ratingCount]).toEqual([4, 1]);

      const reviews = reviewListSchema.parse(
        (await guest.get(`/api/v1/catalog/products/${item.productId}/reviews`).expect(200)).body,
      );
      expect(reviews.items[0]).toMatchObject({
        rating: 4,
        title: 'Good',
        authorName: 'Test S.',
        variantTitle: 'Default',
      });

      // Moderation: hiding needs a note and takes the review out of the rating.
      const reviewId = reviews.items[0]!.id;
      await admin.patch(`/api/v1/reviews/${reviewId}`).send({ status: 'HIDDEN' }).expect(422);
      await admin
        .patch(`/api/v1/reviews/${reviewId}`)
        .send({ status: 'HIDDEN', note: 'Spam' })
        .expect(204);
      product = await prisma.product.findUniqueOrThrow({ where: { id: item.productId } });
      expect([product.ratingAverage.toNumber(), product.ratingCount]).toEqual([0, 0]);
      expect(
        (await guest.get(`/api/v1/catalog/products/${item.productId}/reviews`).expect(200)).body
          .items,
      ).toEqual([]);
      await buyer.client
        .patch(`/api/v1/reviews/${reviewId}`)
        .send({ status: 'PUBLISHED' })
        .expect(403);

      // Cancelled orders cannot be reviewed.
      const cancelled = orderDetailSchema.parse(
        (
          await placeOrder(buyer.client, {
            addressId: buyer.addressId,
            buyNow: { variantId: item.variantId, quantity: 1 },
          })
        ).body,
      );
      await buyer.client
        .post(`/api/v1/account/orders/${cancelled.id}/cancel`)
        .send({ reason: 'Wrong size' })
        .expect(200);
      await buyer.client
        .post('/api/v1/account/reviews')
        .send({ orderItemId: cancelled.sellerOrders[0]!.items[0]!.id, rating: 5 })
        .expect(422);
    });
  });

  describe('home page and its administration', () => {
    it('shows banners, flash sale, featured, best sellers, recommended and stores from the database', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { stock: 10 });
      const created = await admin
        .post('/api/v1/storefront/banners')
        .field('title', 'Payday sale')
        .field('subtitle', 'Up to 50% off')
        .field('linkUrl', '/search?q=sale')
        .field('placement', 'HERO')
        .attach('file', await image(1200, 400), 'banner.jpg')
        .expect(201);
      expect(created.body.imageUrl).toMatch(/^\/api\/v1\/storefront\/banners\/.+\/image\?v=/);
      await admin
        .post('/api/v1/storefront/banners')
        .field('title', 'Bad link')
        .field('linkUrl', 'https://evil.example')
        .attach('file', await image(1200, 400), 'banner.jpg')
        .expect(400);
      await admin
        .put('/api/v1/storefront/featured/products')
        .send({ productIds: [item.productId] })
        .expect(200);
      await admin
        .put('/api/v1/storefront/featured/stores')
        .send({ storeIds: [seller.storeId] })
        .expect(200);

      const home = homePageSchema.parse(
        (await guest.get('/api/v1/storefront/home').expect(200)).body,
      );
      expect(home.heroBanners.map((b) => b.title)).toContain('Payday sale');
      expect(home.featuredProducts.map((p) => p.id)).toEqual([item.productId]);
      expect(home.featuredStores.map((s) => s.id)).toEqual([seller.storeId]);
      expect(home.categories.length).toBeGreaterThan(0);
      expect(home.bestSellers.length).toBeGreaterThan(0);
      expect(home.recommended.length).toBeGreaterThan(0);
      const imageRes = await guest
        .get(new URL(created.body.imageUrl, 'http://x').pathname)
        .expect(200);
      expect(imageRes.headers['content-type']).toBe('image/webp');
      expect(imageRes.headers['cache-control']).toContain('immutable');

      // Inactive banners disappear; only marketing staff manage content.
      await admin
        .patch(`/api/v1/storefront/banners/${created.body.id}`)
        .send({ status: 'INACTIVE' })
        .expect(200);
      const after = homePageSchema.parse(
        (await guest.get('/api/v1/storefront/home').expect(200)).body,
      );
      expect(after.heroBanners.map((b) => b.id)).not.toContain(created.body.id);
      await seller.client.get('/api/v1/storefront/banners').expect(403);
      await admin.delete(`/api/v1/storefront/banners/${created.body.id}`).expect(204);
    });
  });

  describe('settings', () => {
    it('uses the category commission rate, falling back to the parent and the default', async () => {
      const seller = await shopSeller(app, PLACES.quezonCity);
      const item = await listed(seller, admin, categoryId, { price: '1000.00', stock: 5 });
      const leaf = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
      const rules = await admin
        .put('/api/v1/settings/commission-rules')
        .send({ categoryId: leaf.parentId, ratePercent: '8.5' })
        .expect(200);
      const parentRule = (
        rules.body.items as { id: string; category: { id: string } | null }[]
      ).find((r) => r.category?.id === leaf.parentId)!;
      const buyer = await shopper(app);
      const order = orderDetailSchema.parse(
        (
          await placeOrder(buyer.client, {
            addressId: buyer.addressId,
            buyNow: { variantId: item.variantId, quantity: 1 },
          })
        ).body,
      );
      const stored = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(stored).toMatchObject({ commissionRuleId: parentRule.id });
      expect(stored.commissionRate.toFixed(2)).toBe('8.50');
      expect(stored.commissionAmount.toFixed(2)).toBe('85.00');
      await admin.delete(`/api/v1/settings/commission-rules/${parentRule.id}`).expect(200);
      const fallback = (await admin.get('/api/v1/settings').expect(200)).body.commissionRules as {
        category: null | object;
      }[];
      expect(fallback.some((r) => r.category === null)).toBe(true);
      await seller.client.get('/api/v1/settings').expect(403);
    });
  });
});
