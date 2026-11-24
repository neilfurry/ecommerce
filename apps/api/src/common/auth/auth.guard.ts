import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../errors/api.exception';
import { type AuthenticatedRequest, IS_PUBLIC_KEY } from './auth.decorators';

/**
 * Global authentication gate. Routes marked @Public() pass; every other route needs
 * `request.user`, which the authentication module (Phase 2) sets after verifying the
 * access token. Until then only public routes are reachable, by design.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Authentication required.',
      );
    }
    return true;
  }
}
