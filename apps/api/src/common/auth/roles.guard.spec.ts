import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser, UserRole } from '@marketplace/shared-types';
import { ApiException } from '../errors/api.exception';
import { Public, Roles } from './auth.decorators';
import { RolesGuard } from './roles.guard';

class TestController {
  closed() {}

  @Roles('FINANCE_ADMIN', 'SUPER_ADMIN')
  finance() {}

  @Public()
  @Roles('ADMIN')
  misconfigured() {}
}

const user = (...roles: UserRole[]): AuthenticatedUser => ({
  id: 'u1',
  sessionId: 's1',
  app: 'admin',
  roles,
  permissions: [],
  accessTokenExpiresAt: new Date().toISOString(),
});

function context(
  handler: (...args: never[]) => unknown,
  principal?: AuthenticatedUser,
  controller: object = TestController,
) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
  } as unknown as ExecutionContext;
}

function expectApiError(fn: () => unknown, status: number, code: string) {
  try {
    fn();
    fail('expected an ApiException');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).getStatus()).toBe(status);
    expect((error as ApiException).code).toBe(code);
  }
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = TestController.prototype;

  it('allows routes without @Roles', () => {
    expect(guard.canActivate(context(proto.closed, user('CUSTOMER')))).toBe(true);
  });

  it('allows users holding any required role', () => {
    expect(guard.canActivate(context(proto.finance, user('SUPER_ADMIN')))).toBe(true);
  });

  it('forbids users without a required role', () => {
    expectApiError(
      () => guard.canActivate(context(proto.finance, user('SELLER_OWNER'))),
      403,
      'FORBIDDEN',
    );
  });

  it('fails closed when @Roles is combined with @Public and no user is present', () => {
    expectApiError(() => guard.canActivate(context(proto.misconfigured)), 401, 'UNAUTHENTICATED');
  });
});
