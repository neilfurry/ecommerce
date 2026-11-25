import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  brandListSchema,
  brandSchema,
  categoryAttributesSchema,
  categoryListSchema,
  categorySchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, TestClient } from './auth-helpers';
import { image, testSeller, unique } from './catalog-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

/** Categories and brands: staff-managed global lists, brand requests from sellers. */
describe('Categories and brands (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'catalog-admin')).client;
  });

  afterAll(async () => {
    await app.close();
  });

  async function category(body: Record<string, unknown>) {
    const res = await admin.post('/api/v1/categories').send(body).expect(201);
    return categorySchema.parse(res.body);
  }

  it('builds a three-level tree and refuses a fourth level', async () => {
    const top = await category({ name: unique('Home') });
    const mid = await category({ name: 'Kitchen', slug: unique('kitchen'), parentId: top.id });
    const leaf = await category({ name: 'Cookware', slug: unique('cookware'), parentId: mid.id });
    expect(leaf).toMatchObject({ depth: 2, path: [top.name, 'Kitchen', 'Cookware'] });
    const res = await admin
      .post('/api/v1/categories')
      .send({ name: 'Too deep', slug: unique('deep'), parentId: leaf.id })
      .expect(422);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
    const parent = categorySchema.parse(
      (await admin.get(`/api/v1/categories/${mid.id}`).expect(200)).body,
    );
    expect(parent.childCount).toBe(1);
  });

  it('inherits attributes from parent categories and refuses duplicate codes', async () => {
    const top = await category({ name: unique('Phones') });
    const leaf = await category({ name: 'Smartphones', slug: unique('smart'), parentId: top.id });
    await admin
      .put(`/api/v1/categories/${top.id}/attributes`)
      .send({ attributes: [{ code: 'brand_warranty', name: 'Warranty', type: 'TEXT' }] })
      .expect(200);
    await admin
      .put(`/api/v1/categories/${leaf.id}/attributes`)
      .send({
        attributes: [
          {
            code: 'storage',
            name: 'Storage',
            type: 'SELECT',
            options: ['64 GB', '128 GB'],
            isRequired: true,
          },
        ],
      })
      .expect(200);
    const effective = categoryAttributesSchema.parse((await request(leaf.id)).body);
    expect(effective.attributes.map((a) => a.code)).toEqual(['brand_warranty', 'storage']);

    const clash = await admin
      .put(`/api/v1/categories/${leaf.id}/attributes`)
      .send({ attributes: [{ code: 'brand_warranty', name: 'Again', type: 'TEXT' }] })
      .expect(422);
    expect(apiErrorBodySchema.parse(clash.body).error.message).toContain('parent');
    const badSelect = await admin
      .put(`/api/v1/categories/${leaf.id}/attributes`)
      .send({ attributes: [{ code: 'colour', name: 'Colour', type: 'SELECT', options: ['Red'] }] })
      .expect(400);
    expect(errorCode(badSelect)).toBe('VALIDATION_FAILED');

    function request(id: string) {
      return new TestClient(app.getHttpServer(), 'storefront')
        .get(`/api/v1/categories/${id}/attributes`)
        .expect(200);
    }
  });

  it('shows shoppers only active categories under active parents', async () => {
    const top = await category({ name: unique('Seasonal') });
    const child = await category({
      name: 'Christmas',
      slug: unique('christmas'),
      parentId: top.id,
    });
    await admin.patch(`/api/v1/categories/${top.id}`).send({ status: 'INACTIVE' }).expect(200);
    const guest = new TestClient(app.getHttpServer(), 'storefront');
    const publicIds = categoryListSchema
      .parse((await guest.get('/api/v1/categories').expect(200)).body)
      .categories.map((c) => c.id);
    expect(publicIds).not.toContain(top.id);
    expect(publicIds).not.toContain(child.id);
    const allIds = categoryListSchema
      .parse((await admin.get('/api/v1/categories/all').expect(200)).body)
      .categories.map((c) => c.id);
    expect(allIds).toEqual(expect.arrayContaining([top.id, child.id]));
  });

  it('lets only staff with catalog.categories.manage change categories', async () => {
    const support = (await signedInClient(app, 'admin', ['CUSTOMER_SUPPORT'], 'support')).client;
    expect(
      errorCode(await support.post('/api/v1/categories').send({ name: 'Nope' }).expect(403)),
    ).toBe('FORBIDDEN');
    const seller = await testSeller(app);
    await seller.client.post('/api/v1/categories').send({ name: 'Nope' }).expect(403);
  });

  it('deletes only empty categories, and stores images as WebP', async () => {
    const top = await category({ name: unique('Toys') });
    const child = await category({ name: 'Puzzles', slug: unique('puzzles'), parentId: top.id });
    expect(errorCode(await admin.delete(`/api/v1/categories/${top.id}`).expect(409))).toBe(
      'CONFLICT',
    );

    const withImage = categorySchema.parse(
      (
        await admin
          .put(`/api/v1/categories/${child.id}/image`)
          .attach('file', await image(500, 500, 'png'), 'puzzles.png')
          .expect(200)
      ).body,
    );
    expect(withImage.imageUrl).toMatch(new RegExp(`/categories/${child.id}/image\\?v=`));
    const served = await new TestClient(app.getHttpServer(), 'storefront')
      .get(withImage.imageUrl!)
      .expect(200);
    expect(served.headers['content-type']).toBe('image/webp');

    await admin.delete(`/api/v1/categories/${child.id}`).expect(204);
    await admin.delete(`/api/v1/categories/${top.id}`).expect(204);
    expect(await prisma.category.count({ where: { id: { in: [top.id, child.id] } } })).toBe(0);
  });

  it('refuses a duplicate category link', async () => {
    const slug = unique('dup');
    await category({ name: 'One', slug });
    expect(
      errorCode(await admin.post('/api/v1/categories').send({ name: 'Two', slug }).expect(409)),
    ).toBe('CONFLICT');
  });

  describe('brands', () => {
    it('staff create active brands; duplicates are refused', async () => {
      const name = unique('Acme Foods');
      const brand = brandSchema.parse(
        (await admin.post('/api/v1/brands').send({ name }).expect(201)).body,
      );
      expect(brand.status).toBe('ACTIVE');
      const dup = await admin.post('/api/v1/brands').send({ name: name.toUpperCase() }).expect(409);
      expect(errorCode(dup)).toBe('CONFLICT');
    });

    it('sellers request brands; staff approve or reject them; sellers see only their own requests', async () => {
      const a = await testSeller(app);
      const b = await testSeller(app);
      const requested = brandSchema.parse(
        (
          await a.client
            .post('/api/v1/brands/requests')
            .send({ name: unique('Lola Recipes') })
            .expect(201)
        ).body,
      );
      expect(requested).toMatchObject({ status: 'PENDING', requestedBy: { sellerId: a.sellerId } });

      const seenByB = brandListSchema.parse(
        (await b.client.get('/api/v1/brands?pageSize=100&status=PENDING').expect(200)).body,
      );
      expect(seenByB.items.map((x) => x.id)).not.toContain(requested.id);
      const seenByA = brandListSchema.parse(
        (await a.client.get('/api/v1/brands?pageSize=100&status=PENDING').expect(200)).body,
      );
      expect(seenByA.items.map((x) => x.id)).toContain(requested.id);

      const noNote = await admin
        .post(`/api/v1/brands/${requested.id}/review`)
        .send({ decision: 'REJECT' })
        .expect(400);
      expect(errorCode(noNote)).toBe('VALIDATION_FAILED');
      const approved = brandSchema.parse(
        (
          await admin
            .post(`/api/v1/brands/${requested.id}/review`)
            .send({ decision: 'APPROVE' })
            .expect(201)
        ).body,
      );
      expect(approved.status).toBe('ACTIVE');
      // Decided once: a second decision conflicts.
      await admin
        .post(`/api/v1/brands/${requested.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(409);
      // Now everyone can use it.
      const nowSeenByB = brandListSchema.parse(
        (
          await b.client
            .get(`/api/v1/brands?search=${encodeURIComponent(approved.name)}`)
            .expect(200)
        ).body,
      );
      expect(nowSeenByB.items.map((x) => x.id)).toContain(requested.id);
    });

    it('does not let sellers create active brands directly', async () => {
      const seller = await testSeller(app);
      await seller.client
        .post('/api/v1/brands')
        .send({ name: unique('Sneaky') })
        .expect(403);
    });
  });
});
