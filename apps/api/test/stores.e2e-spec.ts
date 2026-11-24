import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  myStoresSchema,
  publicStoreSchema,
  slugAvailabilitySchema,
  storeListSchema,
  storeSchema,
} from '@marketplace/validation';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createUser, signedInClient, TestClient } from './auth-helpers';
import { PNG } from './fixtures';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const slug = (label: string) =>
  `${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;

/** Stores: creation after verification, settings, images, isolation and admin control. */
describe('Stores (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'store-admin')).client;
  });

  afterAll(async () => {
    await app.close();
  });

  async function seller(status: 'VERIFIED' | 'PENDING' = 'VERIFIED') {
    const owner = await createUser(app, { roles: ['SELLER_OWNER'], sellerStatus: status });
    const client = await new TestClient(app.getHttpServer(), 'seller').init();
    await client.signIn(owner.email);
    return { owner, client };
  }

  async function createStore(client: TestClient, name = 'Santos Hardware') {
    const res = await client
      .post('/api/v1/stores')
      .send({ name, slug: slug('store') })
      .expect(201);
    return storeSchema.parse(res.body);
  }

  it('lets only verified sellers create stores', async () => {
    const pending = await seller('PENDING');
    const res = await pending.client
      .post('/api/v1/stores')
      .send({ name: 'Too Soon', slug: slug('too-soon') })
      .expect(403);
    expect(apiErrorBodySchema.parse(res.body).error.message).toContain('verified');
    const mine = myStoresSchema.parse(
      (await pending.client.get('/api/v1/stores/mine').expect(200)).body,
    );
    expect(mine).toEqual({ stores: [], canCreate: false });

    const verified = await seller();
    const store = await createStore(verified.client);
    expect(store).toMatchObject({
      status: 'ACTIVE',
      sellerId: verified.owner.sellerId,
      settings: { primaryColor: '#1d4ed8' },
    });
    const mineAfter = myStoresSchema.parse(
      (await verified.client.get('/api/v1/stores/mine').expect(200)).body,
    );
    expect(mineAfter.stores.map((s) => s.id)).toEqual([store.id]);
    expect(mineAfter.canCreate).toBe(true);
  });

  it('keeps store links unique, well-formed and away from reserved words', async () => {
    const { client } = await seller();
    const taken = await createStore(client);
    const check = async (value: string) =>
      slugAvailabilitySchema.parse(
        (
          await request(app.getHttpServer())
            .get(`/api/v1/stores/slug-availability?slug=${value}`)
            .expect(200)
        ).body,
      );
    expect(await check(taken.slug)).toMatchObject({ available: false, reason: 'Already taken' });
    expect(await check('checkout')).toMatchObject({
      available: false,
      reason: 'This name is reserved',
    });
    expect((await check('Bad--Slug')).available).toBe(false);
    expect((await check(slug('free'))).available).toBe(true);

    const dup = await client
      .post('/api/v1/stores')
      .send({ name: 'Copy', slug: taken.slug })
      .expect(409);
    expect(apiErrorBodySchema.parse(dup.body).error.fieldErrors?.[0]?.path).toBe('slug');
    await client.post('/api/v1/stores').send({ name: 'Bad', slug: '-bad-' }).expect(400);
  });

  it('allows at most five stores per seller', async () => {
    const { client } = await seller();
    for (let i = 0; i < 5; i += 1) await createStore(client, `Branch ${i + 1}`);
    const res = await client
      .post('/api/v1/stores')
      .send({ name: 'Sixth', slug: slug('sixth') })
      .expect(409);
    expect(errorCode(res)).toBe('CONFLICT');
  });

  it('edits details, social links, settings and branding', async () => {
    const { client } = await seller();
    const store = await createStore(client);
    const updated = storeSchema.parse(
      (
        await client
          .patch(`/api/v1/stores/${store.id}`)
          .send({
            description: 'Tools and hardware for every home.',
            phone: '0917 555 1234',
            city: 'Quezon City',
            socialLinks: { facebook: 'https://facebook.com/santoshardware' },
          })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({
      phone: '+639175551234',
      socialLinks: { facebook: 'https://facebook.com/santoshardware' },
    });
    await client
      .patch(`/api/v1/stores/${store.id}`)
      .send({ socialLinks: { website: 'http://insecure.example' } })
      .expect(400);

    const settings = storeSchema.parse(
      (
        await client
          .put(`/api/v1/stores/${store.id}/settings`)
          .send({ primaryColor: '#0F766E', vacationMode: true, vacationMessage: 'Back on Monday!' })
          .expect(200)
      ).body,
    ).settings;
    expect(settings).toMatchObject({
      primaryColor: '#0f766e',
      vacationMode: true,
      vacationMessage: 'Back on Monday!',
    });
    await client
      .put(`/api/v1/stores/${store.id}/settings`)
      .send({ primaryColor: 'red' })
      .expect(400);
  });

  it('serves logos publicly and replaces them', async () => {
    const { client } = await seller();
    const store = await createStore(client);
    const withLogo = storeSchema.parse(
      (
        await client
          .put(`/api/v1/stores/${store.id}/logo`)
          .attach('file', PNG, { filename: 'logo.png' })
          .expect(200)
      ).body,
    );
    expect(withLogo.logoUrl).toMatch(new RegExp(`^/api/v1/stores/${store.id}/logo\\?v=`));
    const image = await request(app.getHttpServer()).get(withLogo.logoUrl!).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toContain('public');

    const replaced = storeSchema.parse(
      (
        await client
          .put(`/api/v1/stores/${store.id}/logo`)
          .attach('file', PNG, { filename: 'logo2.png' })
          .expect(200)
      ).body,
    );
    expect(replaced.logoUrl).not.toBe(withLogo.logoUrl);
    const removed = storeSchema.parse(
      (await client.delete(`/api/v1/stores/${store.id}/logo`).expect(200)).body,
    );
    expect(removed.logoUrl).toBeNull();
    await request(app.getHttpServer()).get(`/api/v1/stores/${store.id}/logo`).expect(404);
    // Documents are not accepted as images.
    const pdf = Buffer.from('%PDF-1.4\nnot an image');
    await client
      .put(`/api/v1/stores/${store.id}/banner`)
      .attach('file', pdf, { filename: 'banner.pdf' })
      .expect(415);
  });

  it('shows open stores of verified sellers to shoppers only', async () => {
    const { client, owner } = await seller();
    const store = await createStore(client);
    const publicView = publicStoreSchema.parse(
      (await request(app.getHttpServer()).get(`/api/v1/stores/by-slug/${store.slug}`).expect(200))
        .body,
    );
    expect(publicView).not.toHaveProperty('statusNote');
    expect(publicView).not.toHaveProperty('sellerId');

    await client.post(`/api/v1/stores/${store.id}/close`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/stores/by-slug/${store.slug}`).expect(404);
    await client.post(`/api/v1/stores/${store.id}/open`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/stores/by-slug/${store.slug}`).expect(200);

    await prisma.seller.update({
      where: { id: owner.sellerId! },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await request(app.getHttpServer()).get(`/api/v1/stores/by-slug/${store.slug}`).expect(404);
  });

  it('keeps every seller to its own stores', async () => {
    const a = await seller();
    const b = await seller();
    const storeB = await createStore(b.client);
    // Not even its existence is revealed.
    await a.client.get(`/api/v1/stores/${storeB.id}`).expect(404);
    await a.client.patch(`/api/v1/stores/${storeB.id}`).send({ name: 'Hijacked' }).expect(404);
    await a.client
      .put(`/api/v1/stores/${storeB.id}/settings`)
      .send({ vacationMode: true })
      .expect(404);
    await a.client.post(`/api/v1/stores/${storeB.id}/close`).expect(404);
    await a.client
      .put(`/api/v1/stores/${storeB.id}/logo`)
      .attach('file', PNG, { filename: 'x.png' })
      .expect(404);
    await a.client.get('/api/v1/stores').expect(403);
    const mineA = myStoresSchema.parse(
      (await a.client.get('/api/v1/stores/mine').expect(200)).body,
    );
    expect(mineA.stores.some((s) => s.id === storeB.id)).toBe(false);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: storeB.id } })).name).toBe(
      storeB.name,
    );
  });

  it('employees without store permission can view but not change stores', async () => {
    const { client, owner } = await seller();
    const store = await createStore(client);
    const encoder = await createUser(app, { roles: ['SELLER_ENCODER'], sellerId: owner.sellerId });
    const staff = await new TestClient(app.getHttpServer(), 'seller').init();
    await staff.signIn(encoder.email);
    await staff.get(`/api/v1/stores/${store.id}`).expect(200);
    await staff.patch(`/api/v1/stores/${store.id}`).send({ name: 'Renamed' }).expect(403);
    await staff
      .post('/api/v1/stores')
      .send({ name: 'Mine', slug: slug('mine') })
      .expect(403);
  });

  it('lets admins list, suspend and reinstate stores', async () => {
    const { client } = await seller();
    const store = await createStore(client);
    const list = storeListSchema.parse(
      (await admin.get(`/api/v1/stores?search=${store.slug}`).expect(200)).body,
    );
    expect(list.items.map((s) => s.id)).toEqual([store.id]);
    await admin.get(`/api/v1/stores/${store.id}`).expect(200);

    const suspended = storeSchema.parse(
      (
        await admin
          .post(`/api/v1/stores/${store.id}/suspend`)
          .send({ reason: 'Misleading product claims.' })
          .expect(200)
      ).body,
    );
    expect(suspended).toMatchObject({
      status: 'SUSPENDED',
      statusNote: 'Misleading product claims.',
    });
    // The seller cannot reopen or edit it.
    await client.post(`/api/v1/stores/${store.id}/open`).expect(403);
    await client.patch(`/api/v1/stores/${store.id}`).send({ name: 'Try again' }).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/stores/by-slug/${store.slug}`).expect(404);

    const reinstated = storeSchema.parse(
      (
        await admin
          .post(`/api/v1/stores/${store.id}/reinstate`)
          .send({ reason: 'Listings corrected.' })
          .expect(200)
      ).body,
    );
    expect(reinstated.status).toBe('ACTIVE');
    const audit = await prisma.auditLog.findMany({
      where: { entityId: store.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((e) => e.action)).toEqual([
      'store.created',
      'store.suspended',
      'store.reinstated',
    ]);

    const { client: support } = await signedInClient(
      app,
      'admin',
      ['CUSTOMER_SUPPORT'],
      'store-support',
    );
    await support.get(`/api/v1/stores/${store.id}`).expect(200);
    await support
      .post(`/api/v1/stores/${store.id}/suspend`)
      .send({ reason: 'Not allowed to do this' })
      .expect(403);
  });
});
