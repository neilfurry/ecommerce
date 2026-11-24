import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import { ApiException } from '../errors/api.exception';
import { Public, Roles } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

class TestController {
  @Public()
  open() {}

  closed() {}

  @Roles('FINANCE_ADMIN', 'SUPER_ADMIN')
  finance() {}

  @Public()
  @Roles('ADMIN')
  misconfigured() {}
}

@Public()
class PublicController {
  anything() {}
}

function context(
  handler: (...args: never[]) => unknown,
  user?: AuthenticatedUser,
  controller: object = TestController,
) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
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

describe('AuthGuard', () => {
  const guard = new AuthGuard(new Reflector());
  const proto = TestController.prototype;

  it('lets @Public() routes through without a user', () => {
    expect(guard.canActivate(context(proto.open))).toBe(true);
  });

  it('honours @Public() on the controller class', () => {
    expect(
      guard.canActivate(context(PublicController.prototype.anything, undefined, PublicController)),
    ).toBe(true);
  });

  it('rejects other routes without a user (secure by default)', () => {
    expectApiError(() => guard.canActivate(context(proto.closed)), 401, 'UNAUTHENTICATED');
  });

  it('accepts authenticated users', () => {
    expect(guard.canActivate(context(proto.closed, { id: 'u1', roles: ['CUSTOMER'] }))).toBe(true);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = TestController.prototype;

  it('allows routes without @Roles', () => {
    expect(guard.canActivate(context(proto.closed, { id: 'u1', roles: ['CUSTOMER'] }))).toBe(true);
  });

  it('allows users holding any required role', () => {
    expect(guard.canActivate(context(proto.finance, { id: 'u1', roles: ['SUPER_ADMIN'] }))).toBe(
      true,
    );
  });

  it('forbids users without a required role', () => {
    expectApiError(
      () => guard.canActivate(context(proto.finance, { id: 'u1', roles: ['SELLER_OWNER'] })),
      403,
      'FORBIDDEN',
    );
  });

  it('fails closed when @Roles is combined with @Public and no user is present', () => {
    expectApiError(() => guard.canActivate(context(proto.misconfigured)), 401, 'UNAUTHENTICATED');
  });
});
