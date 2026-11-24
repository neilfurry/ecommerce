import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@marketplace/shared-types';
import { ApiException } from '../errors/api.exception';
import { type AuthenticatedRequest, IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

/**
 * Enforces @Roles(...). Runs after AuthGuard. Routes without @Roles only need an
 * authenticated user. Fine-grained, configurable permissions build on this in Phase 2.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      // @Roles on a @Public route is a programming error; fail closed.
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        isPublic ? 'This route requires a role but is marked public.' : 'Authentication required.',
      );
    }
    if (!user.roles.some((role) => required.includes(role))) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }
}
