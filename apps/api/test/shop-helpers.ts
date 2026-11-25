import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { UserRole } from '@marketplace/shared-types';
import {
  checkoutQuoteSchema,
  customerAddressSchema,
  type CheckoutQuote,
  type CheckoutRequest,
} from '@marketplace/validation';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, type TestClient } from './auth-helpers';
import { approvedProduct, testSeller, type TestSeller, unique } from './catalog-helpers';

/** PSGC codes of a barangay (the locations are imported by the seed). */
export async function place(app: INestApplication, barangay: string, city: string) {
  const row = await app.get(PrismaService).phLocation.findFirst({
    where: {
      level: 'BARANGAY',
      name: barangay,
      parent: { OR: [{ name: city }, { parent: { name: city } }] },
    },
  });
  if (!row?.cityCode) throw new Error(`No location ${barangay}, ${city}: run the seed first`);
  return {
    regionCode: row.regionCode,
    provinceCode: row.provinceCode,
    cityCode: row.cityCode,
    barangayCode: row.code,
  };
}

export const PLACES = {
  quezonCity: ['Bagong Pag-asa', 'Quezon City'],
  cebuCity: ['Lahug', 'City of Cebu'],
  davaoCity: ['Barangay 1-A', 'City of Davao'],
} as const;

export interface ShopSeller extends TestSeller {
  warehouseId: string;
}

/** A verified seller with a store and a default warehouse located in a real barangay. */
export async function shopSeller(
  app: INestApplication,
  at: readonly [string, string] = PLACES.cebuCity,
): Promise<ShopSeller> {
  const seller = await testSeller(app);
  const location = await place(app, at[0], at[1]);
  const res = await seller.client
    .post('/api/v1/inventory/warehouses')
    .send({
      name: 'Main',
      code: 'MAIN',
      addressLine1: '1 Test Street',
      city: at[1],
      province: 'Test',
      location,
    })
    .expect(201);
  const warehouse = (
    res.body as { warehouses: { id: string; isDefault: boolean }[] }
  ).warehouses.find((w) => w.isDefault)!;
  return { ...seller, warehouseId: warehouse.id };
}

export interface Listed {
  productId: string;
  variantId: string;
  sku: string;
}

/**
 * An approved product with one variant at `price`, with weight and size, and `stock` units in
 * the seller's default warehouse.
 */
export async function listed(
  seller: ShopSeller,
  admin: TestClient,
  categoryId: string,
  options: {
    name?: string;
    price?: string;
    stock?: number;
    weightGrams?: number;
    dims?: [string, string, string];
    overrides?: Record<string, unknown>;
  } = {},
): Promise<Listed> {
  const sku = unique('SKU').toUpperCase();
  const product = await approvedProduct(seller, admin, categoryId, {
    name: options.name ?? `Test product ${unique('p')}`,
    sku,
    regularPrice: options.price ?? '500.00',
    ...options.overrides,
  });
  const variantId = product.variants[0]!.id;
  const [l, w, h] = options.dims ?? ['20', '15', '10'];
  await seller.client
    .patch(`/api/v1/products/${product.id}/variants/${variantId}`)
    .send({ weightGrams: options.weightGrams ?? 1000, lengthCm: l, widthCm: w, heightCm: h })
    .expect(200);
  if ((options.stock ?? 50) > 0) {
    await seller.client
      .post('/api/v1/inventory/movements')
      .send({
        warehouseId: seller.warehouseId,
        variantId,
        type: 'STOCK_IN',
        quantity: options.stock ?? 50,
      })
      .expect(201);
  }
  return { productId: product.id, variantId, sku };
}

export interface Shopper {
  client: TestClient;
  userId: string;
  addressId: string;
}

/** A signed-in storefront customer with a default address in Quezon City. */
export async function shopper(
  app: INestApplication,
  roles: UserRole[] = ['CUSTOMER'],
  at: readonly [string, string] = PLACES.quezonCity,
): Promise<Shopper> {
  const { client, user } = await signedInClient(app, 'storefront', roles, 'shopper');
  const res = await client
    .post('/api/v1/account/addresses')
    .send({
      recipientName: 'Juan Dela Cruz',
      mobile: '0917 123 4567',
      ...(await place(app, at[0], at[1])),
      postalCode: '1105',
      streetAddress: '45 Kalayaan Street',
    })
    .expect(201);
  return { client, userId: user.id, addressId: customerAddressSchema.parse(res.body).id };
}

export async function quote(
  client: TestClient,
  body: CheckoutRequest = {},
): Promise<CheckoutQuote> {
  const res = await client.post('/api/v1/checkout/quote').send(body);
  if (res.status !== 200)
    throw new Error(`Quote failed ${res.status}: ${JSON.stringify(res.body)}`);
  return checkoutQuoteSchema.parse(res.body);
}

/** Places an order for exactly what the quote says (the normal checkout flow). */
export async function placeOrder(
  client: TestClient,
  body: CheckoutRequest & { addressId: string; paymentMethod?: string },
  key = randomUUID(),
) {
  const q = await quote(client, body);
  return client
    .post('/api/v1/checkout/orders')
    .set('Idempotency-Key', key)
    .send({ paymentMethod: 'COD', ...body, expectedGrandTotal: q.totals.grandTotal });
}
