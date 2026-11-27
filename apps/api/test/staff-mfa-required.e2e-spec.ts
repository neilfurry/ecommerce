import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  mfaSetupResponseSchema,
  sessionResponseSchema,
} from '@marketplace/validation';
import { timeStep, totpAt } from '../src/modules/auth/totp';
import { createUser, TEST_PASSWORD, TestClient } from './auth-helpers';
import { createTestApp } from './test-app';

/**
 * Phase 8: with STAFF_MFA_REQUIRED (always on in production), Admin Console staff can do
 * nothing but turn on two-step verification, see their session and sign out.
 */
describe('Staff two-step verification required (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.STAFF_MFA_REQUIRED = 'true';
    app = await createTestApp();
  });

  afterAll(async () => {
    delete process.env.STAFF_MFA_REQUIRED;
    await app.close();
  });

  it('blocks the Admin Console until an authenticator app is set up', async () => {
    const user = await createUser(app, { roles: ['ADMIN'], label: 'mfa-required' });
    const client = await (
      await new TestClient(app.getHttpServer(), 'admin').init()
    ).signIn(user.email);

    const before = sessionResponseSchema.parse(
      (await client.get('/api/v1/auth/session').expect(200)).body,
    );
    expect(before.user.mfaEnrollmentRequired).toBe(true);
    const blocked = await client.get('/api/v1/users').expect(403);
    expect(apiErrorBodySchema.parse(blocked.body).error.code).toBe('MFA_ENROLLMENT_REQUIRED');

    const setup = mfaSetupResponseSchema.parse(
      (
        await client
          .post('/api/v1/auth/mfa/totp/setup')
          .send({ password: TEST_PASSWORD })
          .expect(200)
      ).body,
    );
    await client
      .post('/api/v1/auth/mfa/totp/enable')
      .send({ code: totpAt(setup.secret, timeStep(Date.now()) - 1) })
      .expect(200);

    // Effective at once (the cached principal is invalidated), no new sign-in needed.
    await client.get('/api/v1/users').expect(200);
    const after = sessionResponseSchema.parse(
      (await client.get('/api/v1/auth/session').expect(200)).body,
    );
    expect(after.user.mfaEnrollmentRequired).toBe(false);
  });

  it('does not apply to customers or the Seller Center', async () => {
    const customer = await createUser(app, { roles: ['CUSTOMER'], label: 'mfa-customer' });
    const client = await (
      await new TestClient(app.getHttpServer(), 'storefront').init()
    ).signIn(customer.email);
    await client.get('/api/v1/account/addresses').expect(200);
    const session = sessionResponseSchema.parse(
      (await client.get('/api/v1/auth/session').expect(200)).body,
    );
    expect(session.user.mfaEnrollmentRequired).toBe(false);
  });
});
