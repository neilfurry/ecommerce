import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  type AuthenticatedRequest,
  clientAppFrom,
  IS_PUBLIC_KEY,
} from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';
import { AccessTokenService } from '../access-token.service';
import { accessCookieName, readCookie } from '../auth-cookies';
import { canUseApp } from '../client-apps';
import { PrincipalService } from '../principal.service';
import { SessionsService } from '../sessions.service';

type Resolution = AuthenticatedUser | 'expired' | null;

/**
 * Global authentication. Resolves `request.user` from the access-token cookie of the app
 * named in the X-Client-App header. Routes are protected unless marked @Public(); public
 * routes still get `request.user` when a valid session is present.
 *
 * Rejected immediately (not at token expiry): revoked sessions, suspended users, and users
 * who no longer hold a role allowed in this app.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionsService,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const resolution = await this.resolve(request);
    if (resolution && resolution !== 'expired') request.user = resolution;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || request.user) return true;
    if (resolution === 'expired') {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'TOKEN_EXPIRED',
        'Your session needs refreshing.',
      );
    }
    throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.');
  }

  private async resolve(request: AuthenticatedRequest): Promise<Resolution> {
    const app = clientAppFrom(request);
    if (!app) return null;
    const token = readCookie(request, accessCookieName(app));
    if (!token) return null;

    const verification = this.accessTokens.verify(token, app);
    if (!verification.valid) return verification.reason === 'expired' ? 'expired' : null;
    const { sub, sid, exp } = verification.claims;

    if (await this.sessions.isRevoked(sid)) return null;
    const principal = await this.principals.load(sub);
    if (!principal || principal.status !== 'ACTIVE' || !canUseApp(principal.roles, app))
      return null;

    return {
      id: sub,
      sessionId: sid,
      app,
      roles: principal.roles,
      permissions: principal.permissions,
      accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
    };
  }
}
