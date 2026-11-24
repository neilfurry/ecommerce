import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import {
  type AuthenticatedUser,
  CLIENT_APP_HEADER,
  CLIENT_APPS,
  type ClientApp,
  type Permission,
  type UserRole,
} from '@marketplace/shared-types';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const PERMISSIONS_KEY = 'auth:permissions';
export const SKIP_CSRF_KEY = 'auth:skipCsrf';

/**
 * Marks a route (or controller) as reachable without authentication.
 * Every other route requires an authenticated user: the API is secure by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to users holding at least one of the given roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Requires every listed permission. Prefer permissions over roles: they are configurable. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Exempts a state-changing route from the CSRF check. Only for requests that cannot carry
 * browser cookies, such as payment-provider webhooks with their own signatures.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser; id?: string | number };

/** Injects the authenticated user into a handler parameter: `@CurrentUser() user`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

/** Where a request came from; recorded with sessions and audit entries. */
export interface RequestContext {
  app: ClientApp | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function clientAppFrom(request: Request): ClientApp | null {
  const value = request.headers[CLIENT_APP_HEADER];
  return typeof value === 'string' && (CLIENT_APPS as readonly string[]).includes(value)
    ? (value as ClientApp)
    : null;
}

export function requestContextFrom(request: AuthenticatedRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    app: clientAppFrom(request),
    ipAddress: request.ip ? request.ip.slice(0, 45) : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    requestId: request.id === undefined ? null : String(request.id).slice(0, 128),
  };
}

/** Injects the RequestContext: `@ReqContext() ctx`. */
export const ReqContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext =>
    requestContextFrom(context.switchToHttp().getRequest<AuthenticatedRequest>()),
);
