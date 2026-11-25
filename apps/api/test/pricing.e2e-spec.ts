import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  customerPriceListSchema,
  priceQuoteLineSchema,
  priceQuoteSchema,
  productDetailSchema,
  storefrontProductSchema,
  type ProductDetail,
} from '@marketplace/validation';
import { createUser, signedInClient, TestClient } from './auth-helpers';
import {
  approvedProduct,
  testCategory,
  testEmployee,
  testSeller,
  type TestSeller,
} from './catalog-helpers';
import { createTestApp } from './test-app';

/** Retail and wholesale pricing: always calculated by the server. */
describe('Pricing (e2e)', () => {
  let app: NestExpressApplication;
  let admin: TestClient;
  let seller: TestSeller;
  let product: ProductDetail;
  let variantId: string;
  let retail: TestClient;
  let wholesale: TestClient;
  let guest: TestClient;

  const quote = (client: TestClient, quantity: number, id = variantId) =>
    client.post('/api/v1/pricing/quote').send({ items: [{ variantId: id, quantity }] });
  const line = async (client: TestClient, quantity: number) =>
    priceQuoteSchema.parse((await quote(client, quantity).expect(200)).body).lines[0]!;

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'pricing-admin')).client;
    const category = await testCategory(app);
    seller = await testSeller(app);
    product = await approvedProduct(seller, admin, category.id);
    variantId = product.variants[0]!.id;
    // The tiers from the Phase 3 brief.
    await seller.client
      .put(`/api/v1/products/${product.id}/pricing`)
      .send({ minOrderQuantity: 1, wholesaleEnabled: true, wholesaleMinOrderQuantity: 1 })
      .expect(200);
    const tiers = productDetailSchema.parse(
      (
        await seller.client
          .put(`/api/v1/products/${product.id}/price-tiers`)
          .send({
            tiers: [
              { minQuantity: 1, unitPrice: '500.00' },
              { minQuantity: 10, unitPrice: '450.00' },
              { minQuantity: 50, unitPrice: '420.00' },
              { minQuantity: 100, unitPrice: '390.00' },
            ],
          })
          .expect(200)
      ).body,
    );
    expect(tiers.priceTiers).toHaveLength(4);
    // Price and pricing changes do not send the product back to review.
    expect(tiers.status).toBe('ACTIVE');

    retail = (await signedInClient(app, 'storefront', ['CUSTOMER'], 'retail-buyer')).client;
    wholesale = (await signedInClient(app, 'storefront', ['WHOLESALE_CUSTOMER'], 'wholesale-buyer'))
      .client;
    guest = await new TestClient(app.getHttpServer(), 'storefront').init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    [1, '500.00'],
    [9, '500.00'],
    [10, '450.00'],
    [49, '450.00'],
    [50, '420.00'],
    [99, '420.00'],
    [100, '390.00'],
    [250, '390.00'],
  ])('gives an approved wholesale customer the tier for %i units: ₱%s', async (quantity, price) => {
    const result = await line(wholesale, quantity);
    expect(result).toMatchObject({ unitPrice: price, wholesaleEligible: true, currency: 'PHP' });
    expect(result.lineTotal).toBe((Number(price) * quantity).toFixed(2));
  });

  it('charges retail customers and guests the retail price at any quantity', async () => {
    expect(await line(retail, 100)).toMatchObject({
      unitPrice: '500.00',
      source: 'REGULAR',
      wholesaleEligible: false,
      tiers: [],
    });
    expect(await line(guest, 100)).toMatchObject({ unitPrice: '500.00', source: 'REGULAR' });
  });

  it('records the applied rule as a snapshot for orders', async () => {
    const result = await line(wholesale, 60);
    expect(result.source).toBe('WHOLESALE_TIER');
    expect(result.rule).toMatchObject({ type: 'PRICE_TIER', minQuantity: 50 });
  });

  it('never accepts a price from the client', async () => {
    const res = await wholesale
      .post('/api/v1/pricing/quote')
      .send({ items: [{ variantId, quantity: 1 }], unitPrice: '1.00' })
      .expect(400);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('VALIDATION_FAILED');
    // An extra price field on an item is ignored: the server's price is used.
    const ignored = priceQuoteSchema.parse(
      (
        await wholesale
          .post('/api/v1/pricing/quote')
          .send({ items: [{ variantId, quantity: 1, unitPrice: '1.00' }] })
          .expect(200)
      ).body,
    );
    expect(ignored.lines[0]!.unitPrice).toBe('500.00');
  });

  it('applies the sale price while it runs, and never more than retail to wholesale buyers', async () => {
    const other = await approvedProduct(seller, admin, (await testCategory(app)).id);
    const id = other.variants[0]!.id;
    await seller.client
      .put(`/api/v1/products/${other.id}/pricing`)
      .send({ minOrderQuantity: 1, wholesaleEnabled: true, wholesaleMinOrderQuantity: 1 })
      .expect(200);
    await seller.client
      .put(`/api/v1/products/${other.id}/price-tiers`)
      .send({ tiers: [{ minQuantity: 10, unitPrice: '480.00' }] })
      .expect(200);
    await seller.client
      .patch(`/api/v1/products/${other.id}/variants/${id}`)
      .send({
        salePrice: '460.00',
        saleStartsAt: new Date(Date.now() - 60_000).toISOString(),
        saleEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(200);
    const res = priceQuoteSchema.parse((await quote(wholesale, 10, id).expect(200)).body).lines[0]!;
    expect(res).toMatchObject({ unitPrice: '460.00', source: 'SALE' });
    // A sale price must be below the regular price.
    await seller.client
      .patch(`/api/v1/products/${other.id}/variants/${id}`)
      .send({ salePrice: '600.00' })
      .expect(422);
  });

  it('honours tier effective dates', async () => {
    const other = await approvedProduct(seller, admin, (await testCategory(app)).id);
    const id = other.variants[0]!.id;
    await seller.client
      .put(`/api/v1/products/${other.id}/pricing`)
      .send({ minOrderQuantity: 1, wholesaleEnabled: true, wholesaleMinOrderQuantity: 1 })
      .expect(200);
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString();
    await seller.client
      .put(`/api/v1/products/${other.id}/price-tiers`)
      .send({
        tiers: [
          { minQuantity: 10, unitPrice: '470.00', endsAt: inAnHour },
          { minQuantity: 10, unitPrice: '440.00', startsAt: inAnHour },
        ],
      })
      .expect(200);
    expect(
      priceQuoteSchema.parse((await quote(wholesale, 10, id).expect(200)).body).lines[0]!.unitPrice,
    ).toBe('470.00');
  });

  it('validates tiers: no overlapping duplicates, no higher price for more units', async () => {
    const tiers = (t: unknown[]) =>
      seller.client.put(`/api/v1/products/${product.id}/price-tiers`).send({ tiers: t });
    await tiers([
      { minQuantity: 10, unitPrice: '450.00' },
      { minQuantity: 10, unitPrice: '440.00' },
    ]).expect(422);
    await tiers([
      { minQuantity: 10, unitPrice: '450.00' },
      { minQuantity: 50, unitPrice: '460.00' },
    ]).expect(422);
    await tiers([{ minQuantity: 10, unitPrice: '0' }]).expect(400);
  });

  it('enforces minimum and maximum order quantities, and the wholesale minimum', async () => {
    const other = await approvedProduct(seller, admin, (await testCategory(app)).id);
    const id = other.variants[0]!.id;
    await seller.client
      .put(`/api/v1/products/${other.id}/pricing`)
      .send({
        minOrderQuantity: 2,
        maxOrderQuantity: 500,
        wholesaleEnabled: true,
        wholesaleMinOrderQuantity: 20,
      })
      .expect(200);
    await seller.client
      .put(`/api/v1/products/${other.id}/price-tiers`)
      .send({ tiers: [{ minQuantity: 10, unitPrice: '400.00' }] })
      .expect(200);
    const tooFew = await quote(retail, 1, id).expect(422);
    expect(apiErrorBodySchema.parse(tooFew.body).error.message).toContain('between 2 and 500');
    await quote(retail, 501, id).expect(422);
    // 10 units reach the tier but not the wholesale minimum of 20.
    expect(
      priceQuoteSchema.parse((await quote(wholesale, 10, id).expect(200)).body).lines[0]!.unitPrice,
    ).toBe('500.00');
    expect(
      priceQuoteSchema.parse((await quote(wholesale, 20, id).expect(200)).body).lines[0]!.unitPrice,
    ).toBe('400.00');
    await seller.client
      .put(`/api/v1/products/${other.id}/pricing`)
      .send({
        minOrderQuantity: 10,
        maxOrderQuantity: 5,
        wholesaleEnabled: true,
        wholesaleMinOrderQuantity: 1,
      })
      .expect(400);
  });

  it('gives a named customer their agreed price, over every other price', async () => {
    const buyer = await createUser(app, { roles: ['CUSTOMER'], label: 'agreed' });
    const client = await new TestClient(app.getHttpServer(), 'storefront').init();
    await client.signIn(buyer.email);
    const list = customerPriceListSchema.parse(
      (
        await seller.client
          .post(`/api/v1/products/${product.id}/customer-prices`)
          .send({
            customerEmail: buyer.email,
            unitPrice: '410.00',
            minQuantity: 5,
            note: 'Restaurant account',
          })
          .expect(201)
      ).body,
    );
    expect(list.items[0]).toMatchObject({ unitPrice: '410.00', customer: { email: buyer.email } });
    expect(await line(client, 4)).toMatchObject({ unitPrice: '500.00', source: 'REGULAR' });
    expect(await line(client, 5)).toMatchObject({ unitPrice: '410.00', source: 'CUSTOMER_PRICE' });
    // Other customers are not affected.
    expect((await line(retail, 5)).unitPrice).toBe('500.00');
    // Duplicate rule for the same quantity and dates.
    await seller.client
      .post(`/api/v1/products/${product.id}/customer-prices`)
      .send({ customerEmail: buyer.email, unitPrice: '400.00', minQuantity: 5 })
      .expect(409);
    // Only customer accounts.
    await seller.client
      .post(`/api/v1/products/${product.id}/customer-prices`)
      .send({ customerEmail: seller.owner.email, unitPrice: '400.00' })
      .expect(422);
    await seller.client
      .delete(`/api/v1/products/${product.id}/customer-prices/${list.items[0]!.id}`)
      .expect(200);
    expect((await line(client, 5)).unitPrice).toBe('500.00');
  });

  it('previews prices for the seller', async () => {
    const preview = priceQuoteLineSchema.parse(
      (
        await seller.client
          .post(`/api/v1/products/${product.id}/price-preview`)
          .send({ variantId, quantity: 50, buyer: 'WHOLESALE' })
          .expect(201)
      ).body,
    );
    expect(preview.unitPrice).toBe('420.00');
  });

  it('only quotes products shoppers can buy', async () => {
    const draftSeller = await testSeller(app);
    const draft = await draftSeller.client
      .post('/api/v1/products')
      .send({
        storeId: draftSeller.storeId,
        categoryId: product.category.id,
        name: 'Draft item',
        sku: 'DRAFT-1',
        regularPrice: '5.00',
      })
      .expect(201);
    const draftVariant = productDetailSchema.parse(draft.body).variants[0]!.id;
    await quote(guest, 1, draftVariant).expect(422);
  });

  it('shows shoppers prices for who they are on the product page', async () => {
    const asGuest = storefrontProductSchema.parse(
      (await guest.get(`/api/v1/catalog/products/${product.id}`).expect(200)).body,
    );
    expect(asGuest.prices[0]).toMatchObject({ unitPrice: '500.00', tiers: [] });
    const asWholesale = storefrontProductSchema.parse(
      (await wholesale.get(`/api/v1/catalog/products/${product.id}`).expect(200)).body,
    );
    expect(asWholesale.prices[0]!.tiers.map((t) => t.unitPrice)).toEqual([
      '500.00',
      '450.00',
      '420.00',
      '390.00',
    ]);
  });

  it('lets only seller.pricing.manage change prices', async () => {
    const inventory = (await testEmployee(app, seller.sellerId, 'SELLER_INVENTORY')).client;
    await inventory
      .put(`/api/v1/products/${product.id}/price-tiers`)
      .send({ tiers: [] })
      .expect(403);
    await inventory
      .put(`/api/v1/products/${product.id}/pricing`)
      .send({ minOrderQuantity: 1, wholesaleEnabled: false, wholesaleMinOrderQuantity: 1 })
      .expect(403);
  });
});
