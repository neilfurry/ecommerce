import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER } from '@marketplace/shared-types';
import type { Request } from 'express';
import { SKIP_CSRF_KEY } from '../../../common/auth/auth.decorators';
import { ApiException } from '../../../common/errors/api.exception';
import { CSRF_COOKIE, readCookie } from '../auth-cookies';
import { constantTimeEqual } from '../crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection for every state-changing request. The client gets a token
 * from GET /api/v1/auth/csrf (which also sets it in an HttpOnly cookie) and echoes it in
 * the X-CSRF-Token header. A cross-site page can make the browser send the cookie but
 * cannot read the token, so it cannot produce the header. SameSite=Lax cookies are a
 * second layer.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const cookie = readCookie(request, CSRF_COOKIE);
    const header = request.headers[CSRF_HEADER];
    if (!cookie || typeof header !== 'string' || !constantTimeEqual(cookie, header)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'CSRF_FAILED',
        'Your session security token is missing or out of date. Reload the page and try again.',
      );
    }
    return true;
  }
}
