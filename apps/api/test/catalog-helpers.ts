import type { INestApplication } from '@nestjs/common';
import type { UserRole } from '@marketplace/shared-types';
import { productDetailSchema, type ProductDetail } from '@marketplace/validation';
import sharp from 'sharp';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createUser, TestClient, type TestUser } from './auth-helpers';

export const unique = (label: string) =>
  `${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** A real image of the given size and format (decodable by the image pipeline). */
export function image(width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    [format]()
    .toBuffer();
}

/** An active leaf category with one required attribute (created directly in the database). */
export async function testCategory(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const parent = await prisma.category.create({
    data: { name: 'Test Parent', slug: unique('parent'), depth: 0 },
  });
  return prisma.category.create({
    data: {
      name: 'Test Leaf',
      slug: unique('leaf'),
      parentId: parent.id,
      depth: 1,
      attributes: {
        create: [
          { code: 'net_weight', name: 'Net weight', type: 'NUMBER', unit: 'kg', isRequired: true },
          { code: 'variety', name: 'Variety', type: 'SELECT', options: ['A', 'B'] },
        ],
      },
    },
  });
}

export interface TestSeller {
  owner: TestUser;
  client: TestClient;
  sellerId: string;
  storeId: string;
}

/** A verified seller with one open store, signed in to the Seller Center as the owner. */
export async function testSeller(
  app: INestApplication,
  status: 'VERIFIED' | 'PENDING' | 'SUSPENDED' = 'VERIFIED',
): Promise<TestSeller> {
  const prisma = app.get(PrismaService);
  const owner = await createUser(app, { roles: ['SELLER_OWNER'], sellerStatus: status });
  const store = await prisma.store.create({
    data: { sellerId: owner.sellerId!, name: 'Test Store', slug: unique('store') },
  });
  const client = await new TestClient(app.getHttpServer(), 'seller').init();
  await client.signIn(owner.email);
  return { owner, client, sellerId: owner.sellerId!, storeId: store.id };
}

/** An employee of an existing seller, signed in, with the given role. */
export async function testEmployee(app: INestApplication, sellerId: string, role: UserRole) {
  const user = await createUser(app, { roles: [role], sellerId });
  const client = await new TestClient(app.getHttpServer(), 'seller').init();
  await client.signIn(user.email);
  return { user, client };
}

export async function createProduct(
  seller: TestSeller,
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Promise<ProductDetail> {
  const res = await seller.client.post('/api/v1/products').send({
    storeId: seller.storeId,
    categoryId,
    name: 'Sinandomeng Rice 25 kg',
    description: 'Well-milled rice from Nueva Ecija, soft and fragrant when cooked.',
    attributeValues: { net_weight: 25 },
    sku: unique('SKU').toUpperCase(),
    regularPrice: '500.00',
    ...overrides,
  });
  if (res.status !== 201)
    throw new Error(`Create product failed ${res.status}: ${JSON.stringify(res.body)}`);
  return productDetailSchema.parse(res.body);
}

/** A product ready for review: description, attributes and one photo. */
export async function readyProduct(
  seller: TestSeller,
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
  const product = await createProduct(seller, categoryId, overrides);
  const res = await seller.client
    .post(`/api/v1/products/${product.id}/images`)
    .attach('file', await image(600, 400), 'photo.jpg');
  if (res.status !== 201)
    throw new Error(`Upload failed ${res.status}: ${JSON.stringify(res.body)}`);
  return productDetailSchema.parse(res.body);
}

/** Submits and approves a product (as the given admin client). */
export async function approvedProduct(
  seller: TestSeller,
  admin: TestClient,
  categoryId: string,
  overrides: Record<string, unknown> = {},
) {
  const product = await readyProduct(seller, categoryId, overrides);
  await seller.client.post(`/api/v1/products/${product.id}/submit`).expect(201);
  const res = await admin
    .post(`/api/v1/products/${product.id}/review`)
    .send({ decision: 'APPROVE' })
    .expect(201);
  return productDetailSchema.parse(res.body);
}
