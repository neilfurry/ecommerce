import { EMAIL_JOBS } from '@marketplace/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  adminUserDetailSchema,
  adminUserListSchema,
  adminUserSchema,
  apiErrorBodySchema,
  auditLogListSchema,
  myWholesaleApplicationSchema,
  roleListSchema,
  roleSchema,
  sessionResponseSchema,
  wholesaleApplicationListSchema,
  wholesaleApplicationSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { PrincipalService } from '../src/modules/auth/principal.service';
import {
  createUser,
  findJob,
  latestEmailToken,
  signedInClient,
  TEST_PASSWORD,
  TestClient,
  uniqueEmail,
} from './auth-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const BUSINESS = {
  businessName: 'Dela Cruz Wholesale',
  tin: '987654321',
  businessAddress: '45 Mabini Ave, Cebu City, Cebu',
};

/** Staff accounts, roles and permissions, wholesale approval and the audit log. */
describe('Administration (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let superAdmin: TestClient;
  let admin: TestClient;
  let adminId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    superAdmin = (await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'root')).client;
    const signed = await signedInClient(app, 'admin', ['ADMIN'], 'ops');
    admin = signed.client;
    adminId = signed.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('users', () => {
    it('invites a staff member who then sets a password and signs in', async () => {
      const email = uniqueEmail('new.support');
      const created = adminUserSchema.parse(
        (
          await admin
            .post('/api/v1/admin/users')
            .send({ firstName: 'Ana', lastName: 'Reyes', email, roles: ['CUSTOMER_SUPPORT'] })
            .expect(201)
        ).body,
      );
      expect(created).toMatchObject({ status: 'INVITED', roles: ['CUSTOMER_SUPPORT'], email });

      // Invited accounts have no password, so they cannot sign in yet.
      const staff = await new TestClient(app.getHttpServer(), 'admin').init();
      await staff.post('/api/v1/auth/sign-in').send({ email, password: TEST_PASSWORD }).expect(401);

      const token = await latestEmailToken(app, EMAIL_JOBS.STAFF_INVITATION, email);
      await staff
        .post('/api/v1/auth/invitations/accept')
        .send({ token, password: TEST_PASSWORD })
        .expect(204);
      const session = sessionResponseSchema.parse(
        (
          await staff
            .post('/api/v1/auth/sign-in')
            .send({ email, password: TEST_PASSWORD })
            .expect(200)
        ).body,
      );
      expect(session.user.roles).toEqual(['CUSTOMER_SUPPORT']);
      expect(session.user.permissions).toEqual(
        expect.arrayContaining(['users.read', 'users.sessions.revoke']),
      );
    });

    it('rejects a duplicate email', async () => {
      const existing = await createUser(app, { roles: ['CUSTOMER'] });
      const res = await admin
        .post('/api/v1/admin/users')
        .send({
          firstName: 'Dup',
          lastName: 'Licate',
          email: existing.email,
          roles: ['WAREHOUSE_STAFF'],
        })
        .expect(409);
      expect(errorCode(res)).toBe('CONFLICT');
    });

    it('only lets each admin grant the roles below them', async () => {
      const body = (roles: string[]) => ({
        firstName: 'X',
        lastName: 'Y',
        email: uniqueEmail('grant'),
        roles,
      });
      await admin
        .post('/api/v1/admin/users')
        .send(body(['ADMIN']))
        .expect(403);
      await admin
        .post('/api/v1/admin/users')
        .send(body(['SUPER_ADMIN']))
        .expect(403);
      await admin
        .post('/api/v1/admin/users')
        .send(body(['CUSTOMER']))
        .expect(403);
      await superAdmin
        .post('/api/v1/admin/users')
        .send(body(['ADMIN']))
        .expect(201);
    });

    it('requires the matching permission for each action', async () => {
      const { client: finance } = await signedInClient(app, 'admin', ['FINANCE_ADMIN'], 'finance');
      await finance.get('/api/v1/admin/users').expect(200);
      const res = await finance
        .post('/api/v1/admin/users')
        .send({
          firstName: 'No',
          lastName: 'Way',
          email: uniqueEmail('denied'),
          roles: ['WAREHOUSE_STAFF'],
        })
        .expect(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
      const { client: warehouse } = await signedInClient(
        app,
        'admin',
        ['WAREHOUSE_STAFF'],
        'warehouse',
      );
      await warehouse.get('/api/v1/admin/users').expect(403);
    });

    it('searches and filters accounts', async () => {
      const target = await createUser(app, { roles: ['DELIVERY_STAFF'], label: 'Searchable' });
      const list = adminUserListSchema.parse(
        (
          await admin
            .get(`/api/v1/admin/users?search=${encodeURIComponent(target.email)}&kind=staff`)
            .expect(200)
        ).body,
      );
      expect(list.items.map((u) => u.id)).toEqual([target.id]);
      const customers = adminUserListSchema.parse(
        (
          await admin
            .get(`/api/v1/admin/users?search=${encodeURIComponent(target.email)}&kind=customers`)
            .expect(200)
        ).body,
      );
      expect(customers.totalItems).toBe(0);
      await admin.get('/api/v1/admin/users?pageSize=500').expect(400);
    });

    it('changes staff roles; the new permissions apply on the next request', async () => {
      const user = await createUser(app, { roles: ['WAREHOUSE_STAFF'] });
      const staff = await (
        await new TestClient(app.getHttpServer(), 'admin').init()
      ).signIn(user.email);
      await staff.get('/api/v1/admin/users').expect(403);

      const updated = adminUserSchema.parse(
        (
          await admin
            .patch(`/api/v1/admin/users/${user.id}`)
            .send({
              firstName: 'Promoted',
              lastName: 'Person',
              roles: ['WAREHOUSE_STAFF', 'CUSTOMER_SUPPORT'],
            })
            .expect(200)
        ).body,
      );
      expect(updated.roles).toEqual(['CUSTOMER_SUPPORT', 'WAREHOUSE_STAFF']);
      await staff.get('/api/v1/admin/users').expect(200);
    });

    it('does not edit customer roles through user administration', async () => {
      const customer = await createUser(app, { roles: ['CUSTOMER'] });
      const res = await superAdmin
        .patch(`/api/v1/admin/users/${customer.id}`)
        .send({ firstName: 'C', lastName: 'D', roles: ['CUSTOMER', 'WHOLESALE_CUSTOMER'] })
        .expect(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });

    it('suspends an account, signing it out immediately, and reactivates it', async () => {
      const user = await createUser(app, { roles: ['CUSTOMER'] });
      const shopper = await (
        await new TestClient(app.getHttpServer(), 'storefront').init()
      ).signIn(user.email);
      await shopper.get('/api/v1/auth/session').expect(200);

      const suspended = adminUserSchema.parse(
        (await admin.post(`/api/v1/admin/users/${user.id}/suspend`).expect(200)).body,
      );
      expect(suspended.status).toBe('SUSPENDED');
      await shopper.get('/api/v1/auth/session').expect(401);
      await shopper.post('/api/v1/auth/refresh').expect(401);

      const back = adminUserSchema.parse(
        (await admin.post(`/api/v1/admin/users/${user.id}/reactivate`).expect(200)).body,
      );
      expect(back.status).toBe('ACTIVE');
      await shopper.signIn(user.email);
    });

    it('refuses to let admins suspend themselves or manage higher roles', async () => {
      await admin.post(`/api/v1/admin/users/${adminId}/suspend`).expect(403);
      const root = await createUser(app, { roles: ['SUPER_ADMIN'] });
      await admin.post(`/api/v1/admin/users/${root.id}/suspend`).expect(403);
      await admin.post(`/api/v1/admin/users/${root.id}/sessions/revoke`).expect(403);
    });

    it('revokes every session of an account', async () => {
      const user = await createUser(app, { roles: ['SELLER_OWNER'] });
      const seller = await (
        await new TestClient(app.getHttpServer(), 'seller').init()
      ).signIn(user.email);
      const detail = adminUserDetailSchema.parse(
        (await admin.get(`/api/v1/admin/users/${user.id}`).expect(200)).body,
      );
      expect(detail.activeSessions).toBe(1);
      await admin.post(`/api/v1/admin/users/${user.id}/sessions/revoke`).expect(204);
      await seller.get('/api/v1/auth/session').expect(401);
    });

    it('answers 404 and 400 for unknown or malformed ids', async () => {
      await admin.get('/api/v1/admin/users/00000000-0000-4000-8000-000000000000').expect(404);
      await admin.get('/api/v1/admin/users/not-a-uuid').expect(400);
    });

    it('never returns password hashes', async () => {
      const res = await admin.get('/api/v1/admin/users?pageSize=100').expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|passwordHash/);
    });
  });

  describe('roles and permissions', () => {
    it('lists every role with its permissions and the permission catalog', async () => {
      const list = roleListSchema.parse((await admin.get('/api/v1/admin/roles').expect(200)).body);
      expect(list.roles.map((r) => r.code)).toEqual(
        expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'CUSTOMER']),
      );
      expect(list.roles.find((r) => r.code === 'SUPER_ADMIN')).toMatchObject({ locked: true });
      expect(list.permissions.map((p) => p.code)).toContain('roles.update');
    });

    it('lets only holders of roles.update change permissions, never for SUPER_ADMIN', async () => {
      await admin
        .put('/api/v1/admin/roles/DELIVERY_STAFF/permissions')
        .send({ permissions: [] })
        .expect(403);
      const res = await superAdmin
        .put('/api/v1/admin/roles/SUPER_ADMIN/permissions')
        .send({ permissions: [] })
        .expect(403);
      expect(errorCode(res)).toBe('FORBIDDEN');
      await superAdmin
        .put('/api/v1/admin/roles/NOT_A_ROLE/permissions')
        .send({ permissions: [] })
        .expect(400);
      await superAdmin
        .put('/api/v1/admin/roles/DELIVERY_STAFF/permissions')
        .send({ permissions: ['nope'] })
        .expect(400);
    });

    it('applies permission changes to signed-in users immediately', async () => {
      // DELIVERY_STAFF has no permissions by default and no other test relies on them.
      const { client: staff, user } = await signedInClient(
        app,
        'admin',
        ['DELIVERY_STAFF'],
        'delivery',
      );
      await staff.get('/api/v1/admin/audit-logs').expect(403);
      try {
        const role = roleSchema.parse(
          (
            await superAdmin
              .put('/api/v1/admin/roles/DELIVERY_STAFF/permissions')
              .send({ permissions: ['audit.read'] })
              .expect(200)
          ).body,
        );
        expect(role.permissions).toEqual(['audit.read']);
        await staff.get('/api/v1/admin/audit-logs').expect(200);
        const audit = auditLogListSchema.parse(
          (
            await superAdmin
              .get(
                '/api/v1/admin/audit-logs?action=role.permissions_updated&entityId=DELIVERY_STAFF',
              )
              .expect(200)
          ).body,
        );
        expect(audit.items[0]?.metadata).toMatchObject({ added: ['audit.read'] });
      } finally {
        await superAdmin
          .put('/api/v1/admin/roles/DELIVERY_STAFF/permissions')
          .send({ permissions: [] })
          .expect(200);
      }
      await staff.get('/api/v1/admin/audit-logs').expect(403);
      expect(user.roles).toEqual(['DELIVERY_STAFF']);
    });
  });

  describe('wholesale approval', () => {
    async function applicant() {
      const user = await createUser(app, { roles: ['CUSTOMER'] });
      const client = await (
        await new TestClient(app.getHttpServer(), 'storefront').init()
      ).signIn(user.email);
      return { user, client };
    }

    it('approves an application, granting wholesale access and emailing the customer', async () => {
      const { user, client } = await applicant();
      expect(
        myWholesaleApplicationSchema.parse(
          (await client.get('/api/v1/account/wholesale-application').expect(200)).body,
        ),
      ).toEqual({
        application: null,
      });
      const submitted = wholesaleApplicationSchema.parse(
        (await client.post('/api/v1/account/wholesale-application').send(BUSINESS).expect(200))
          .body,
      );
      expect(submitted).toMatchObject({ status: 'PENDING', tin: BUSINESS.tin });
      await client.post('/api/v1/account/wholesale-application').send(BUSINESS).expect(409);

      const pending = wholesaleApplicationListSchema.parse(
        (
          await admin
            .get('/api/v1/admin/wholesale-applications?status=PENDING&pageSize=100')
            .expect(200)
        ).body,
      );
      expect(pending.items.map((a) => a.id)).toContain(submitted.id);

      const approved = wholesaleApplicationSchema.parse(
        (
          await admin
            .post(`/api/v1/admin/wholesale-applications/${submitted.id}/review`)
            .send({ decision: 'APPROVE' })
            .expect(200)
        ).body,
      );
      expect(approved.status).toBe('APPROVED');
      const session = sessionResponseSchema.parse(
        (await client.get('/api/v1/auth/session').expect(200)).body,
      );
      expect(session.user.roles).toEqual(['CUSTOMER', 'WHOLESALE_CUSTOMER']);
      expect(session.user.wholesaleStatus).toBe('APPROVED');

      const email = await findJob<{ to: string; decision: string }>(
        app,
        'email',
        (data, job) => job.name === EMAIL_JOBS.WHOLESALE_DECISION && data.to === user.email,
      );
      expect(email.data.decision).toBe('APPROVED');

      // A second review of the same application is refused.
      await admin
        .post(`/api/v1/admin/wholesale-applications/${submitted.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(409);
    });

    it('requires a note to reject, and lets the customer resubmit', async () => {
      const { client } = await applicant();
      const submitted = wholesaleApplicationSchema.parse(
        (await client.post('/api/v1/account/wholesale-application').send(BUSINESS).expect(200))
          .body,
      );
      await admin
        .post(`/api/v1/admin/wholesale-applications/${submitted.id}/review`)
        .send({ decision: 'REJECT' })
        .expect(400);
      await admin
        .post(`/api/v1/admin/wholesale-applications/${submitted.id}/review`)
        .send({ decision: 'REJECT', note: 'The TIN does not match the business name.' })
        .expect(200);
      const mine = myWholesaleApplicationSchema.parse(
        (await client.get('/api/v1/account/wholesale-application').expect(200)).body,
      );
      expect(mine.application).toMatchObject({
        status: 'REJECTED',
        reviewNote: 'The TIN does not match the business name.',
      });

      const again = wholesaleApplicationSchema.parse(
        (
          await client
            .post('/api/v1/account/wholesale-application')
            .send({ ...BUSINESS, tin: '987654321000' })
            .expect(200)
        ).body,
      );
      expect(again).toMatchObject({ id: submitted.id, status: 'PENDING', reviewNote: null });
    });

    it('keeps the customer endpoints away from staff and the admin endpoints away from customers', async () => {
      const { client } = await applicant();
      await client.get('/api/v1/admin/wholesale-applications').expect(403);
      await admin.get('/api/v1/account/wholesale-application').expect(403);
    });
  });

  describe('audit log', () => {
    it('records administrative actions with their actor', async () => {
      const user = await createUser(app, { roles: ['WAREHOUSE_STAFF'] });
      await admin.post(`/api/v1/admin/users/${user.id}/suspend`).expect(200);
      const list = auditLogListSchema.parse(
        (
          await admin
            .get(`/api/v1/admin/audit-logs?action=user.suspended&entityId=${user.id}`)
            .expect(200)
        ).body,
      );
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        outcome: 'SUCCESS',
        actor: { id: adminId },
        entityType: 'user',
      });
    });

    it('cannot be altered, even directly in the database', async () => {
      const entry = await prisma.auditLog.findFirstOrThrow();
      await expect(
        prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
      ).rejects.toThrow();
      await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
      expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).toEqual(entry);
    });
  });

  it('caches principals but drops the cache when a user changes', async () => {
    const principals = app.get(PrincipalService);
    const user = await createUser(app, { roles: ['WAREHOUSE_STAFF'] });
    expect((await principals.load(user.id))?.roles).toEqual(['WAREHOUSE_STAFF']);
    await admin
      .patch(`/api/v1/admin/users/${user.id}`)
      .send({ firstName: 'Test', lastName: 'User', roles: ['DELIVERY_STAFF'] })
      .expect(200);
    expect((await principals.load(user.id))?.roles).toEqual(['DELIVERY_STAFF']);
  });
});
