import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser, ClientApp } from '@marketplace/shared-types';
import { Public, RequirePermissions, SkipCsrf } from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';
import type { AppConfig } from '../../../config/app-config';
import { AccessTokenService } from '../access-token.service';
import type { Principal, PrincipalService } from '../principal.service';
import type { SessionsService } from '../sessions.service';
import { AuthenticationGuard } from './authentication.guard';
import { CsrfGuard } from './csrf.guard';
import { PermissionsGuard } from './permissions.guard';

// The guard's collaborators are replaced by fakes below; keep the Prisma client out of this unit test.
jest.mock('../../../infrastructure/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

class TestController {
  @Public()
  open() {}

  closed() {}

  @RequirePermissions('users.read', 'users.update')
  editUsers() {}

  @SkipCsrf()
  @Public()
  webhook() {}
}
const proto = TestController.prototype;

interface FakeRequest {
  method?: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  user?: AuthenticatedUser;
}

function context(handler: (...args: never[]) => unknown, request: FakeRequest) {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function expectApiError(fn: () => unknown, status: number, code: string) {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiException);
  expect((caught as ApiException).getStatus()).toBe(status);
  expect((caught as ApiException).code).toBe(code);
}

const config = {
  auth: { jwtSecret: 'unit-test-jwt-secret-with-enough-length', accessTokenTtlSeconds: 900 },
} as AppConfig;

describe('AuthenticationGuard', () => {
  const tokens = new AccessTokenService(config);
  let revoked: boolean;
  let principal: Principal | null;
  let guard: AuthenticationGuard;

  beforeEach(() => {
    revoked = false;
    principal = { userId: 'u1', status: 'ACTIVE', roles: ['ADMIN'], permissions: ['users.read'] };
    const sessions = { isRevoked: jest.fn(async () => revoked) } as unknown as SessionsService;
    const principals = { load: jest.fn(async () => principal) } as unknown as PrincipalService;
    guard = new AuthenticationGuard(new Reflector(), tokens, sessions, principals);
  });

  const request = (app: ClientApp, token?: string): FakeRequest => ({
    headers: { 'x-client-app': app },
    cookies: token ? { [`mp_${app}_at`]: token } : {},
  });
  const adminToken = (now = Date.now()) =>
    tokens.issue({ userId: 'u1', sessionId: 's1', app: 'admin' }, now).token;

  it('lets public routes through without a session', async () => {
    await expect(guard.canActivate(context(proto.open, request('storefront')))).resolves.toBe(true);
  });

  it('rejects protected routes without a session (secure by default)', async () => {
    await expectApiError(
      () => guard.canActivate(context(proto.closed, request('admin'))),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('resolves the user, roles and permissions from a valid access token', async () => {
    const req = request('admin', adminToken());
    await expect(guard.canActivate(context(proto.closed, req))).resolves.toBe(true);
    expect(req.user).toMatchObject({
      id: 'u1',
      sessionId: 's1',
      app: 'admin',
      roles: ['ADMIN'],
      permissions: ['users.read'],
    });
  });

  it('answers TOKEN_EXPIRED for an expired token so the client can refresh', async () => {
    const req = request('admin', adminToken(Date.now() - 3_600_000));
    await expectApiError(() => guard.canActivate(context(proto.closed, req)), 401, 'TOKEN_EXPIRED');
  });

  it('rejects a token issued for a different app', async () => {
    const storefrontToken = tokens.issue({
      userId: 'u1',
      sessionId: 's1',
      app: 'storefront',
    }).token;
    const req: FakeRequest = {
      headers: { 'x-client-app': 'admin' },
      cookies: { mp_admin_at: storefrontToken },
    };
    await expectApiError(
      () => guard.canActivate(context(proto.closed, req)),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('rejects a tampered token', async () => {
    const token = adminToken();
    const tampered = `${token.slice(0, -2)}xx`;
    await expectApiError(
      () => guard.canActivate(context(proto.closed, request('admin', tampered))),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('rejects revoked sessions immediately', async () => {
    revoked = true;
    await expectApiError(
      () => guard.canActivate(context(proto.closed, request('admin', adminToken()))),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('rejects suspended users immediately', async () => {
    principal = { ...principal!, status: 'SUSPENDED' };
    await expectApiError(
      () => guard.canActivate(context(proto.closed, request('admin', adminToken()))),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('rejects users who no longer hold a role allowed in the app', async () => {
    principal = { ...principal!, roles: ['CUSTOMER'] };
    await expectApiError(
      () => guard.canActivate(context(proto.closed, request('admin', adminToken()))),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('ignores cookies when the X-Client-App header is missing or unknown', async () => {
    const req: FakeRequest = {
      headers: { 'x-client-app': 'evil' },
      cookies: { mp_admin_at: adminToken() },
    };
    await expectApiError(
      () => guard.canActivate(context(proto.closed, req)),
      401,
      'UNAUTHENTICATED',
    );
  });
});

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());
  const withPermissions = (...permissions: AuthenticatedUser['permissions']): FakeRequest => ({
    headers: {},
    cookies: {},
    user: {
      id: 'u1',
      sessionId: 's1',
      app: 'admin',
      roles: ['ADMIN'],
      permissions,
      accessTokenExpiresAt: '',
    },
  });

  it('allows routes without @RequirePermissions', () => {
    expect(guard.canActivate(context(proto.closed, withPermissions()))).toBe(true);
  });

  it('requires every listed permission', async () => {
    expect(
      guard.canActivate(context(proto.editUsers, withPermissions('users.read', 'users.update'))),
    ).toBe(true);
    await expectApiError(
      () => guard.canActivate(context(proto.editUsers, withPermissions('users.read'))),
      403,
      'FORBIDDEN',
    );
  });

  it('fails closed without a user', async () => {
    await expectApiError(
      () => guard.canActivate(context(proto.editUsers, { headers: {}, cookies: {} })),
      401,
      'UNAUTHENTICATED',
    );
  });
});

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector());
  const req = (method: string, cookie?: string, header?: string): FakeRequest => ({
    method,
    headers: header ? { 'x-csrf-token': header } : {},
    cookies: cookie ? { mp_csrf: cookie } : {},
  });

  it('does not check safe methods', () => {
    expect(guard.canActivate(context(proto.closed, req('GET')))).toBe(true);
  });

  it('accepts a matching cookie and header', () => {
    expect(guard.canActivate(context(proto.closed, req('POST', 'token-123', 'token-123')))).toBe(
      true,
    );
  });

  it.each([
    ['missing header', 'token-123', undefined],
    ['missing cookie', undefined, 'token-123'],
    ['mismatch', 'token-123', 'token-456'],
  ])('rejects state-changing requests with a %s', async (_label, cookie, header) => {
    await expectApiError(
      () => guard.canActivate(context(proto.closed, req('DELETE', cookie, header))),
      403,
      'CSRF_FAILED',
    );
  });

  it('honours @SkipCsrf()', () => {
    expect(guard.canActivate(context(proto.webhook, req('POST')))).toBe(true);
  });
});
