import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_NAME, REDIS_KEYS } from '@marketplace/config';
import { verifyPassword } from '@marketplace/database';
import type { ClientApp } from '@marketplace/shared-types';
import type { MfaChallengeResponse, MfaSetupResponse, MfaStatus } from '@marketplace/validation';
import type { Redis } from 'ioredis';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from './crypto';
import { PrincipalService } from './principal.service';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './totp';

/** A sign-in that passed its first factor and waits for the authenticator code. */
export interface PendingMfaSignIn {
  userId: string;
  app: ClientApp;
  method: 'password' | 'sms_code';
  attempts: number;
}

export const MFA_CHALLENGE_TTL_SECONDS = 300;
export const MFA_MAX_ATTEMPTS = 5;

const invalidCode = () =>
  new ApiException(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'That code is not correct.', [
    { path: 'code', message: 'Check your authenticator app and try again' },
  ]);

/**
 * Optional two-step verification with an authenticator app (TOTP, RFC 6238) and single-use
 * recovery codes. When enabled, every sign-in (password or SMS code) also needs a code.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly principals: PrincipalService,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    const mfa = await this.prisma.userMfa.findUnique({
      where: { userId },
      select: { enabledAt: true },
    });
    return !!mfa?.enabledAt;
  }

  async status(userId: string): Promise<MfaStatus> {
    const [mfa, remaining] = await Promise.all([
      this.prisma.userMfa.findUnique({ where: { userId } }),
      this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
    return {
      enabled: !!mfa?.enabledAt,
      enabledAt: mfa?.enabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: mfa?.enabledAt ? remaining : 0,
    };
  }

  /** Step 1: confirm the password and create a (not yet active) secret. */
  async setup(
    userId: string,
    password: string,
    context: RequestContext,
  ): Promise<MfaSetupResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { mfa: true },
    });
    if (user.mfa?.enabledAt) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Two-step verification is already on.',
      );
    }
    await this.assertPassword(user.passwordHash, password);
    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret, this.config.auth.mfaEncryptionKey);
    await this.prisma.userMfa.upsert({
      where: { userId },
      create: { userId, totpSecretEncrypted: encrypted },
      update: { totpSecretEncrypted: encrypted, enabledAt: null, lastUsedStep: null },
    });
    await this.audit.record(
      { action: 'mfa.setup_started', actorId: userId, entityType: 'user', entityId: userId },
      context,
    );
    return { secret, otpauthUrl: otpauthUrl(secret, user.email, APP_NAME) };
  }

  /** Step 2: a correct code turns it on and returns the recovery codes (shown once). */
  async enable(userId: string, code: string, context: RequestContext): Promise<string[]> {
    const mfa = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!mfa) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Start the set-up again.');
    }
    if (mfa.enabledAt) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Two-step verification is already on.',
      );
    }
    const step = verifyTotp(this.secretOf(mfa.totpSecretEncrypted), code, Date.now(), null);
    if (step === null) throw invalidCode();
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.userMfa.update({
        where: { userId },
        data: { enabledAt: new Date(), lastUsedStep: BigInt(step) },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })),
      });
      await this.audit.record(
        { action: 'mfa.enabled', actorId: userId, entityType: 'user', entityId: userId },
        context,
        tx,
      );
    });
    // The Admin Console stops asking for enrolment at once (STAFF_MFA_REQUIRED).
    await this.principals.invalidateUser(userId);
    return codes;
  }

  async disable(
    userId: string,
    password: string,
    code: string,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.assertPassword(user.passwordHash, password);
    if (!(await this.verifyCode(userId, code))) throw invalidCode();
    await this.removeFor(userId);
    await this.audit.record(
      { action: 'mfa.disabled', actorId: userId, entityType: 'user', entityId: userId },
      context,
    );
  }

  async regenerateRecoveryCodes(
    userId: string,
    code: string,
    context: RequestContext,
  ): Promise<string[]> {
    if (!(await this.isEnabled(userId))) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Two-step verification is off.');
    }
    if (!(await this.verifyCode(userId, code))) throw invalidCode();
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })),
      }),
    ]);
    await this.audit.record(
      {
        action: 'mfa.recovery_codes_regenerated',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
      },
      context,
    );
    return codes;
  }

  /** For administrators helping someone who lost their authenticator and recovery codes. */
  async resetByAdmin(userId: string, actorId: string, context: RequestContext): Promise<void> {
    const removed = await this.removeFor(userId);
    if (!removed) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This account does not use two-step verification.',
      );
    }
    await this.audit.record(
      { action: 'mfa.reset_by_admin', actorId, entityType: 'user', entityId: userId },
      context,
    );
  }

  /**
   * Accepts a current authenticator code (never the same time step twice) or an unused
   * recovery code (consumed). Both checks are atomic, so concurrent use of one code fails.
   */
  async verifyCode(userId: string, rawCode: string): Promise<boolean> {
    const mfa = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!mfa?.enabledAt) return false;
    const code = rawCode.trim().toUpperCase();
    if (/^\d{6}$/.test(code)) {
      const last = mfa.lastUsedStep === null ? null : Number(mfa.lastUsedStep);
      const step = verifyTotp(this.secretOf(mfa.totpSecretEncrypted), code, Date.now(), last);
      if (step === null) return false;
      const updated = await this.prisma.userMfa.updateMany({
        where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
        data: { lastUsedStep: BigInt(step) },
      });
      return updated.count === 1;
    }
    const used = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1;
  }

  // ---- Pending sign-ins ----------------------------------------------------------------------

  async createChallenge(
    pending: Omit<PendingMfaSignIn, 'attempts'>,
  ): Promise<MfaChallengeResponse> {
    const token = randomToken();
    await this.redis.set(
      this.challengeKey(token),
      JSON.stringify({ ...pending, attempts: 0 } satisfies PendingMfaSignIn),
      'EX',
      MFA_CHALLENGE_TTL_SECONDS,
    );
    return {
      mfaRequired: true,
      mfaToken: token,
      expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Checks the code for a pending sign-in. Returns the pending sign-in on success (and
   * deletes it); throws for a wrong code (5 tries) or an expired/unknown token.
   */
  async completeChallenge(token: string, code: string, app: ClientApp): Promise<PendingMfaSignIn> {
    const key = this.challengeKey(token);
    const raw = await this.redis.get(key);
    const pending = raw ? (JSON.parse(raw) as PendingMfaSignIn) : null;
    if (!pending || pending.app !== app) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'OTP_EXPIRED',
        'This sign-in has expired. Sign in again.',
      );
    }
    if (await this.verifyCode(pending.userId, code)) {
      // Single use: only the request that deletes the key may continue.
      if ((await this.redis.del(key)) !== 1) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'OTP_EXPIRED',
          'This sign-in has expired. Sign in again.',
        );
      }
      return pending;
    }
    const attempts = pending.attempts + 1;
    if (attempts >= MFA_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'OTP_TOO_MANY_ATTEMPTS',
        'Too many wrong codes. Sign in again.',
      );
    }
    await this.redis.set(key, JSON.stringify({ ...pending, attempts }), 'KEEPTTL');
    throw invalidCode();
  }

  private challengeKey(token: string) {
    return `${REDIS_KEYS.MFA_CHALLENGE_PREFIX}${sha256(token)}`;
  }

  private secretOf(encrypted: string): string {
    return decryptSecret(encrypted, this.config.auth.mfaEncryptionKey);
  }

  private async removeFor(userId: string): Promise<boolean> {
    const [removed] = await this.prisma.$transaction([
      this.prisma.userMfa.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
    await this.principals.invalidateUser(userId);
    return removed.count > 0;
  }

  private async assertPassword(hash: string | null, password: string): Promise<void> {
    if (!hash || !(await verifyPassword(hash, password))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_CREDENTIALS',
        'Your password is not correct.',
        [{ path: 'password', message: 'Incorrect password' }],
      );
    }
  }
}
