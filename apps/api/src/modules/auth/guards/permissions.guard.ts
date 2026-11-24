import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@marketplace/shared-types';
import { type AuthenticatedRequest, PERMISSIONS_KEY } from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';

/** Enforces @RequirePermissions(...): the user must hold every listed permission. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
    if (!required.every((permission) => user.permissions.includes(permission))) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }
}
