import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthenticatedUser, UserRole } from '@marketplace/shared-types';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/**
 * Marks a route (or controller) as reachable without authentication.
 * Every other route requires an authenticated user: the API is secure by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to users holding at least one of the given roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/** Injects the authenticated user into a handler parameter: `@CurrentUser() user`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
