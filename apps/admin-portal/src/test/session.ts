import { PERMISSION_CODES, type Permission, type UserRole } from '@marketplace/shared-types';

/** A session response as GET /auth/session returns it. */
export function sessionFor(
  roles: UserRole[] = ['SUPER_ADMIN'],
  permissions: readonly Permission[] = PERMISSION_CODES,
) {
  return {
    user: {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'ana@marketplace.local',
      emailVerified: true,
      mobile: null,
      mobileVerified: false,
      roles,
      permissions: [...permissions],
      wholesaleStatus: null,
      mfaEnabled: false,
      seller: null,
    },
    app: 'admin',
    accessTokenExpiresAt: '2026-11-25T09:15:00.000Z',
  };
}
