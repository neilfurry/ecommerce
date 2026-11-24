import { type ClientApp, CLIENT_APP_ROLES, type UserRole } from '@marketplace/shared-types';

/** Whether any of the roles may sign in to the given frontend. */
export function canUseApp(roles: readonly UserRole[], app: ClientApp): boolean {
  return roles.some((role) => CLIENT_APP_ROLES[app].includes(role));
}
