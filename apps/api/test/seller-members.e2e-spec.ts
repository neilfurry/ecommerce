import { EMAIL_JOBS } from '@marketplace/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  sellerInvitationPreviewSchema,
  sellerMemberSchema,
  sellerTeamSchema,
  sessionResponseSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  createUser,
  findJob,
  signedInClient,
  TEST_PASSWORD,
  TestClient,
  uniqueEmail,
} from './auth-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

/** Seller employees: invitations, roles and permissions, suspension, removal and isolation. */
describe('Seller employees (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function owner() {
    const user = await createUser(app, { roles: ['SELLER_OWNER'], label: 'owner' });
    const client = await new TestClient(app.getHttpServer(), 'seller').init();
    await client.signIn(user.email);
    return { user, client };
  }

  async function invitationToken(email: string): Promise<string> {
    const job = await findJob<{ to: string; link: string }>(
      app,
      'email',
      (data, j) => j.name === EMAIL_JOBS.SELLER_INVITATION && data.to === email,
    );
    return new URL(job.data.link).searchParams.get('token')!;
  }

  /** Invites, accepts as a new person and signs in to the Seller Center. */
  async function hire(boss: TestClient, roles: string[], permissions: string[] = []) {
    const email = uniqueEmail('staff');
    await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email, roles, permissions })
      .expect(201);
    const token = await invitationToken(email);
    const anonymous = await new TestClient(app.getHttpServer(), 'seller').init();
    await anonymous
      .post('/api/v1/auth/seller-invitations/accept')
      .send({ token, firstName: 'Nina', lastName: 'Cruz', password: TEST_PASSWORD })
      .expect(204);
    const client = await new TestClient(app.getHttpServer(), 'seller').init();
    await client.signIn(email);
    const team = sellerTeamSchema.parse(
      (await boss.get('/api/v1/seller/members').expect(200)).body,
    );
    const member = team.members.find((m) => m.email === email)!;
    return { email, client, member };
  }

  it('invites an employee who joins with a new account and gets exactly the assigned access', async () => {
    const { client: boss, user } = await owner();
    const email = uniqueEmail('new.hire');
    await boss
      .post('/api/v1/seller/members/invitations')
      .send({
        email: email.toUpperCase(),
        roles: ['SELLER_ENCODER'],
        permissions: ['seller.store.manage'],
      })
      .expect(201);

    const team = sellerTeamSchema.parse(
      (await boss.get('/api/v1/seller/members').expect(200)).body,
    );
    expect(team.invitations).toEqual([
      expect.objectContaining({
        email,
        roles: ['SELLER_ENCODER'],
        permissions: ['seller.store.manage'],
        expired: false,
      }),
    ]);
    expect(team.members.map((m) => m.isOwner)).toEqual([true]);

    const token = await invitationToken(email);
    const visitor = await new TestClient(app.getHttpServer(), 'seller').init();
    const preview = sellerInvitationPreviewSchema.parse(
      (await visitor.post('/api/v1/auth/seller-invitations/preview').send({ token }).expect(200))
        .body,
    );
    expect(preview).toMatchObject({ email, roles: ['SELLER_ENCODER'], existingAccount: false });

    await visitor
      .post('/api/v1/auth/seller-invitations/accept')
      .send({ token, password: TEST_PASSWORD })
      .expect(400);
    await visitor
      .post('/api/v1/auth/seller-invitations/accept')
      .send({ token, firstName: 'Nina', lastName: 'Cruz', password: TEST_PASSWORD })
      .expect(204);
    // Single use.
    await visitor
      .post('/api/v1/auth/seller-invitations/accept')
      .send({ token, firstName: 'Nina', lastName: 'Cruz', password: TEST_PASSWORD })
      .expect(400);

    const staff = await new TestClient(app.getHttpServer(), 'seller').init();
    const session = sessionResponseSchema.parse(
      (
        await staff
          .post('/api/v1/auth/sign-in')
          .send({ email, password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    expect(session.user).toMatchObject({
      roles: ['SELLER_ENCODER'],
      emailVerified: true,
      seller: { id: user.sellerId, isOwner: false },
    });
    // The role's permissions plus the extra one, nothing else.
    expect([...session.user.permissions].sort()).toEqual(
      ['seller.members.read', 'seller.products.manage', 'seller.store.manage'].sort(),
    );
    await staff
      .post('/api/v1/seller/members/invitations')
      .send({ email: uniqueEmail('x'), roles: ['SELLER_ENCODER'] })
      .expect(403);
  });

  it('lets an existing customer join with their own password', async () => {
    const { client: boss } = await owner();
    const customer = await createUser(app, { roles: ['CUSTOMER'] });
    await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email: customer.email, roles: ['SELLER_ORDER_PROCESSOR'] })
      .expect(201);
    const token = await invitationToken(customer.email);
    const visitor = await new TestClient(app.getHttpServer(), 'seller').init();
    const preview = sellerInvitationPreviewSchema.parse(
      (await visitor.post('/api/v1/auth/seller-invitations/preview').send({ token }).expect(200))
        .body,
    );
    expect(preview.existingAccount).toBe(true);
    await visitor
      .post('/api/v1/auth/seller-invitations/accept')
      .send({ token, password: 'wrong-password-123' })
      .expect(400);
    await visitor
      .post('/api/v1/auth/seller-invitations/accept')
      .send({ token, password: TEST_PASSWORD })
      .expect(204);

    // The same account now works in both apps, each with its own roles.
    const shop = await (
      await new TestClient(app.getHttpServer(), 'storefront').init()
    ).signIn(customer.email);
    const work = await (
      await new TestClient(app.getHttpServer(), 'seller').init()
    ).signIn(customer.email);
    const shopSession = sessionResponseSchema.parse(
      (await shop.get('/api/v1/auth/session').expect(200)).body,
    );
    expect(shopSession.user.seller).toBeNull();
    const workSession = sessionResponseSchema.parse(
      (await work.get('/api/v1/auth/session').expect(200)).body,
    );
    expect(workSession.user.roles).toEqual(['CUSTOMER', 'SELLER_ORDER_PROCESSOR']);
    // Seller-only endpoints need the Seller Center session, not the storefront one.
    await shop.get('/api/v1/seller/members').expect(403);
  });

  it('refuses people who already work for a seller and marketplace staff', async () => {
    const { client: boss } = await owner();
    const other = await owner();
    let res = await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email: other.user.email, roles: ['SELLER_ENCODER'] })
      .expect(409);
    expect(errorCode(res)).toBe('CONFLICT');
    const staff = await createUser(app, { roles: ['ADMIN'] });
    res = await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email: staff.email, roles: ['SELLER_ENCODER'] })
      .expect(409);
    expect(apiErrorBodySchema.parse(res.body).error.message).toContain('staff');
    await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email: uniqueEmail('y'), roles: ['SELLER_OWNER'] })
      .expect(400);
  });

  it('expires, replaces, resends and revokes invitations', async () => {
    const { client: boss } = await owner();
    const email = uniqueEmail('later');
    await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email, roles: ['SELLER_ENCODER'] })
      .expect(201);
    const first = await invitationToken(email);

    // Inviting again replaces the first link.
    await boss
      .post('/api/v1/seller/members/invitations')
      .send({ email, roles: ['SELLER_INVENTORY'] })
      .expect(201);
    const visitor = await new TestClient(app.getHttpServer(), 'seller').init();
    await visitor
      .post('/api/v1/auth/seller-invitations/preview')
      .send({ token: first })
      .expect(400);

    let team = sellerTeamSchema.parse((await boss.get('/api/v1/seller/members').expect(200)).body);
    const invitation = team.invitations.find((i) => i.email === email)!;
    expect(invitation.roles).toEqual(['SELLER_INVENTORY']);

    // An expired link stops working; resending gives a fresh one.
    await prisma.sellerInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const second = await invitationToken(email);
    await visitor
      .post('/api/v1/auth/seller-invitations/preview')
      .send({ token: second })
      .expect(400);
    team = sellerTeamSchema.parse((await boss.get('/api/v1/seller/members').expect(200)).body);
    expect(team.invitations.find((i) => i.id === invitation.id)?.expired).toBe(true);
    await boss.post(`/api/v1/seller/members/invitations/${invitation.id}/resend`).expect(204);
    const third = await (async () => {
      for (let i = 0; i < 20; i += 1) {
        const token = await invitationToken(email);
        if (token !== second) return token;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('No new invitation email');
    })();
    await visitor
      .post('/api/v1/auth/seller-invitations/preview')
      .send({ token: third })
      .expect(200);

    await boss.delete(`/api/v1/seller/members/invitations/${invitation.id}`).expect(204);
    await visitor
      .post('/api/v1/auth/seller-invitations/preview')
      .send({ token: third })
      .expect(400);
  });

  it('changes roles and permissions, which apply on the next request', async () => {
    const { client: boss } = await owner();
    const { client: staff, member } = await hire(boss, ['SELLER_ENCODER']);
    await staff
      .post('/api/v1/stores')
      .send({ name: 'Not yet', slug: `not-yet-${Date.now()}` })
      .expect(403);

    const updated = sellerMemberSchema.parse(
      (
        await boss
          .patch(`/api/v1/seller/members/${member.id}`)
          .send({ roles: ['SELLER_MANAGER'], permissions: ['seller.profile.manage'] })
          .expect(200)
      ).body,
    );
    expect(updated).toMatchObject({
      roles: ['SELLER_MANAGER'],
      extraPermissions: ['seller.profile.manage'],
    });
    expect([...updated.effectivePermissions].sort()).toEqual(
      [
        'seller.profile.manage',
        'seller.store.manage',
        'seller.members.read',
        'seller.members.manage',
        'seller.products.manage',
        'seller.pricing.manage',
        'seller.inventory.manage',
      ].sort(),
    );
    await staff
      .post('/api/v1/stores')
      .send({ name: 'Now', slug: `now-${Date.now()}` })
      .expect(201);
  });

  it('limits managers to roles below them and permissions they hold', async () => {
    const { client: boss } = await owner();
    const { client: manager, member: managerMember } = await hire(boss, ['SELLER_MANAGER']);
    await manager
      .post('/api/v1/seller/members/invitations')
      .send({ email: uniqueEmail('m1'), roles: ['SELLER_MANAGER'] })
      .expect(403);
    await manager
      .post('/api/v1/seller/members/invitations')
      .send({
        email: uniqueEmail('m2'),
        roles: ['SELLER_ENCODER'],
        permissions: ['seller.profile.manage'],
      })
      .expect(403);
    const { member: encoder } = await hire(manager, ['SELLER_ENCODER'], ['seller.store.manage']);
    await manager
      .patch(`/api/v1/seller/members/${encoder.id}`)
      .send({ roles: ['SELLER_INVENTORY'] })
      .expect(200);

    // Nobody changes the owner or themselves; managers cannot touch other managers.
    const team = sellerTeamSchema.parse(
      (await boss.get('/api/v1/seller/members').expect(200)).body,
    );
    const ownerMember = team.members.find((m) => m.isOwner)!;
    await manager.post(`/api/v1/seller/members/${ownerMember.id}/suspend`).expect(403);
    await manager.post(`/api/v1/seller/members/${managerMember.id}/suspend`).expect(403);
    await boss.post(`/api/v1/seller/members/${ownerMember.id}/suspend`).expect(403);
    expect(team.assignableRoles).toEqual([
      'SELLER_MANAGER',
      'SELLER_ENCODER',
      'SELLER_INVENTORY',
      'SELLER_ORDER_PROCESSOR',
      'SELLER_ACCOUNTING',
    ]);
  });

  it('suspends an employee at once, and reactivates them', async () => {
    const { client: boss } = await owner();
    const { client: staff, member, email } = await hire(boss, ['SELLER_ENCODER']);
    await staff.get('/api/v1/auth/session').expect(200);
    const suspended = sellerMemberSchema.parse(
      (await boss.post(`/api/v1/seller/members/${member.id}/suspend`).expect(200)).body,
    );
    expect(suspended.status).toBe('SUSPENDED');
    await staff.get('/api/v1/auth/session').expect(401);
    const again = await new TestClient(app.getHttpServer(), 'seller').init();
    const res = await again
      .post('/api/v1/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(403);
    expect(errorCode(res)).toBe('FORBIDDEN');

    await boss.post(`/api/v1/seller/members/${member.id}/reactivate`).expect(200);
    await again.post('/api/v1/auth/sign-in').send({ email, password: TEST_PASSWORD }).expect(200);
  });

  it('removes an employee; their account remains but loses seller access', async () => {
    const { client: boss } = await owner();
    const { client: staff, member } = await hire(boss, ['SELLER_ACCOUNTING']);
    await boss.delete(`/api/v1/seller/members/${member.id}`).expect(204);
    await staff.get('/api/v1/auth/session').expect(401);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: member.userId },
      include: { roles: true },
    });
    expect(user.roles).toEqual([]);
    const team = sellerTeamSchema.parse(
      (await boss.get('/api/v1/seller/members').expect(200)).body,
    );
    expect(team.members.some((m) => m.id === member.id)).toBe(false);
    const audit = await prisma.auditLog.findMany({
      where: {
        action: 'seller_member.removed',
        metadata: { path: ['memberId'], equals: member.id },
      },
    });
    expect(audit).toHaveLength(1);
  });

  it('never lets a seller see or manage another seller’s employees', async () => {
    const a = await owner();
    const b = await owner();
    const { member: bStaff } = await hire(b.client, ['SELLER_ENCODER']);
    const teamA = sellerTeamSchema.parse(
      (await a.client.get('/api/v1/seller/members').expect(200)).body,
    );
    expect(teamA.members.some((m) => m.id === bStaff.id)).toBe(false);
    await a.client
      .patch(`/api/v1/seller/members/${bStaff.id}`)
      .send({ roles: ['SELLER_MANAGER'] })
      .expect(404);
    await a.client.post(`/api/v1/seller/members/${bStaff.id}/suspend`).expect(404);
    await a.client.delete(`/api/v1/seller/members/${bStaff.id}`).expect(404);
    const teamB = sellerTeamSchema.parse(
      (await b.client.get('/api/v1/seller/members').expect(200)).body,
    );
    const invitation = await b.client
      .post('/api/v1/seller/members/invitations')
      .send({ email: uniqueEmail('b'), roles: ['SELLER_ENCODER'] })
      .expect(201);
    await a.client
      .delete(`/api/v1/seller/members/invitations/${(invitation.body as { id: string }).id}`)
      .expect(404);
    expect(teamB.members.find((m) => m.id === bStaff.id)?.status).toBe('ACTIVE');
  });

  it('requires a seller session for every seller endpoint', async () => {
    const anonymous = await new TestClient(app.getHttpServer(), 'seller').init();
    await anonymous.get('/api/v1/seller/members').expect(401);
    const { client: adminClient } = await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'root');
    // Even a super admin has no seller to act for.
    const res = await adminClient.get('/api/v1/seller/members').expect(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });
});
