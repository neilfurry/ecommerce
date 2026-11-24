import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../../common/auth/auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';

/**
 * Authentication module (placeholder until Phase 2).
 *
 * Already active: the global AuthGuard (secure by default; @Public() opts out) and
 * RolesGuard (@Roles(...)). Phase 2 adds here: users and credentials (Argon2id),
 * access/refresh token issuing and rotation in HTTP-only cookies, a token-verifying step
 * that sets `request.user`, CSRF protection, configurable permissions and the audit log.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
