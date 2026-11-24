import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  mfaChallengeResponseSchema,
  mfaRecoveryCodesSchema,
  mfaSetupResponseSchema,
  mfaStatusSchema,
  permissionListSchema,
  sessionResponseSchema,
} from '@marketplace/validation';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AccessTokenService } from '../src/modules/auth/access-token.service';
import { timeStep, totpAt } from '../src/modules/auth/totp';
import { createUser, randomIp, signedInClient, TEST_PASSWORD, TestClient } from './auth-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

/** Optional two-step verification, token expiry and the permission catalog. */
describe('Two-step verification and tokens (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Turns MFA on for a fresh admin and returns the secret and recovery codes. */
  async function enrolled() {
    const user = await createUser(app, { roles: ['ADMIN'], label: 'mfa' });
    const client = await (
      await new TestClient(app.getHttpServer(), 'admin').init()
    ).signIn(user.email);
    await client.post('/api/v1/auth/mfa/totp/setup').send({ password: 'wrong' }).expect(400);
    const setup = mfaSetupResponseSchema.parse(
      (
        await client
          .post('/api/v1/auth/mfa/totp/setup')
          .send({ password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Marketplace%3A/);
    // Not on until confirmed with a code.
    expect(
      mfaStatusSchema.parse((await client.get('/api/v1/auth/mfa').expect(200)).body).enabled,
    ).toBe(false);
    await client.post('/api/v1/auth/mfa/totp/enable').send({ code: '000000' }).expect(400);
    // Use the previous time step for set-up so the current one stays free for sign-in.
    const step = timeStep(Date.now());
    const { recoveryCodes } = mfaRecoveryCodesSchema.parse(
      (
        await client
          .post('/api/v1/auth/mfa/totp/enable')
          .send({ code: totpAt(setup.secret, step - 1) })
          .expect(200)
      ).body,
    );
    expect(recoveryCodes).toHaveLength(10);
    return { user, client, secret: setup.secret, recoveryCodes };
  }

  async function startSignIn(email: string) {
    const client = await new TestClient(app.getHttpServer(), 'admin').init();
    const res = await client
      .post('/api/v1/auth/sign-in')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return { client, challenge: mfaChallengeResponseSchema.parse(res.body), res };
  }

  it('asks for the authenticator code after the password, then signs in', async () => {
    const { user, secret, client: first } = await enrolled();
    expect(
      mfaStatusSchema.parse((await first.get('/api/v1/auth/mfa').expect(200)).body),
    ).toMatchObject({
      enabled: true,
      recoveryCodesRemaining: 10,
    });
    const { client, challenge, res } = await startSignIn(user.email);
    // No session yet: no cookies were set.
    expect(
      (res.headers['set-cookie'] as unknown as string[] | undefined)?.some((c) =>
        c.startsWith('mp_admin_at'),
      ),
    ).toBeFalsy();
    await client.get('/api/v1/auth/session').expect(401);

    const wrong = await client
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, code: '123456' });
    expect(errorCode(wrong)).toBe('OTP_INVALID');
    const code = totpAt(secret, timeStep(Date.now()));
    const session = sessionResponseSchema.parse(
      (
        await client
          .post('/api/v1/auth/mfa/verify')
          .send({ mfaToken: challenge.mfaToken, code })
          .expect(200)
      ).body,
    );
    expect(session.user).toMatchObject({ id: user.id, mfaEnabled: true });
    await client.get('/api/v1/auth/session').expect(200);

    // The token is single use, and the same code cannot be replayed.
    await client
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, code })
      .expect(400);
    const again = await startSignIn(user.email);
    const replay = await again.client
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: again.challenge.mfaToken, code });
    expect(errorCode(replay)).toBe('OTP_INVALID');
  });

  it('accepts each recovery code once', async () => {
    const { user, recoveryCodes, client: settings } = await enrolled();
    const { client, challenge } = await startSignIn(user.email);
    await client
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, code: recoveryCodes[0]!.toLowerCase() })
      .expect(200);
    const second = await startSignIn(user.email);
    await second.client
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: second.challenge.mfaToken, code: recoveryCodes[0] })
      .expect(400);
    expect(
      mfaStatusSchema.parse((await settings.get('/api/v1/auth/mfa').expect(200)).body)
        .recoveryCodesRemaining,
    ).toBe(9);
    // Codes are stored hashed only.
    const stored = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(stored.some((c) => recoveryCodes.includes(c.codeHash))).toBe(false);
    const mfa = await prisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } });
    expect(mfa.totpSecretEncrypted).not.toContain(user.email);
  });

  it('ends the attempt after five wrong codes', async () => {
    const { user } = await enrolled();
    const { client, challenge } = await startSignIn(user.email);
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      codes.push(
        errorCode(
          await client
            .post('/api/v1/auth/mfa/verify')
            .send({ mfaToken: challenge.mfaToken, code: '000000' }),
        ),
      );
    }
    expect(codes).toEqual([
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_TOO_MANY_ATTEMPTS',
    ]);
    expect(
      errorCode(
        await client
          .post('/api/v1/auth/mfa/verify')
          .send({ mfaToken: challenge.mfaToken, code: '000000' }),
      ),
    ).toBe('OTP_EXPIRED');
  });

  it('can be turned off by the user (password + code) or reset by an admin', async () => {
    const { user, client, recoveryCodes } = await enrolled();
    await client
      .post('/api/v1/auth/mfa/disable')
      .send({ password: TEST_PASSWORD, code: '000000' })
      .expect(400);
    await client
      .post('/api/v1/auth/mfa/disable')
      .send({ password: TEST_PASSWORD, code: recoveryCodes[1] })
      .expect(204);
    const plain = await new TestClient(app.getHttpServer(), 'admin').init();
    const res = await plain
      .post('/api/v1/auth/sign-in')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    expect(sessionResponseSchema.safeParse(res.body).success).toBe(true);

    const second = await enrolled();
    const { client: root } = await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'root');
    await root.post(`/api/v1/users/${second.user.id}/mfa/reset`).expect(204);
    // The account is signed out everywhere and signs in with the password alone.
    await second.client.get('/api/v1/auth/session').expect(401);
    const after = await new TestClient(app.getHttpServer(), 'admin').init();
    const signIn = await after
      .post('/api/v1/auth/sign-in')
      .send({ email: second.user.email, password: TEST_PASSWORD })
      .expect(200);
    expect(sessionResponseSchema.safeParse(signIn.body).success).toBe(true);
    const audit = await prisma.auditLog.count({
      where: { action: 'mfa.reset_by_admin', entityId: second.user.id },
    });
    expect(audit).toBe(1);
  });

  describe('access tokens', () => {
    it('answers TOKEN_EXPIRED once the 15-minute access token has expired', async () => {
      const user = await createUser(app, { roles: ['ADMIN'] });
      const client = await (
        await new TestClient(app.getHttpServer(), 'admin').init()
      ).signIn(user.email);
      const session = await prisma.session.findFirstOrThrow({
        where: { userId: user.id, revokedAt: null },
      });
      const expired = app
        .get(AccessTokenService)
        .issue(
          { userId: user.id, sessionId: session.id, app: 'admin' },
          Date.now() - 16 * 60_000,
        ).token;
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/session')
        .set('X-Client-App', 'admin')
        .set('X-Forwarded-For', randomIp())
        .set('Cookie', `mp_admin_at=${expired}`)
        .expect(401);
      expect(errorCode(res)).toBe('TOKEN_EXPIRED');
      // The refresh token still renews the session.
      await client.post('/api/v1/auth/refresh').expect(200);
    });

    it('rejects forged and missing tokens', async () => {
      const send = (cookie?: string) => {
        const test = request(app.getHttpServer()).get('/api/v1/users').set('X-Client-App', 'admin');
        return cookie ? test.set('Cookie', cookie) : test;
      };
      expect(errorCode(await send().expect(401))).toBe('UNAUTHENTICATED');
      expect(
        errorCode(await send('mp_admin_at=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.').expect(401)),
      ).toBe('UNAUTHENTICATED');
    });
  });

  describe('permission catalog', () => {
    it('lists platform and seller permissions with the roles holding them', async () => {
      const { client } = await signedInClient(app, 'admin', ['ADMIN'], 'catalog');
      const { permissions } = permissionListSchema.parse(
        (await client.get('/api/v1/permissions').expect(200)).body,
      );
      expect(permissions.find((p) => p.code === 'sellers.review')).toMatchObject({
        scope: 'platform',
      });
      expect(permissions.find((p) => p.code === 'seller.store.manage')).toMatchObject({
        scope: 'seller',
        roles: expect.arrayContaining(['SELLER_OWNER', 'SELLER_MANAGER']),
      });
    });

    it('keeps seller permissions away from platform roles and vice versa', async () => {
      const { client: root } = await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'root');
      await root
        .put('/api/v1/roles/WAREHOUSE_STAFF/permissions')
        .send({ permissions: ['seller.store.manage'] })
        .expect(400);
      await root
        .put('/api/v1/roles/SELLER_ENCODER/permissions')
        .send({ permissions: ['users.read'] })
        .expect(400);
      await root
        .put('/api/v1/roles/SELLER_OWNER/permissions')
        .send({ permissions: [] })
        .expect(403);
      await root
        .put('/api/v1/roles/CUSTOMER/permissions')
        .send({ permissions: ['users.read'] })
        .expect(400);
    });
  });
});
