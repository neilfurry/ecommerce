import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { OtpChallenge, OtpPurpose, Prisma } from '@marketplace/database';
import { maskMobile, type OtpChallengeResponse } from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { constantTimeEqual, hashOtp, randomOtpCode } from './crypto';

export const OTP_POLICY = {
  ttlMs: 5 * 60_000,
  resendCooldownMs: 60_000,
  maxAttempts: 5,
  maxSendsPerChallenge: 3,
  /** Codes sent to one number per rolling hour, across all challenges. */
  maxSendsPerMobilePerHour: 5,
} as const;

export interface CreateChallengeInput {
  purpose: OtpPurpose;
  mobile: string;
  userId: string | null;
  payload?: Prisma.InputJsonValue;
  /**
   * False for sign-in to an unknown number: a challenge is created (same response, so the
   * API does not reveal which numbers have accounts) but no SMS is sent and no code matches.
   */
  deliver: boolean;
  ipAddress: string | null;
}

/** One-time SMS codes. Only an HMAC of each code is stored. */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
  ) {}

  async create(input: CreateChallengeInput): Promise<OtpChallengeResponse> {
    await this.assertMobileWithinHourlyLimit(input.mobile);
    const id = randomUUID();
    const code = randomOtpCode();
    const now = Date.now();
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        id,
        purpose: input.purpose,
        mobile: input.mobile,
        userId: input.userId,
        // An undeliverable challenge stores a hash no 6-digit code can produce.
        codeHash: input.deliver ? hashOtp(this.config.auth.otpSecret, id, code) : '0'.repeat(64),
        payload: input.payload,
        expiresAt: new Date(now + OTP_POLICY.ttlMs),
        lastSentAt: new Date(now),
        ipAddress: input.ipAddress,
      },
    });
    if (input.deliver) await this.deliver(challenge.mobile, code);
    return this.toResponse(challenge);
  }

  async resend(challengeId: string): Promise<OtpChallengeResponse> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.consumedAt) throw this.expired();
    const now = Date.now();
    const waitMs = challenge.lastSentAt.getTime() + OTP_POLICY.resendCooldownMs - now;
    if (waitMs > 0) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code.`,
      );
    }
    if (challenge.sendCount >= OTP_POLICY.maxSendsPerChallenge) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many codes requested. Start again in a few minutes.',
      );
    }
    await this.assertMobileWithinHourlyLimit(challenge.mobile);

    const deliverable = challenge.purpose === 'SIGN_UP' || challenge.userId !== null;
    const code = randomOtpCode();
    const updated = await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        codeHash: deliverable
          ? hashOtp(this.config.auth.otpSecret, challenge.id, code)
          : challenge.codeHash,
        attempts: 0,
        sendCount: { increment: 1 },
        expiresAt: new Date(now + OTP_POLICY.ttlMs),
        lastSentAt: new Date(now),
      },
    });
    if (deliverable) await this.deliver(updated.mobile, code);
    return this.toResponse(updated);
  }

  /**
   * Checks a code and consumes the challenge on success. Every failure is counted; the
   * error never reveals whether the number has an account.
   */
  async verify(challengeId: string, code: string, purpose: OtpPurpose): Promise<OtpChallenge> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.purpose !== purpose || challenge.consumedAt) throw this.invalid();
    if (challenge.expiresAt.getTime() <= Date.now()) throw this.expired();
    if (challenge.attempts >= OTP_POLICY.maxAttempts) throw this.tooManyAttempts();

    const matches = constantTimeEqual(
      challenge.codeHash,
      hashOtp(this.config.auth.otpSecret, challenge.id, code),
    );
    if (!matches) {
      const updated = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      if (updated.attempts >= OTP_POLICY.maxAttempts) throw this.tooManyAttempts();
      throw this.invalid(OTP_POLICY.maxAttempts - updated.attempts);
    }

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date(), payload: null as unknown as Prisma.InputJsonValue },
    });
    if (consumed.count !== 1) throw this.invalid();
    return challenge;
  }

  private async assertMobileWithinHourlyLimit(mobile: string): Promise<void> {
    const since = new Date(Date.now() - 3_600_000);
    const recent = await this.prisma.otpChallenge.aggregate({
      where: { mobile, lastSentAt: { gte: since } },
      _sum: { sendCount: true },
    });
    if ((recent._sum.sendCount ?? 0) >= OTP_POLICY.maxSendsPerMobilePerHour) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many codes were sent to this number. Try again in an hour.',
      );
    }
  }

  private deliver(mobile: string, code: string) {
    return this.notifications.sendSmsOtp({
      to: mobile,
      code,
      expiresInMinutes: Math.round(OTP_POLICY.ttlMs / 60_000),
    });
  }

  private toResponse(challenge: OtpChallenge): OtpChallengeResponse {
    return {
      challengeId: challenge.id,
      destination: maskMobile(challenge.mobile),
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: new Date(
        challenge.lastSentAt.getTime() + OTP_POLICY.resendCooldownMs,
      ).toISOString(),
    };
  }

  private invalid(remaining?: number) {
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      'OTP_INVALID',
      remaining === undefined
        ? 'That code is not valid. Request a new one.'
        : `That code is not correct. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`,
    );
  }

  private expired() {
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      'OTP_EXPIRED',
      'That code has expired. Request a new one.',
    );
  }

  private tooManyAttempts() {
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      'OTP_TOO_MANY_ATTEMPTS',
      'Too many wrong codes. Request a new one.',
    );
  }
}
