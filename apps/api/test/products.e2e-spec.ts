import type { NestExpressApplication } from '@nestjs/platform-express';
import { EMAIL_JOBS } from '@marketplace/config';
import {
  apiErrorBodySchema,
  productDetailSchema,
  productListSchema,
  type ProductDetail,
} from '@marketplace/validation';
import sharp from 'sharp';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { findJob, signedInClient, TestClient } from './auth-helpers';
import {
  approvedProduct,
  createProduct,
  image,
  readyProduct,
  testCategory,
  testEmployee,
  testSeller,
  type TestSeller,
  unique,
} from './catalog-helpers';
import { PNG } from './fixtures';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const detail = (res: Response) => productDetailSchema.parse(res.body);

/** Products: ownership, creation, variants, photos and the approval workflow. */
describe('Products (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'product-admin')).client;
    categoryId = (await testCategory(app)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('creation', () => {
    it('creates a draft with one default variant', async () => {
      const seller = await testSeller(app);
      const product = await createProduct(seller, categoryId);
      expect(product).toMatchObject({
        status: 'DRAFT',
        sellerId: seller.sellerId,
        slug: 'sinandomeng-rice-25-kg',
        variantCount: 1,
        priceRange: { min: '500.00', max: '500.00' },
      });
      expect(product.variants[0]).toMatchObject({
        title: 'Default',
        options: {},
        regularPrice: '500.00',
      });
      expect(product.missingForSubmission).toContain('Add at least one photo');
      // A second product with the same name gets the next free link.
      const again = await createProduct(seller, categoryId);
      expect(again.slug).toBe('sinandomeng-rice-25-kg-2');
    });

    it('keeps SKUs unique per seller, not across sellers', async () => {
      const a = await testSeller(app);
      const b = await testSeller(app);
      const sku = unique('SHARED').toUpperCase();
      await createProduct(a, categoryId, { sku });
      const dup = await a.client
        .post('/api/v1/products')
        .send({ storeId: a.storeId, categoryId, name: 'Other', sku, regularPrice: '10.00' })
        .expect(409);
      expect(apiErrorBodySchema.parse(dup.body).error.fieldErrors?.[0]?.path).toBe('sku');
      await createProduct(b, categoryId, { sku });
    });

    it('validates category attributes', async () => {
      const seller = await testSeller(app);
      const base = {
        storeId: seller.storeId,
        categoryId,
        name: 'Rice',
        sku: unique('S'),
        regularPrice: '1.00',
      };
      await seller.client
        .post('/api/v1/products')
        .send({ ...base, attributeValues: { net_weight: 'heavy' } })
        .expect(422);
      await seller.client
        .post('/api/v1/products')
        .send({ ...base, attributeValues: { variety: 'Z' } })
        .expect(422);
      await seller.client
        .post('/api/v1/products')
        .send({ ...base, attributeValues: { unknown_code: 1 } })
        .expect(422);
    });

    it('refuses sellers that are not verified, and other sellers’ stores', async () => {
      const pending = await testSeller(app, 'PENDING');
      const res = await pending.client
        .post('/api/v1/products')
        .send({
          storeId: pending.storeId,
          categoryId,
          name: 'Rice',
          sku: 'X1',
          regularPrice: '1.00',
        })
        .expect(403);
      expect(errorCode(res)).toBe('SELLER_NOT_VERIFIED');
      const a = await testSeller(app);
      const b = await testSeller(app);
      await a.client
        .post('/api/v1/products')
        .send({ storeId: b.storeId, categoryId, name: 'Rice', sku: 'X2', regularPrice: '1.00' })
        .expect(422);
    });
  });

  describe('seller ownership isolation', () => {
    let a: TestSeller;
    let b: TestSeller;
    let product: ProductDetail;

    beforeAll(async () => {
      a = await testSeller(app);
      b = await testSeller(app);
      product = await readyProduct(a, categoryId);
    });

    it('lists only my own products', async () => {
      const list = productListSchema.parse(
        (await b.client.get('/api/v1/products/mine?pageSize=100').expect(200)).body,
      );
      expect(list.items.map((p) => p.id)).not.toContain(product.id);
      const mine = productListSchema.parse(
        (await a.client.get('/api/v1/products/mine?pageSize=100').expect(200)).body,
      );
      expect(mine.items.map((p) => p.id)).toContain(product.id);
    });

    it.each([
      ['GET', ''],
      ['PATCH', ''],
      ['PUT', '/options'],
      ['PATCH', '/variants/VARIANT'],
      ['POST', '/submit'],
      ['POST', '/archive'],
      ['POST', '/images'],
      ['DELETE', '/images/IMAGE'],
      ['PUT', '/pricing'],
      ['PUT', '/price-tiers'],
      ['GET', '/customer-prices'],
      ['POST', '/price-preview'],
    ])('answers 404 to another seller: %s /products/:id%s', async (method, suffix) => {
      const path = `/api/v1/products/${product.id}${suffix
        .replace('VARIANT', product.variants[0]!.id)
        .replace('IMAGE', product.images[0]!.id)}`;
      const bodies: Record<string, object> = {
        PATCH: suffix ? { barcode: '1234' } : { name: 'Hijacked' },
        PUT:
          suffix === '/options'
            ? { options: [], generate: { skuPrefix: 'X', regularPrice: '1.00' } }
            : suffix === '/pricing'
              ? { minOrderQuantity: 1, wholesaleEnabled: true, wholesaleMinOrderQuantity: 1 }
              : { tiers: [] },
        POST:
          suffix === '/price-preview'
            ? { variantId: product.variants[0]!.id, quantity: 1, buyer: 'RETAIL' }
            : {},
      };
      const call =
        b.client[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path);
      const res = await (method === 'GET' || method === 'DELETE'
        ? call
        : suffix === '/images'
          ? call.attach('file', await image(300, 300), 'x.jpg')
          : call.send(bodies[method]));
      expect(res.status).toBe(404);
      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(unchanged.name).toBe(product.name);
    });

    it('lets staff with catalog.products.read see any product', async () => {
      const seen = detail(await admin.get(`/api/v1/products/${product.id}`).expect(200));
      expect(seen.sellerId).toBe(a.sellerId);
    });
  });

  describe('variant generation', () => {
    it('creates one variant per combination, with generated SKUs and titles', async () => {
      const seller = await testSeller(app);
      const product = await createProduct(seller, categoryId);
      const res = await seller.client
        .put(`/api/v1/products/${product.id}/options`)
        .send({
          options: [
            { name: 'Size', values: ['S', 'M', 'L'] },
            { name: 'Color', values: ['Red', 'Navy Blue'] },
          ],
          generate: { skuPrefix: 'TEE', regularPrice: '299.00' },
        })
        .expect(200);
      const generated = detail(res);
      expect(generated.variants).toHaveLength(6);
      expect(generated.variants.map((v) => v.sku).sort()).toEqual([
        'TEE-L-NAVY-BLUE',
        'TEE-L-RED',
        'TEE-M-NAVY-BLUE',
        'TEE-M-RED',
        'TEE-S-NAVY-BLUE',
        'TEE-S-RED',
      ]);
      expect(generated.variants.find((v) => v.sku === 'TEE-M-RED')).toMatchObject({
        title: 'M / Red',
        options: { Size: 'M', Color: 'Red' },
        regularPrice: '299.00',
      });
      // The default variant (no options) was removed.
      expect(generated.variants.some((v) => v.title === 'Default')).toBe(false);

      // Adding a value adds only the missing combinations; existing variants keep their ids.
      const before = new Map(generated.variants.map((v) => [v.sku, v.id]));
      const more = detail(
        await seller.client
          .put(`/api/v1/products/${product.id}/options`)
          .send({
            options: [
              { name: 'Size', values: ['S', 'M', 'L', 'XL'] },
              { name: 'Color', values: ['Red', 'Navy Blue'] },
            ],
            generate: { skuPrefix: 'TEE', regularPrice: '349.00' },
          })
          .expect(200),
      );
      expect(more.variants).toHaveLength(8);
      expect(more.variants.find((v) => v.sku === 'TEE-S-RED')?.id).toBe(before.get('TEE-S-RED'));
      expect(more.variants.find((v) => v.sku === 'TEE-XL-RED')?.regularPrice).toBe('349.00');
    });

    it('refuses to remove a combination that has stock history', async () => {
      const seller = await testSeller(app);
      const product = await createProduct(seller, categoryId);
      const withOptions = detail(
        await seller.client
          .put(`/api/v1/products/${product.id}/options`)
          .send({
            options: [{ name: 'Size', values: ['S', 'M'] }],
            generate: { skuPrefix: unique('P'), regularPrice: '10.00' },
          })
          .expect(200),
      );
      const small = withOptions.variants.find((v) => v.title === 'S')!;
      const warehouse = await prisma.warehouse.create({
        data: {
          sellerId: seller.sellerId,
          name: 'Main',
          code: 'MAIN',
          addressLine1: '1 St',
          city: 'Pasig',
          province: 'Metro Manila',
        },
      });
      await seller.client
        .post('/api/v1/inventory/movements')
        .send({ warehouseId: warehouse.id, variantId: small.id, type: 'STOCK_IN', quantity: 5 })
        .expect(201);
      const res = await seller.client
        .put(`/api/v1/products/${product.id}/options`)
        .send({
          options: [{ name: 'Size', values: ['M'] }],
          generate: { skuPrefix: 'P', regularPrice: '10.00' },
        })
        .expect(409);
      expect(apiErrorBodySchema.parse(res.body).error.message).toContain(small.sku);
    });

    it('limits the number of combinations', async () => {
      const seller = await testSeller(app);
      const product = await createProduct(seller, categoryId);
      const values = (n: number) => Array.from({ length: n }, (_, i) => `V${i}`);
      await seller.client
        .put(`/api/v1/products/${product.id}/options`)
        .send({
          options: [
            { name: 'A', values: values(5) },
            { name: 'B', values: values(5) },
            { name: 'C', values: values(5) },
          ],
          generate: { skuPrefix: 'X', regularPrice: '1.00' },
        })
        .expect(422);
    });
  });

  describe('photos', () => {
    let seller: TestSeller;
    let product: ProductDetail;

    beforeAll(async () => {
      seller = await testSeller(app);
      product = await createProduct(seller, categoryId);
    });

    const upload = (buffer: Buffer, name: string) =>
      seller.client.post(`/api/v1/products/${product.id}/images`).attach('file', buffer, name);

    it('stores an optimised WebP and a thumbnail, without enlarging or keeping metadata', async () => {
      const big = await sharp({
        create: { width: 3200, height: 2400, channels: 3, background: '#336699' },
      })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } })
        .toBuffer();
      const res = detail(await upload(big, 'photo.JPG').expect(201));
      const photo = res.images[0]!;
      expect(photo).toMatchObject({ width: 1600, height: 1200, position: 0 });
      const guest = new TestClient(app.getHttpServer(), 'storefront');
      const large = await guest.get(photo.url).buffer(true).expect(200);
      expect(large.headers['content-type']).toBe('image/webp');
      expect(large.headers['cache-control']).toContain('immutable');
      const meta = await sharp(large.body as Buffer).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 1200 });
      expect(meta.exif).toBeUndefined();
      const thumb = await guest.get(photo.thumbnailUrl).buffer(true).expect(200);
      expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(400);
    });

    it('rejects wrong extensions, fake images, small images and oversized files', async () => {
      expect(errorCode(await upload(await image(400, 400, 'png'), 'photo.gif').expect(415))).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
      expect(errorCode(await upload(await image(400, 400, 'png'), 'photo.jpg').expect(415))).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
      expect(
        errorCode(await upload(Buffer.from('<?php echo 1; ?>'), 'shell.php.jpg').expect(415)),
      ).toBe('UNSUPPORTED_MEDIA_TYPE');
      // Right magic bytes, but not a decodable image.
      expect(errorCode(await upload(PNG, 'broken.png').expect(415))).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(errorCode(await upload(await image(150, 400), 'tiny.jpg').expect(422))).toBe(
        'VALIDATION_FAILED',
      );
      expect(
        errorCode(await upload(Buffer.alloc(6 * 1024 * 1024, 1), 'huge.jpg').expect(413)),
      ).toBe('PAYLOAD_TOO_LARGE');
    });

    it('reorders, replaces and deletes photos', async () => {
      await upload(await image(500, 500), 'second.jpg').expect(201);
      const three = detail(await upload(await image(500, 500, 'webp'), 'third.webp').expect(201));
      const ids = three.images.map((i) => i.id);
      const reordered = detail(
        await seller.client
          .put(`/api/v1/products/${product.id}/images/order`)
          .send({ imageIds: [ids[2], ids[0], ids[1]] })
          .expect(200),
      );
      expect(reordered.images.map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
      expect(reordered.thumbnailUrl).toContain(ids[2]);
      // Must list each photo exactly once.
      await seller.client
        .put(`/api/v1/products/${product.id}/images/order`)
        .send({ imageIds: [ids[0]] })
        .expect(422);

      const oldFile = reordered.images[0]!.url;
      const replaced = detail(
        await seller.client
          .put(`/api/v1/products/${product.id}/images/${ids[2]}/file`)
          .attach('file', await image(800, 600), 'new.jpg')
          .expect(200),
      );
      expect(replaced.images[0]).toMatchObject({ id: ids[2], width: 800, height: 600 });
      expect(replaced.images[0]!.url).not.toBe(oldFile);

      const removed = detail(
        await seller.client.delete(`/api/v1/products/${product.id}/images/${ids[0]}`).expect(200),
      );
      expect(removed.images.map((i) => [i.id, i.position])).toEqual([
        [ids[2], 0],
        [ids[1], 1],
      ]);
      const files = await prisma.storedFile.count({
        where: {
          purpose: 'PRODUCT_IMAGE',
          status: 'AVAILABLE',
          productImage: { productId: product.id },
        },
      });
      expect(files).toBe(2);
    });

    it('allows at most 10 photos', async () => {
      const other = await createProduct(seller, categoryId);
      const small = await image(250, 250);
      for (let i = 0; i < 10; i++) {
        await seller.client
          .post(`/api/v1/products/${other.id}/images`)
          .attach('file', small, `p${i}.jpg`)
          .expect(201);
      }
      await seller.client
        .post(`/api/v1/products/${other.id}/images`)
        .attach('file', small, 'p11.jpg')
        .expect(409);
    });
  });

  describe('approval', () => {
    it('submits, approves and emails the seller; the product becomes public', async () => {
      const seller = await testSeller(app);
      const draft = await createProduct(seller, categoryId);
      const notReady = await seller.client.post(`/api/v1/products/${draft.id}/submit`).expect(422);
      expect(errorCode(notReady)).toBe('NOT_READY');

      const product = await readyProduct(seller, categoryId);
      const submitted = detail(
        await seller.client.post(`/api/v1/products/${product.id}/submit`).expect(201),
      );
      expect(submitted.status).toBe('PENDING_APPROVAL');
      const queue = productListSchema.parse(
        (await admin.get('/api/v1/products?status=PENDING_APPROVAL&pageSize=100').expect(200)).body,
      );
      expect(queue.items.map((p) => p.id)).toContain(product.id);

      // Not yet visible to shoppers.
      const guest = new TestClient(app.getHttpServer(), 'storefront');
      await guest.get(`/api/v1/catalog/products/${product.id}`).expect(404);

      const approved = detail(
        await admin
          .post(`/api/v1/products/${product.id}/review`)
          .send({ decision: 'APPROVE' })
          .expect(201),
      );
      expect(approved).toMatchObject({ status: 'ACTIVE' });
      expect(approved.approvedAt).not.toBeNull();
      const job = await findJob<{ productName: string; decision: string }>(
        app,
        'email',
        (data, j) =>
          j.name === EMAIL_JOBS.PRODUCT_DECISION &&
          data.productName === product.name &&
          data.decision === 'APPROVED',
      );
      expect(job).toBeDefined();
      await guest.get(`/api/v1/catalog/products/${product.id}`).expect(200);
      // A decision is made once.
      await admin
        .post(`/api/v1/products/${product.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(409);
    });

    it('requires a note to reject; the seller fixes and resubmits', async () => {
      const seller = await testSeller(app);
      const product = await readyProduct(seller, categoryId);
      await seller.client.post(`/api/v1/products/${product.id}/submit`).expect(201);
      await admin
        .post(`/api/v1/products/${product.id}/review`)
        .send({ decision: 'REJECT' })
        .expect(400);
      const rejected = detail(
        await admin
          .post(`/api/v1/products/${product.id}/review`)
          .send({ decision: 'REJECT', note: 'The photo shows a different product.' })
          .expect(201),
      );
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        reviewNote: 'The photo shows a different product.',
      });
      const sellerView = detail(
        await seller.client.get(`/api/v1/products/${product.id}`).expect(200),
      );
      expect(sellerView.events.find((e) => e.type === 'REJECTED')?.actor).toBe('Marketplace team');
      await seller.client.post(`/api/v1/products/${product.id}/submit`).expect(201);
    });

    it('sends an approved product back to review after a content change, but not after a price change', async () => {
      const seller = await testSeller(app);
      const product = await approvedProduct(seller, admin, categoryId);
      const variantId = product.variants[0]!.id;
      const priced = detail(
        await seller.client
          .patch(`/api/v1/products/${product.id}/variants/${variantId}`)
          .send({ regularPrice: '520.00', salePrice: '499.00' })
          .expect(200),
      );
      expect(priced.status).toBe('ACTIVE');
      const edited = detail(
        await seller.client
          .patch(`/api/v1/products/${product.id}`)
          .send({ name: 'Premium Sinandomeng Rice 25 kg' })
          .expect(200),
      );
      expect(edited.status).toBe('PENDING_APPROVAL');
      expect(edited.events[0]?.type).toBe('CHANGED_AFTER_APPROVAL');
      // Saving the same content again is not a change.
      const resaved = detail(
        await seller.client
          .patch(`/api/v1/products/${product.id}`)
          .send({ seoTitle: 'Rice' })
          .expect(200),
      );
      expect(resaved.events.filter((e) => e.type === 'CHANGED_AFTER_APPROVAL')).toHaveLength(1);
    });

    it('takes a product down; the seller cannot simply reactivate it', async () => {
      const seller = await testSeller(app);
      const product = await approvedProduct(seller, admin, categoryId);
      const down = detail(
        await admin
          .post(`/api/v1/products/${product.id}/take-down`)
          .send({ reason: 'Counterfeit listing reported' })
          .expect(201),
      );
      expect(down).toMatchObject({ status: 'INACTIVE', takenDown: true });
      expect(
        errorCode(await seller.client.post(`/api/v1/products/${product.id}/activate`).expect(409)),
      ).toBe('CONFLICT');
      // A seller-hidden product can come back without review.
      const other = await approvedProduct(seller, admin, categoryId);
      await seller.client.post(`/api/v1/products/${other.id}/deactivate`).expect(201);
      expect(
        detail(await seller.client.post(`/api/v1/products/${other.id}/activate`).expect(201))
          .status,
      ).toBe('ACTIVE');
    });

    it('does not approve a product whose brand request is still pending', async () => {
      const seller = await testSeller(app);
      const brand = await seller.client
        .post('/api/v1/brands/requests')
        .send({ name: unique('New Brand') })
        .expect(201);
      const product = await readyProduct(seller, categoryId, {
        brandId: (brand.body as { id: string }).id,
      });
      await seller.client.post(`/api/v1/products/${product.id}/submit`).expect(201);
      const res = await admin
        .post(`/api/v1/products/${product.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(409);
      expect(apiErrorBodySchema.parse(res.body).error.message).toContain('brand');
    });

    it('archives and restores as a draft', async () => {
      const seller = await testSeller(app);
      const product = await approvedProduct(seller, admin, categoryId);
      expect(
        detail(await seller.client.post(`/api/v1/products/${product.id}/archive`).expect(201))
          .status,
      ).toBe('ARCHIVED');
      await seller.client
        .patch(`/api/v1/products/${product.id}`)
        .send({ name: 'Edit archived' })
        .expect(409);
      expect(
        detail(await seller.client.post(`/api/v1/products/${product.id}/restore`).expect(201))
          .status,
      ).toBe('DRAFT');
    });
  });

  describe('permissions', () => {
    it('lets an encoder edit products but not prices; inventory staff neither', async () => {
      const seller = await testSeller(app);
      const product = await createProduct(seller, categoryId);
      const variantId = product.variants[0]!.id;
      const encoder = (await testEmployee(app, seller.sellerId, 'SELLER_ENCODER')).client;
      await encoder
        .patch(`/api/v1/products/${product.id}`)
        .send({ description: 'Updated by the encoder, long enough text.' })
        .expect(200);
      await encoder
        .patch(`/api/v1/products/${product.id}/variants/${variantId}`)
        .send({ barcode: '4800016123456' })
        .expect(200);
      const price = await encoder
        .patch(`/api/v1/products/${product.id}/variants/${variantId}`)
        .send({ regularPrice: '1.00' })
        .expect(403);
      expect(errorCode(price)).toBe('FORBIDDEN');
      await encoder
        .put(`/api/v1/products/${product.id}/price-tiers`)
        .send({ tiers: [] })
        .expect(403);

      const stock = (await testEmployee(app, seller.sellerId, 'SELLER_INVENTORY')).client;
      await stock.patch(`/api/v1/products/${product.id}`).send({ name: 'No' }).expect(403);
      // Everyone in the seller can read.
      await stock.get(`/api/v1/products/${product.id}`).expect(200);
    });

    it('lets only reviewers approve', async () => {
      const seller = await testSeller(app);
      const product = await readyProduct(seller, categoryId);
      await seller.client.post(`/api/v1/products/${product.id}/submit`).expect(201);
      const support = (await signedInClient(app, 'admin', ['CUSTOMER_SUPPORT'], 'support')).client;
      await support.get(`/api/v1/products/${product.id}`).expect(200);
      await support
        .post(`/api/v1/products/${product.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(403);
      await seller.client
        .post(`/api/v1/products/${product.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(403);
    });
  });
});
