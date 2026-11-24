import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from '../../common/auth/roles.guard';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticationGuard } from './guards/authentication.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { OtpService } from './otp.service';
import { PrincipalService } from './principal.service';
import { SessionsService } from './sessions.service';
import { VerificationTokensService } from './verification-tokens.service';

/**
 * Identity and access. Global guards run in this order (after the rate limiter):
 * CSRF → authentication (secure by default; @Public() opts out) → @Roles → @RequirePermissions.
 */
@Global()
@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    SessionsService,
    PrincipalService,
    OtpService,
    VerificationTokensService,
    AuthService,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SessionsService, PrincipalService, VerificationTokensService, AuthService],
})
export class AuthModule {}
