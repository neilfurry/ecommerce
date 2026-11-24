import { EMAIL_JOBS } from '@marketplace/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  sellerDetailSchema,
  sellerDocumentSchema,
  sellerListSchema,
  sessionResponseSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  createUser,
  findJob,
  latestEmailToken,
  randomMobile,
  signedInClient,
  TEST_PASSWORD,
  TestClient,
  uniqueEmail,
} from './auth-helpers';
import { PDF, PNG } from './fixtures';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

const COMPLETE_PROFILE = {
  addressLine1: '45 Mabini Street',
  barangay: 'Poblacion',
  city: 'Makati City',
  province: 'Metro Manila',
  postalCode: '1210',
  registrationNumber: 'DTI-7654321',
  tin: '123-456-789-000',
};

/** Seller registration, documents, verification workflow and data isolation. */
describe('Sellers (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'seller-reviewer')).client;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Registers a seller through the API, the way the Seller Center does. */
  async function register(overrides: Record<string, unknown> = {}) {
    const client = await new TestClient(app.getHttpServer(), 'seller').init();
    const body = {
      firstName: 'Lito',
      lastName: 'Santos',
      email: uniqueEmail('seller'),
      password: TEST_PASSWORD,
      businessName: 'Santos General Merchandise',
      businessType: 'SOLE_PROPRIETORSHIP',
      mobile: randomMobile(),
      ...overrides,
    };
    const res = await client.post('/api/v1/auth/sellers/sign-up').send(body).expect(201);
    return { client, body, session: sessionResponseSchema.parse(res.body) };
  }

  async function verifyEmail(client: TestClient, email: string) {
    const token = await latestEmailToken(app, EMAIL_JOBS.VERIFY_ADDRESS, email);
    await client.post('/api/v1/auth/email/verify').send({ token }).expect(204);
  }

  function upload(client: TestClient, type: string, file = PDF, filename = 'document.pdf') {
    return client
      .post('/api/v1/sellers/me/documents')
      .field('type', type)
      .attach('file', file, { filename });
  }

  /** A complete application, submitted and waiting for review. */
  async function submittedSeller() {
    const seller = await register();
    await verifyEmail(seller.client, seller.body.email);
    await seller.client.patch('/api/v1/sellers/me').send(COMPLETE_PROFILE).expect(200);
    for (const type of ['BUSINESS_REGISTRATION', 'BIR_REGISTRATION', 'OWNER_ID']) {
      await upload(seller.client, type).expect(201);
    }
    const res = await seller.client.post('/api/v1/sellers/me/submit').expect(200);
    return { ...seller, detail: sellerDetailSchema.parse(res.body) };
  }

  describe('registration', () => {
    it('creates the owner account and a PENDING seller, signed in to the Seller Center', async () => {
      const mixedCase = `Owner.${Date.now()}@Example.PH`;
      const lower = mixedCase.toLowerCase();
      const { client, body, session } = await register({ email: mixedCase });
      expect(session.app).toBe('seller');
      expect(session.user).toMatchObject({
        email: lower,
        roles: ['SELLER_OWNER'],
        seller: { businessName: body.businessName, status: 'PENDING', isOwner: true },
      });
      expect(session.user.permissions).toEqual(
        expect.arrayContaining([
          'seller.profile.manage',
          'seller.store.manage',
          'seller.members.manage',
        ]),
      );
      // No platform permissions ever come with seller roles.
      expect(session.user.permissions.some((p) => !p.startsWith('seller.'))).toBe(false);

      const mine = sellerDetailSchema.parse(
        (await client.get('/api/v1/sellers/me').expect(200)).body,
      );
      expect(mine).toMatchObject({ status: 'PENDING', legalDetailsEditable: true });
      expect(mine.events.map((e) => e.type)).toEqual(['REGISTERED']);
      expect(mine.missingForSubmission).toEqual(
        expect.arrayContaining([
          'Confirm your email address (check your inbox for the link).',
          'Add the business address.',
          'Add the BIR TIN.',
        ]),
      );
      // The confirmation link points at the Seller Center.
      const job = await findJob<{ to: string; link: string }>(
        app,
        'email',
        (data, j) => j.name === EMAIL_JOBS.VERIFY_ADDRESS && data.to === lower,
      );
      expect(job.data.link).toMatch(/^http:\/\/localhost:5174\/verify-email\?token=/);
    });

    it('only works from the Seller Center and refuses a registered email', async () => {
      const storefront = await new TestClient(app.getHttpServer(), 'storefront').init();
      await storefront
        .post('/api/v1/auth/sellers/sign-up')
        .send({
          firstName: 'A',
          lastName: 'B',
          email: uniqueEmail('x'),
          password: TEST_PASSWORD,
          businessName: 'Shop',
          businessType: 'CORPORATION',
          mobile: randomMobile(),
        })
        .expect(400);
      const existing = await createUser(app, { roles: ['CUSTOMER'] });
      const seller = await new TestClient(app.getHttpServer(), 'seller').init();
      const res = await seller
        .post('/api/v1/auth/sellers/sign-up')
        .send({
          firstName: 'A',
          lastName: 'B',
          email: existing.email,
          password: TEST_PASSWORD,
          businessName: 'Shop',
          businessType: 'CORPORATION',
          mobile: randomMobile(),
        })
        .expect(409);
      expect(apiErrorBodySchema.parse(res.body).error.fieldErrors?.[0]?.path).toBe('email');
    });
  });

  describe('documents and submission', () => {
    it('refuses submission until the profile, email and required documents are complete', async () => {
      const { client, body } = await register();
      const res = await client.post('/api/v1/sellers/me/submit').expect(422);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
      expect(apiErrorBodySchema.parse(res.body).error.fieldErrors?.length).toBeGreaterThanOrEqual(
        5,
      );

      await verifyEmail(client, body.email);
      await client.patch('/api/v1/sellers/me').send(COMPLETE_PROFILE).expect(200);
      const doc = sellerDocumentSchema.parse(
        (await upload(client, 'BUSINESS_REGISTRATION').expect(201)).body,
      );
      expect(doc).toMatchObject({ type: 'BUSINESS_REGISTRATION', contentType: 'application/pdf' });

      const detail = sellerDetailSchema.parse(
        (await client.get('/api/v1/sellers/me').expect(200)).body,
      );
      expect(detail.missingForSubmission).toEqual([
        'Upload: BIR Certificate of Registration (Form 2303).',
        "Upload: Owner's government-issued ID.",
      ]);
      expect(detail.tin).toBe('123456789000');
    });

    it('accepts PDF, JPEG and PNG only, checked by content', async () => {
      const { client } = await register();
      await upload(client, 'OWNER_ID', PNG, 'id.png').expect(201);
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);
      await upload(client, 'OWNER_ID', exe, 'id.pdf').expect(415);
      await upload(client, 'NOT_A_TYPE').expect(400);
    });

    it('lets the seller download and remove its own documents before submission', async () => {
      const { client } = await register();
      const doc = sellerDocumentSchema.parse(
        (await upload(client, 'MAYORS_PERMIT').expect(201)).body,
      );
      const res = await client.get(`/api/v1/sellers/me/documents/${doc.id}/content`).expect(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(Buffer.from(res.body as Buffer).equals(PDF)).toBe(true);
      await client.delete(`/api/v1/sellers/me/documents/${doc.id}`).expect(204);
      await client.get(`/api/v1/sellers/me/documents/${doc.id}/content`).expect(404);
    });

    it('locks legal details and documents while under review', async () => {
      const { client, detail } = await submittedSeller();
      expect(detail.status).toBe('UNDER_REVIEW');
      expect(detail.events.map((e) => e.type)).toEqual(['REGISTERED', 'SUBMITTED']);
      await client
        .patch('/api/v1/sellers/me')
        .send({ businessName: 'New Name Trading' })
        .expect(409);
      await client.patch('/api/v1/sellers/me').send({ mobile: '09171112222' }).expect(200);
      await upload(client, 'OTHER').expect(409);
      await client.delete(`/api/v1/sellers/me/documents/${detail.documents[0]!.id}`).expect(409);
      await client.post('/api/v1/sellers/me/submit').expect(409);
    });
  });

  describe('admin review', () => {
    it('lists applications under review, oldest first', async () => {
      const first = await submittedSeller();
      const second = await submittedSeller();
      const list = sellerListSchema.parse(
        (await admin.get('/api/v1/sellers?status=UNDER_REVIEW&pageSize=100').expect(200)).body,
      );
      const ids = list.items.map((s) => s.id);
      expect(ids.indexOf(first.detail.id)).toBeLessThan(ids.indexOf(second.detail.id));
    });

    it('requests more information, then approves the corrected application', async () => {
      const { client, detail, body } = await submittedSeller();
      await admin
        .post(`/api/v1/sellers/${detail.id}/review`)
        .send({ decision: 'REQUEST_INFO' })
        .expect(400);
      const asked = sellerDetailSchema.parse(
        (
          await admin
            .post(`/api/v1/sellers/${detail.id}/review`)
            .send({
              decision: 'REQUEST_INFO',
              note: 'The permit photo is blurry; please upload a clearer copy.',
            })
            .expect(200)
        ).body,
      );
      expect(asked).toMatchObject({
        status: 'PENDING',
        statusNote: 'The permit photo is blurry; please upload a clearer copy.',
      });

      // The seller sees the request (staff name hidden) and can change things again.
      const seen = sellerDetailSchema.parse(
        (await client.get('/api/v1/sellers/me').expect(200)).body,
      );
      expect(seen.events.at(-1)).toMatchObject({
        type: 'INFO_REQUESTED',
        actor: 'Marketplace team',
      });
      await upload(client, 'MAYORS_PERMIT').expect(201);
      await client.post('/api/v1/sellers/me/submit').expect(200);

      const approved = sellerDetailSchema.parse(
        (
          await admin
            .post(`/api/v1/sellers/${detail.id}/review`)
            .send({ decision: 'APPROVE' })
            .expect(200)
        ).body,
      );
      expect(approved).toMatchObject({ status: 'VERIFIED', statusNote: null });
      expect(approved.verifiedAt).not.toBeNull();
      expect(approved.events.map((e) => e.type)).toEqual([
        'REGISTERED',
        'SUBMITTED',
        'INFO_REQUESTED',
        'SUBMITTED',
        'APPROVED',
      ]);

      // The owner's session reflects the new status on the next request.
      const session = sessionResponseSchema.parse(
        (await client.get('/api/v1/auth/session').expect(200)).body,
      );
      expect(session.user.seller?.status).toBe('VERIFIED');

      const email = await findJob<{ to: string; event: string }>(
        app,
        'email',
        (data, j) =>
          j.name === EMAIL_JOBS.SELLER_STATUS &&
          data.to === body.email &&
          data.event === 'APPROVED',
      );
      expect(email.data.event).toBe('APPROVED');
      await admin
        .post(`/api/v1/sellers/${detail.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(409);
    });

    it('rejects with a reason; the seller can correct and resubmit', async () => {
      const { client, detail } = await submittedSeller();
      await admin
        .post(`/api/v1/sellers/${detail.id}/review`)
        .send({ decision: 'REJECT', note: 'no' })
        .expect(400);
      const rejected = sellerDetailSchema.parse(
        (
          await admin
            .post(`/api/v1/sellers/${detail.id}/review`)
            .send({ decision: 'REJECT', note: 'The TIN does not match the BIR certificate.' })
            .expect(200)
        ).body,
      );
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        statusNote: 'The TIN does not match the BIR certificate.',
      });
      await client.patch('/api/v1/sellers/me').send({ tin: '987654321000' }).expect(200);
      const resubmitted = sellerDetailSchema.parse(
        (await client.post('/api/v1/sellers/me/submit').expect(200)).body,
      );
      expect(resubmitted.status).toBe('UNDER_REVIEW');
    });

    it('suspends, reinstates and closes sellers', async () => {
      const { client, detail } = await submittedSeller();
      await admin
        .post(`/api/v1/sellers/${detail.id}/suspend`)
        .send({ reason: 'Too early' })
        .expect(409);
      await admin
        .post(`/api/v1/sellers/${detail.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(200);
      const suspended = sellerDetailSchema.parse(
        (
          await admin
            .post(`/api/v1/sellers/${detail.id}/suspend`)
            .send({ reason: 'Counterfeit goods reported.' })
            .expect(200)
        ).body,
      );
      expect(suspended.status).toBe('SUSPENDED');
      // Store changes are refused while suspended.
      const store = await client
        .post('/api/v1/stores')
        .send({ name: 'Blocked', slug: `blocked-${Date.now()}` })
        .expect(403);
      expect(errorCode(store)).toBe('FORBIDDEN');
      await admin
        .post(`/api/v1/sellers/${detail.id}/reinstate`)
        .send({ reason: 'Investigation closed.' })
        .expect(200);

      const closed = sellerDetailSchema.parse(
        (
          await admin
            .post(`/api/v1/sellers/${detail.id}/close`)
            .send({ reason: 'Closed at the owner’s request.' })
            .expect(200)
        ).body,
      );
      expect(closed.status).toBe('CLOSED');
      // Closing ends Seller Center access for everyone in the business.
      await client.get('/api/v1/auth/session').expect(401);
    });

    it('needs the right permission for each action', async () => {
      const { detail } = await submittedSeller();
      const { client: support } = await signedInClient(
        app,
        'admin',
        ['CUSTOMER_SUPPORT'],
        'support',
      );
      await support.get(`/api/v1/sellers/${detail.id}`).expect(200);
      await support
        .post(`/api/v1/sellers/${detail.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(403);
      const { client: warehouse } = await signedInClient(
        app,
        'admin',
        ['WAREHOUSE_STAFF'],
        'warehouse',
      );
      await warehouse.get('/api/v1/sellers').expect(403);
    });
  });

  describe('document privacy and seller isolation', () => {
    it('serves documents only to the seller itself and to staff, and records staff views', async () => {
      const { client, detail } = await submittedSeller();
      const doc = detail.documents[0]!;
      const url = `/api/v1/sellers/${detail.id}/documents/${doc.id}/content`;

      // Staff with sellers.read: allowed, and the view is audited.
      await admin.get(url).expect(200);
      const views = await prisma.auditLog.count({
        where: { action: 'seller.document_viewed', entityId: detail.id },
      });
      expect(views).toBe(1);

      // Anonymous: 401. A customer: 403. Another seller: 403 on the admin route, 404 on its own.
      const anonymous = await new TestClient(app.getHttpServer(), 'admin').init();
      await anonymous.get(url).expect(401);
      const { client: customer } = await signedInClient(app, 'storefront', ['CUSTOMER'], 'curious');
      await customer.get(url).expect(403);
      const other = await register();
      await other.client.get(url).expect(403);
      await other.client.get(`/api/v1/sellers/me/documents/${doc.id}/content`).expect(404);

      // The owner can always read its own.
      await client.get(`/api/v1/sellers/me/documents/${doc.id}/content`).expect(200);
      // No public or pre-signed URL exists for seller documents.
      expect(JSON.stringify(detail)).not.toMatch(/X-Amz-Signature|https?:\/\/localhost:9000/);
    });

    it('never lets one seller change another seller', async () => {
      const a = await register();
      const b = await register();
      const docB = sellerDocumentSchema.parse((await upload(b.client, 'OTHER').expect(201)).body);
      await a.client.delete(`/api/v1/sellers/me/documents/${docB.id}`).expect(404);
      const bDetail = sellerDetailSchema.parse(
        (await b.client.get('/api/v1/sellers/me').expect(200)).body,
      );
      // Admin routes are not reachable from the Seller Center.
      await a.client.get(`/api/v1/sellers/${bDetail.id}`).expect(403);
      await a.client
        .post(`/api/v1/sellers/${bDetail.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('records every step in the audit log', async () => {
      const { detail } = await submittedSeller();
      await admin
        .post(`/api/v1/sellers/${detail.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(200);
      const actions = (
        await prisma.auditLog.findMany({
          where: { entityId: detail.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((e) => e.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'seller.registered',
          'seller.profile_updated',
          'seller.document_uploaded',
          'seller.submitted',
          'seller.approved',
        ]),
      );
    });
  });

  it('keeps unverified seller staff out of platform pages', async () => {
    const owner = await createUser(app, { roles: ['SELLER_OWNER'], sellerStatus: 'PENDING' });
    const client = await new TestClient(app.getHttpServer(), 'seller').init();
    await client.signIn(owner.email);
    await client.get('/api/v1/users').expect(403);
    await client.get('/api/v1/roles').expect(403);
  });
});
