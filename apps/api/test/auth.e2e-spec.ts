import { EMAIL_JOBS } from '@marketplace/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  otpChallengeResponseSchema,
  sessionResponseSchema,
} from '@marketplace/validation';
import request, { type Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  createUser,
  latestEmailToken,
  latestOtp,
  randomIp,
  randomMobile,
  TEST_PASSWORD,
  TestClient,
  uniqueEmail,
} from './auth-helpers';
import { createTestApp } from './test-app';

const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;

function cookiesOf(res: Response): Map<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const map = new Map<string, string>();
  for (const cookie of raw ?? []) {
    const [pair] = cookie.split(';');
    const index = pair!.indexOf('=');
    map.set(pair!.slice(0, index), pair!.slice(index + 1));
  }
  return map;
}

/** Customer and staff authentication against real PostgreSQL and Redis. */
describe('Authentication (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const client = (clientApp: 'storefront' | 'seller' | 'admin' = 'storefront') =>
    new TestClient(app.getHttpServer(), clientApp).init();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CSRF', () => {
    it('issues a token and sets the matching HttpOnly cookie', async () => {
      const res = await new TestClient(app.getHttpServer(), 'storefront').agent
        .get('/api/v1/auth/csrf')
        .expect(200);
      expect(res.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('mp_csrf='),
      );
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('rejects sign-in without the X-CSRF-Token header', async () => {
      const c = await client();
      const res = await c.agent
        .post('/api/v1/auth/sign-in')
        .set('X-Client-App', 'storefront')
        .set('X-Forwarded-For', c.ip)
        .send({ email: 'x@example.com', password: 'whatever-password' })
        .expect(403);
      expect(errorCode(res)).toBe('CSRF_FAILED');
    });
  });

  describe('customer sign-up', () => {
    const signUpBody = (overrides: Record<string, unknown> = {}) => ({
      firstName: 'Maria',
      lastName: 'Santos',
      email: uniqueEmail('signup'),
      mobile: randomMobile(),
      password: TEST_PASSWORD,
      ...overrides,
    });

    it('creates a retail customer after the SMS code is confirmed, then verifies the email', async () => {
      const c = await client();
      const body = signUpBody({ mobile: '0917' + randomMobile().slice(-7) });
      const start = await c.post('/api/v1/auth/customers/sign-up').send(body).expect(202);
      const challenge = otpChallengeResponseSchema.parse(start.body);
      const normalized = `+63${(body.mobile as string).slice(1)}`;
      expect(challenge.destination).toBe(
        `+63 ${normalized.slice(3, 6)} *** ${normalized.slice(-4)}`,
      );

      // No account exists until the code is confirmed.
      expect(await prisma.user.count({ where: { email: body.email as string } })).toBe(0);

      const code = await latestOtp(app, normalized);
      const done = await c
        .post('/api/v1/auth/customers/sign-up/verify')
        .send({ challengeId: challenge.challengeId, code })
        .expect(201);
      const session = sessionResponseSchema.parse(done.body);
      expect(session.app).toBe('storefront');
      expect(session.user).toMatchObject({
        email: body.email,
        mobile: normalized,
        mobileVerified: true,
        emailVerified: false,
        roles: ['CUSTOMER'],
        wholesaleStatus: null,
      });
      const cookies = cookiesOf(done);
      expect(cookies.has('mp_storefront_at')).toBe(true);
      expect(cookies.has('mp_storefront_rt')).toBe(true);
      // The password hash never leaves the server.
      expect(JSON.stringify(done.body)).not.toMatch(/argon|passwordHash/i);

      // The same code cannot be used twice.
      const replay = await c
        .post('/api/v1/auth/customers/sign-up/verify')
        .send({ challengeId: challenge.challengeId, code })
        .expect(400);
      expect(['OTP_INVALID', 'OTP_EXPIRED']).toContain(errorCode(replay));

      const token = await latestEmailToken(app, EMAIL_JOBS.VERIFY_ADDRESS, body.email as string);
      await c.post('/api/v1/auth/email/verify').send({ token }).expect(204);
      const me = sessionResponseSchema.parse(
        (await c.get('/api/v1/auth/session').expect(200)).body,
      );
      expect(me.user.emailVerified).toBe(true);
      // Links work once.
      await c.post('/api/v1/auth/email/verify').send({ token }).expect(400);
    });

    it('records a pending wholesale application for wholesale sign-ups', async () => {
      const c = await client();
      const body = signUpBody({
        accountType: 'WHOLESALE',
        business: {
          businessName: 'Sari-Sari Trading',
          tin: '123-456-789-000',
          businessAddress: '12 Rizal St, Quezon City',
        },
      });
      const challenge = otpChallengeResponseSchema.parse(
        (await c.post('/api/v1/auth/customers/sign-up').send(body).expect(202)).body,
      );
      const code = await latestOtp(app, body.mobile as string);
      const session = sessionResponseSchema.parse(
        (
          await c
            .post('/api/v1/auth/customers/sign-up/verify')
            .send({ challengeId: challenge.challengeId, code })
            .expect(201)
        ).body,
      );
      // Retail access immediately; wholesale only after approval.
      expect(session.user.roles).toEqual(['CUSTOMER']);
      expect(session.user.wholesaleStatus).toBe('PENDING');
    });

    it('requires business details for wholesale sign-ups', async () => {
      const c = await client();
      const res = await c
        .post('/api/v1/auth/customers/sign-up')
        .send(signUpBody({ accountType: 'WHOLESALE' }))
        .expect(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });

    it('rejects an email or mobile number that is already registered', async () => {
      const existing = await createUser(app, { roles: ['CUSTOMER'] });
      const c = await client();
      const res = await c
        .post('/api/v1/auth/customers/sign-up')
        .send(signUpBody({ email: existing.email, mobile: existing.mobile }))
        .expect(409);
      const fields = apiErrorBodySchema.parse(res.body).error.fieldErrors?.map((f) => f.path);
      expect(fields).toEqual(expect.arrayContaining(['email', 'mobile']));
    });

    it('refuses sign-up from the staff apps', async () => {
      const c = await client('admin');
      await c.post('/api/v1/auth/customers/sign-up').send(signUpBody()).expect(400);
    });

    it('locks a code after too many wrong attempts', async () => {
      const c = await client();
      const body = signUpBody();
      const challenge = otpChallengeResponseSchema.parse(
        (await c.post('/api/v1/auth/customers/sign-up').send(body).expect(202)).body,
      );
      const code = await latestOtp(app, body.mobile as string);
      const wrong = code === '000000' ? '111111' : '000000';
      const codes: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await c
          .post('/api/v1/auth/customers/sign-up/verify')
          .send({ challengeId: challenge.challengeId, code: wrong });
        codes.push(errorCode(res));
      }
      expect(codes.slice(0, 4)).toEqual([
        'OTP_INVALID',
        'OTP_INVALID',
        'OTP_INVALID',
        'OTP_INVALID',
      ]);
      expect(codes[4]).toBe('OTP_TOO_MANY_ATTEMPTS');
      // Even the right code no longer works.
      const res = await c
        .post('/api/v1/auth/customers/sign-up/verify')
        .send({ challengeId: challenge.challengeId, code });
      expect(res.status).toBe(400);
    });

    it('enforces the resend cooldown', async () => {
      const c = await client();
      const challenge = otpChallengeResponseSchema.parse(
        (await c.post('/api/v1/auth/customers/sign-up').send(signUpBody()).expect(202)).body,
      );
      const res = await c
        .post('/api/v1/auth/otp/resend')
        .send({ challengeId: challenge.challengeId })
        .expect(429);
      expect(errorCode(res)).toBe('RATE_LIMITED');
    });
  });

  describe('customer sign-in with mobile number and SMS code', () => {
    it('signs in a customer with a verified mobile number', async () => {
      const customer = await createUser(app, { roles: ['CUSTOMER'] });
      const c = await client();
      const challenge = otpChallengeResponseSchema.parse(
        (
          await c
            .post('/api/v1/auth/customers/sign-in/otp')
            .send({ mobile: customer.mobile })
            .expect(202)
        ).body,
      );
      const code = await latestOtp(app, customer.mobile!);
      const session = sessionResponseSchema.parse(
        (
          await c
            .post('/api/v1/auth/customers/sign-in/otp/verify')
            .send({ challengeId: challenge.challengeId, code })
            .expect(200)
        ).body,
      );
      expect(session.user.id).toBe(customer.id);
    });

    it('answers the same for unknown numbers but sends nothing', async () => {
      const c = await client();
      const mobile = randomMobile();
      const res = await c.post('/api/v1/auth/customers/sign-in/otp').send({ mobile }).expect(202);
      expect(otpChallengeResponseSchema.safeParse(res.body).success).toBe(true);
      await expect(latestOtp(app, mobile)).rejects.toThrow('No notifications job matched');
    });
  });

  describe('email and password sign-in', () => {
    it('signs staff in to the Admin Console and customers to the storefront only', async () => {
      const admin = await createUser(app, { roles: ['ADMIN'] });
      const res = await (
        await client('admin')
      )
        .post('/api/v1/auth/sign-in')
        .send({ email: admin.email, password: TEST_PASSWORD })
        .expect(200);
      expect(sessionResponseSchema.parse(res.body).user.permissions).toContain('users.read');

      const customer = await createUser(app, { roles: ['CUSTOMER'] });
      const wrongApp = await (
        await client('admin')
      )
        .post('/api/v1/auth/sign-in')
        .send({ email: customer.email, password: TEST_PASSWORD })
        .expect(403);
      expect(errorCode(wrongApp)).toBe('FORBIDDEN');

      const seller = await createUser(app, { roles: ['SELLER_OWNER'] });
      await (
        await client('seller')
      )
        .post('/api/v1/auth/sign-in')
        .send({ email: seller.email, password: TEST_PASSWORD })
        .expect(200);
      await (
        await client('storefront')
      )
        .post('/api/v1/auth/sign-in')
        .send({ email: seller.email, password: TEST_PASSWORD })
        .expect(403);
    });

    it('gives the same answer for an unknown email and a wrong password', async () => {
      const user = await createUser(app, { roles: ['ADMIN'] });
      const c = await client('admin');
      const unknown = await c
        .post('/api/v1/auth/sign-in')
        .send({ email: uniqueEmail('nobody'), password: TEST_PASSWORD })
        .expect(401);
      const wrong = await c
        .post('/api/v1/auth/sign-in')
        .send({ email: user.email, password: 'not-the-password' })
        .expect(401);
      expect(errorCode(unknown)).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('locks the account after five wrong passwords', async () => {
      const user = await createUser(app, { roles: ['ADMIN'] });
      const c = await client('admin');
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        statuses.push(
          (await c.post('/api/v1/auth/sign-in').send({ email: user.email, password: `wrong-${i}` }))
            .status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 401, 423]);
      // Locked even with the right password.
      const res = await c
        .post('/api/v1/auth/sign-in')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(423);
      expect(errorCode(res)).toBe('ACCOUNT_LOCKED');
    });

    it('refuses suspended accounts and customers whose email is unverified', async () => {
      const suspended = await createUser(app, { roles: ['ADMIN'], status: 'SUSPENDED' });
      const res = await (
        await client('admin')
      )
        .post('/api/v1/auth/sign-in')
        .send({ email: suspended.email, password: TEST_PASSWORD })
        .expect(403);
      expect(errorCode(res)).toBe('ACCOUNT_SUSPENDED');

      const unverified = await createUser(app, { roles: ['CUSTOMER'], emailVerified: false });
      const res2 = await (
        await client()
      )
        .post('/api/v1/auth/sign-in')
        .send({ email: unverified.email, password: TEST_PASSWORD })
        .expect(403);
      expect(errorCode(res2)).toBe('EMAIL_NOT_VERIFIED');
    });

    it('rate-limits sign-in attempts per address', async () => {
      const c = await client('admin');
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        statuses.push(
          (
            await c
              .post('/api/v1/auth/sign-in')
              .send({ email: uniqueEmail('flood'), password: 'x' })
          ).status,
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it('records sign-ins in the audit log without secrets', async () => {
      const user = await createUser(app, { roles: ['ADMIN'] });
      const c = await client('admin');
      await c
        .post('/api/v1/auth/sign-in')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      const entries = await prisma.auditLog.findMany({
        where: { actorId: user.id, action: 'auth.sign_in' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: 'SUCCESS', ipAddress: c.ip });
      expect(JSON.stringify(entries[0]!.metadata)).not.toContain(TEST_PASSWORD);
    });
  });

  describe('sessions', () => {
    async function signedIn() {
      const user = await createUser(app, { roles: ['CUSTOMER'] });
      const c = await client();
      const res = await c
        .post('/api/v1/auth/sign-in')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      return { user, c, refreshToken: cookiesOf(res).get('mp_storefront_rt')! };
    }

    /** Sends a refresh token from a fresh cookie jar (not the signed-in client's). */
    function replayRefresh(refreshToken: string) {
      const csrf = 'replayed-csrf-token-0123456789abcdefghijklmn';
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-Client-App', 'storefront')
        .set('X-Forwarded-For', randomIp())
        .set('X-CSRF-Token', csrf)
        .set('Cookie', [`mp_storefront_rt=${refreshToken}`, `mp_csrf=${csrf}`]);
    }

    it('rotates the refresh token on every refresh', async () => {
      const { c, refreshToken } = await signedIn();
      const res = await c.post('/api/v1/auth/refresh').expect(200);
      const next = cookiesOf(res).get('mp_storefront_rt');
      expect(next).toBeDefined();
      expect(next).not.toBe(refreshToken);
      await c.get('/api/v1/auth/session').expect(200);
    });

    it('treats a reused refresh token as theft and ends the whole sign-in', async () => {
      const { user, c, refreshToken } = await signedIn();
      await c.post('/api/v1/auth/refresh').expect(200);
      // Move the rotation outside the 10-second grace period for concurrent tabs.
      await prisma.session.updateMany({
        where: { userId: user.id, revokedReason: 'ROTATED' },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      // A stolen copy of the old token, replayed from another machine.
      const res = await replayRefresh(refreshToken).expect(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
      // The legitimate device is signed out too.
      await c.get('/api/v1/auth/session').expect(401);
      await c.post('/api/v1/auth/refresh').expect(401);
    });

    it('answers 409 when two tabs refresh with the same token at once', async () => {
      const { c, refreshToken } = await signedIn();
      await c.post('/api/v1/auth/refresh').expect(200);
      // Another tab still holding the previous token.
      const res = await replayRefresh(refreshToken).expect(409);
      expect(errorCode(res)).toBe('CONFLICT');
    });

    it('signs out this device', async () => {
      const { c } = await signedIn();
      await c.post('/api/v1/auth/sign-out').expect(204);
      await c.get('/api/v1/auth/session').expect(401);
      await c.post('/api/v1/auth/refresh').expect(401);
    });

    it('signs out every device', async () => {
      const user = await createUser(app, { roles: ['CUSTOMER'] });
      const phone = await (await client()).signIn(user.email);
      const laptop = await (await client()).signIn(user.email);
      await laptop.post('/api/v1/auth/sign-out-everywhere').expect(204);
      await phone.get('/api/v1/auth/session').expect(401);
      await laptop.get('/api/v1/auth/session').expect(401);
    });

    it('keeps app sessions separate in the same browser', async () => {
      const user = await createUser(app, { roles: ['SUPER_ADMIN'] });
      const c = await client('admin');
      await c.signIn(user.email);
      // Same cookie jar, different app header: no storefront session exists.
      const res = await c.agent
        .get('/api/v1/auth/session')
        .set('X-Client-App', 'storefront')
        .set('X-Forwarded-For', c.ip);
      expect(res.status).toBe(401);
    });
  });

  describe('passwords', () => {
    it('resets a forgotten password and signs out every device', async () => {
      const user = await createUser(app, { roles: ['CUSTOMER'] });
      const before = await (await client()).signIn(user.email);
      const c = await client();
      await c.post('/api/v1/auth/password/forgot').send({ email: user.email }).expect(202);
      // Unknown addresses get the same answer.
      await c
        .post('/api/v1/auth/password/forgot')
        .send({ email: uniqueEmail('ghost') })
        .expect(202);

      const token = await latestEmailToken(app, EMAIL_JOBS.PASSWORD_RESET, user.email);
      const newPassword = 'A-brand-new-password-2026';
      await c
        .post('/api/v1/auth/password/reset')
        .send({ token, password: newPassword })
        .expect(204);
      await before.get('/api/v1/auth/session').expect(401);
      await c
        .post('/api/v1/auth/sign-in')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(401);
      await c
        .post('/api/v1/auth/sign-in')
        .send({ email: user.email, password: newPassword })
        .expect(200);
      await c
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'Yet-another-password-1' })
        .expect(400);
    });

    it('changes the password, keeping this device and signing out the others', async () => {
      const user = await createUser(app, { roles: ['ADMIN'] });
      const other = await (await client('admin')).signIn(user.email);
      const c = await (await client('admin')).signIn(user.email);
      await c
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: 'wrong', newPassword: 'Changed-password-2026' })
        .expect(400);
      await c
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'Changed-password-2026' })
        .expect(204);
      await c.get('/api/v1/auth/session').expect(200);
      await other.get('/api/v1/auth/session').expect(401);
    });

    it('enforces the password policy', async () => {
      const c = await client();
      const res = await c
        .post('/api/v1/auth/customers/sign-up')
        .send({
          firstName: 'A',
          lastName: 'B',
          email: uniqueEmail('weak'),
          mobile: randomMobile(),
          password: 'short',
        })
        .expect(400);
      expect(apiErrorBodySchema.parse(res.body).error.fieldErrors?.map((f) => f.path)).toContain(
        'password',
      );
    });
  });
});
