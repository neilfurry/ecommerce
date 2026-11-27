import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  dummyPasswordHash,
  emitNotificationInTx,
  hashPassword,
  passwordNeedsRehash,
  Prisma,
  type User,
  verifyPassword,
} from '@marketplace/database';
import { type AuthenticatedUser, type ClientApp, type UserRole } from '@marketplace/shared-types';
import type {
  CustomerSignUp,
  MfaChallengeResponse,
  OtpChallengeResponse,
  SellerSignUp,
  SessionResponse,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { canUseApp } from './client-apps';
import { MfaService } from './mfa.service';
import { OtpService } from './otp.service';
import { PrincipalService } from './principal.service';
import { type IssuedSession, SessionsService } from './sessions.service';
import { TOKEN_LIFETIMES_MS, VerificationTokensService } from './verification-tokens.service';

/** Pending sign-up stored (with the password already hashed) in the OTP challenge. */
interface PendingSignUp {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  accountType: 'RETAIL' | 'WHOLESALE';
  business?: { businessName: string; tin: string; businessAddress: string };
  /** Another customer's referral code. */
  referralCode?: string;
}

export interface SignedIn {
  session: IssuedSession;
  response: SessionResponse;
}

/** A sign-in step either ends in a session or asks for the authenticator code. */
export type SignInOutcome = SignedIn | { mfa: MfaChallengeResponse };

export { canUseApp };

const invalidCredentials = () =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly principals: PrincipalService,
    private readonly otp: OtpService,
    private readonly tokens: VerificationTokensService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly mfa: MfaService,
  ) {}

  // ---- Customer sign-up (mobile verified by SMS before the account exists) ---------------

  async startCustomerSignUp(
    input: CustomerSignUp,
    context: RequestContext,
  ): Promise<OtpChallengeResponse> {
    await this.assertEmailAndMobileAvailable(input.email, input.mobile);
    if (input.referralCode) {
      const referrer = await this.prisma.user.count({
        where: { referralCode: input.referralCode, status: 'ACTIVE' },
      });
      if (!referrer) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'This referral code is not valid.',
          [{ path: 'referralCode', message: 'This referral code is not valid.' }],
        );
      }
    }
    const pending: PendingSignUp = {
      ...(input.referralCode ? { referralCode: input.referralCode } : {}),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      accountType: input.accountType,
      ...(input.accountType === 'WHOLESALE' && input.business ? { business: input.business } : {}),
    };
    return this.otp.create({
      purpose: 'SIGN_UP',
      mobile: input.mobile,
      userId: null,
      payload: pending as unknown as Prisma.InputJsonValue,
      deliver: true,
      ipAddress: context.ipAddress,
    });
  }

  async completeCustomerSignUp(
    challengeId: string,
    code: string,
    context: RequestContext,
  ): Promise<SignedIn> {
    const challenge = await this.otp.verify(challengeId, code, 'SIGN_UP');
    const pending = challenge.payload as unknown as PendingSignUp | null;
    if (!pending) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'OTP_INVALID',
        'This sign-up has expired. Start again.',
      );
    }

    let created: { user: User; session: IssuedSession; verificationToken: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const user = await tx.user.create({
          data: {
            email: pending.email,
            mobile: challenge.mobile,
            mobileVerifiedAt: now,
            passwordHash: pending.passwordHash,
            passwordChangedAt: now,
            firstName: pending.firstName,
            lastName: pending.lastName,
            status: 'ACTIVE',
            lastSignInAt: now,
            roles: { create: [{ roleCode: 'CUSTOMER' }] },
          },
        });
        if (pending.accountType === 'WHOLESALE' && pending.business) {
          await tx.wholesaleApplication.create({ data: { userId: user.id, ...pending.business } });
          await this.audit.record(
            {
              action: 'wholesale.application_submitted',
              actorId: user.id,
              entityType: 'user',
              entityId: user.id,
            },
            context,
            tx,
          );
        }
        await this.audit.record(
          {
            action: 'auth.sign_up',
            actorId: user.id,
            entityType: 'user',
            entityId: user.id,
            metadata: { accountType: pending.accountType },
          },
          context,
          tx,
        );
        if (pending.referralCode) {
          // Rewarded with points after the new customer's first completed order (ADR 0032).
          const referrer = await tx.user.findUnique({
            where: { referralCode: pending.referralCode },
            select: { id: true, status: true },
          });
          if (referrer && referrer.status === 'ACTIVE' && referrer.id !== user.id) {
            await tx.referral.create({
              data: { referrerId: referrer.id, refereeId: user.id, code: pending.referralCode },
            });
          }
        }
        await emitNotificationInTx(tx, {
          event: 'CUSTOMER_REGISTERED',
          userIds: [user.id],
          data: { firstName: user.firstName },
          link: '/account',
        });
        const verificationToken = await this.tokens.issue(user.id, 'EMAIL_VERIFICATION', tx);
        const session = await this.sessions.start(user.id, 'storefront', context, tx);
        return { user, session, verificationToken };
      });
    } catch (error) {
      // Someone registered the same email or number between start and verify.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This email or mobile number is already registered.',
        );
      }
      throw error;
    }

    await this.notifications.kickDispatch();
    await this.notifications.safely('verification email', () =>
      this.notifications.sendVerifyEmail({
        to: created.user.email,
        firstName: created.user.firstName,
        link: `${this.config.appUrls.storefront}/verify-email?token=${created.verificationToken}`,
      }),
    );
    return {
      session: created.session,
      response: await this.sessionResponse(created.user.id, 'storefront', created.session),
    };
  }

  // ---- Customer sign-in with mobile number + SMS code -------------------------------------

  async requestMobileSignIn(
    mobile: string,
    context: RequestContext,
  ): Promise<OtpChallengeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { mobile },
      select: {
        id: true,
        status: true,
        mobileVerifiedAt: true,
        roles: { select: { roleCode: true } },
      },
    });
    const eligible =
      !!user &&
      user.status === 'ACTIVE' &&
      !!user.mobileVerifiedAt &&
      canUseApp(
        user.roles.map((r) => r.roleCode as UserRole),
        'storefront',
      );
    // Same response whether or not the number has an account (no enumeration).
    return this.otp.create({
      purpose: 'SIGN_IN',
      mobile,
      userId: eligible ? user.id : null,
      deliver: eligible,
      ipAddress: context.ipAddress,
    });
  }

  async completeMobileSignIn(
    challengeId: string,
    code: string,
    context: RequestContext,
  ): Promise<SignInOutcome> {
    const challenge = await this.otp.verify(challengeId, code, 'SIGN_IN');
    if (!challenge.userId) throw invalidCredentials();
    return this.finishSignIn(challenge.userId, 'storefront', 'sms_code', context);
  }

  // ---- Email + password (customers and staff) ----------------------------------------------

  async signInWithPassword(
    email: string,
    password: string,
    app: ClientApp,
    context: RequestContext,
  ): Promise<SignInOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const fail = async (reason: string, actorId: string | null) => {
      await this.audit.recordSafely(
        {
          action: 'auth.sign_in',
          outcome: 'FAILURE',
          actorId,
          entityType: 'user',
          entityId: actorId ?? undefined,
          metadata: { method: 'password', reason, ...(actorId ? {} : { attemptedEmail: email }) },
        },
        context,
      );
    };

    if (!user || !user.passwordHash || user.status === 'INVITED') {
      await verifyPassword(await dummyPasswordHash(), password); // equal timing
      await fail(user ? 'not_activated' : 'unknown_email', user?.id ?? null);
      throw invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await fail('locked', user.id);
      throw this.locked(user.lockedUntil);
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      const failures = user.failedSignInCount + 1;
      const lock = failures >= this.config.auth.maxFailedSignIns;
      const lockedUntil = lock
        ? new Date(now.getTime() + this.config.auth.lockoutMinutes * 60_000)
        : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedSignInCount: lock ? 0 : failures, ...(lock ? { lockedUntil } : {}) },
      });
      await fail('wrong_password', user.id);
      if (lock && lockedUntil) {
        await this.audit.recordSafely(
          {
            action: 'auth.account_locked',
            outcome: 'FAILURE',
            actorId: user.id,
            entityType: 'user',
            entityId: user.id,
          },
          context,
        );
        throw this.locked(lockedUntil);
      }
      throw invalidCredentials();
    }

    // The password is right; the remaining checks may explain the refusal.
    if (user.status === 'SUSPENDED') {
      await fail('suspended', user.id);
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_SUSPENDED',
        'This account is suspended. Contact support.',
      );
    }
    if (app === 'storefront' && !user.emailVerifiedAt) {
      await fail('email_not_verified', user.id);
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'EMAIL_NOT_VERIFIED',
        'Verify your email address first, or sign in with your mobile number.',
      );
    }
    if (passwordNeedsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password) },
      });
    }
    return this.finishSignIn(user.id, app, 'password', context);
  }

  // ---- Two-step verification ----------------------------------------------------------------

  /** Second step of a sign-in when the account has two-step verification on. */
  async completeMfaSignIn(
    token: string,
    code: string,
    app: ClientApp,
    context: RequestContext,
  ): Promise<SignedIn> {
    let pending;
    try {
      pending = await this.mfa.completeChallenge(token, code, app);
    } catch (error) {
      await this.audit.recordSafely(
        {
          action: 'auth.mfa_failed',
          outcome: 'FAILURE',
          metadata: { reason: error instanceof ApiException ? error.code : 'error' },
        },
        context,
      );
      throw error;
    }
    const outcome = await this.finishSignIn(pending.userId, app, pending.method, context, {
      mfaPassed: true,
    });
    if ('mfa' in outcome) throw new Error('unreachable: MFA already passed');
    return outcome;
  }

  // ---- Seller registration (Seller Center) ------------------------------------------------

  /**
   * Creates the owner's account and a PENDING seller in one step. The owner can sign in at
   * once to complete the business profile and upload documents; nothing is sold until an
   * admin verifies the seller. The email is confirmed by link before submission.
   */
  async signUpSeller(input: SellerSignUp, context: RequestContext): Promise<SignedIn> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'An account with this email already exists.',
        [
          {
            path: 'email',
            message: 'This email is already registered. Use a different email for your business.',
          },
        ],
      );
    }
    const passwordHash = await hashPassword(input.password);
    let created: { user: User; session: IssuedSession; verificationToken: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const user = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            passwordChangedAt: now,
            firstName: input.firstName,
            lastName: input.lastName,
            status: 'ACTIVE',
            lastSignInAt: now,
            roles: { create: [{ roleCode: 'SELLER_OWNER' }] },
          },
        });
        const seller = await tx.seller.create({
          data: {
            businessName: input.businessName,
            businessType: input.businessType,
            ownerId: user.id,
            email: input.email,
            mobile: input.mobile,
            events: { create: { type: 'REGISTERED', toStatus: 'PENDING', actorId: user.id } },
            members: { create: { userId: user.id } },
          },
        });
        await this.audit.record(
          {
            action: 'seller.registered',
            actorId: user.id,
            entityType: 'seller',
            entityId: seller.id,
            metadata: { businessType: input.businessType },
          },
          context,
          tx,
        );
        const verificationToken = await this.tokens.issue(user.id, 'EMAIL_VERIFICATION', tx);
        const session = await this.sessions.start(user.id, 'seller', context, tx);
        return { user, session, verificationToken };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'An account with this email already exists.',
          [{ path: 'email', message: 'This email is already registered.' }],
        );
      }
      throw error;
    }
    await this.notifications.safely('verification email', () =>
      this.notifications.sendVerifyEmail({
        to: created.user.email,
        firstName: created.user.firstName,
        link: `${this.config.appUrls.seller}/verify-email?token=${created.verificationToken}`,
      }),
    );
    return {
      session: created.session,
      response: await this.sessionResponse(created.user.id, 'seller', created.session),
    };
  }

  // ---- Session lifecycle --------------------------------------------------------------------

  async refresh(
    refreshToken: string,
    app: ClientApp,
    context: RequestContext,
  ): Promise<SignedIn | 'race'> {
    const result = await this.sessions.rotate(refreshToken, app, context);
    if (result.status === 'race') return 'race';
    if (result.status === 'reuse') {
      await this.audit.recordSafely(
        {
          action: 'auth.refresh_token_reuse',
          outcome: 'FAILURE',
          actorId: result.userId,
          entityType: 'user',
          entityId: result.userId,
          metadata: { familyId: result.familyId },
        },
        context,
      );
      throw this.sessionEnded();
    }
    if (result.status === 'invalid') throw this.sessionEnded();

    const principal = await this.principals.load(result.userId);
    if (!principal || principal.status !== 'ACTIVE' || !canUseApp(principal.roles, app)) {
      await this.sessions.revoke(result.session.sessionId, 'ADMIN_REVOKED');
      throw this.sessionEnded();
    }
    return {
      session: result.session,
      response: await this.sessionResponse(result.userId, app, result.session),
    };
  }

  async signOut(sessionId: string, userId: string, context: RequestContext): Promise<void> {
    await this.sessions.revoke(sessionId, 'SIGNED_OUT');
    await this.audit.recordSafely(
      { action: 'auth.sign_out', actorId: userId, entityType: 'user', entityId: userId },
      context,
    );
  }

  async signOutEverywhere(user: AuthenticatedUser, context: RequestContext): Promise<number> {
    const count = await this.sessions.revokeAllForUser(user.id, 'SIGNED_OUT');
    await this.audit.record(
      {
        action: 'auth.sign_out_everywhere',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { sessions: count },
      },
      context,
    );
    return count;
  }

  async sessionResponse(
    userId: string,
    app: ClientApp,
    session: { accessTokenExpiresAt: Date | string },
  ): Promise<SessionResponse> {
    const [user, principal] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          wholesaleApplication: { select: { status: true } },
          mfa: { select: { enabledAt: true } },
        },
      }),
      this.principals.load(userId),
    ]);
    const expiresAt = session.accessTokenExpiresAt;
    return {
      app,
      accessTokenExpiresAt: typeof expiresAt === 'string' ? expiresAt : expiresAt.toISOString(),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        emailVerified: !!user.emailVerifiedAt,
        mobile: user.mobile,
        mobileVerified: !!user.mobileVerifiedAt,
        roles: principal?.roles ?? [],
        permissions: principal?.permissions ?? [],
        wholesaleStatus: user.wholesaleApplication?.status ?? null,
        mfaEnabled: !!user.mfa?.enabledAt,
        mfaEnrollmentRequired:
          app === 'admin' && this.config.auth.staffMfaRequired && !user.mfa?.enabledAt,
        seller:
          principal?.seller && app === 'seller'
            ? {
                id: principal.seller.id,
                businessName: principal.seller.businessName,
                status: principal.seller.status,
                isOwner: principal.seller.isOwner,
              }
            : null,
      },
    };
  }

  // ---- Email verification, password reset, invitations ------------------------------------

  async verifyEmail(token: string, context: RequestContext): Promise<void> {
    const userId = await this.tokens.consume(token, 'EMAIL_VERIFICATION');
    if (!userId) throw this.badLink();
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record(
      { action: 'auth.email_verified', actorId: userId, entityType: 'user', entityId: userId },
      context,
    );
  }

  async resendVerificationEmail(userId: string, app: ClientApp): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    const token = await this.tokens.issue(user.id, 'EMAIL_VERIFICATION');
    await this.notifications.sendVerifyEmail({
      to: user.email,
      firstName: user.firstName,
      link: `${this.config.appUrls[app]}/verify-email?token=${token}`,
    });
  }

  /** Always succeeds from the caller's point of view (no account enumeration). */
  async requestPasswordReset(
    email: string,
    app: ClientApp,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { roles: true } });
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) return;
    if (
      !canUseApp(
        user.roles.map((r) => r.roleCode as UserRole),
        app,
      )
    )
      return;
    const token = await this.tokens.issue(user.id, 'PASSWORD_RESET');
    await this.audit.recordSafely(
      {
        action: 'auth.password_reset_requested',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
      },
      context,
    );
    await this.notifications.safely('password reset email', () =>
      this.notifications.sendPasswordReset({
        to: user.email,
        firstName: user.firstName,
        link: `${this.config.appUrls[app]}/reset-password?token=${token}`,
        expiresInMinutes: TOKEN_LIFETIMES_MS.PASSWORD_RESET / 60_000,
      }),
    );
  }

  async resetPassword(token: string, password: string, context: RequestContext): Promise<void> {
    const userId = await this.prisma.$transaction(async (tx) => {
      const id = await this.tokens.consume(token, 'PASSWORD_RESET', tx);
      if (!id) return null;
      await tx.user.update({
        where: { id },
        data: {
          passwordHash: await hashPassword(password),
          passwordChangedAt: new Date(),
          failedSignInCount: 0,
          lockedUntil: null,
        },
      });
      await this.audit.record(
        { action: 'auth.password_reset', actorId: id, entityType: 'user', entityId: id },
        context,
        tx,
      );
      return id;
    });
    if (!userId) throw this.badLink();
    await this.sessions.revokeAllForUser(userId, 'PASSWORD_CHANGED');
  }

  async acceptInvitation(token: string, password: string, context: RequestContext): Promise<void> {
    const ok = await this.prisma.$transaction(async (tx) => {
      const userId = await this.tokens.consume(token, 'INVITATION', tx);
      if (!userId) return false;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.status !== 'INVITED') return false;
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(password),
          passwordChangedAt: now,
          emailVerifiedAt: now,
          status: 'ACTIVE',
        },
      });
      await this.audit.record(
        {
          action: 'auth.invitation_accepted',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
        },
        context,
        tx,
      );
      return true;
    });
    if (!ok) throw this.badLink();
  }

  async changePassword(
    user: AuthenticatedUser,
    current: string,
    next: string,
    context: RequestContext,
  ): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.passwordHash || !(await verifyPassword(row.passwordHash, current))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Current password is incorrect.',
        [{ path: 'currentPassword', message: 'Current password is incorrect' }],
      );
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() },
    });
    // Other devices must sign in again with the new password; this one stays signed in.
    await this.sessions.revokeAllForUser(user.id, 'PASSWORD_CHANGED', user.sessionId);
    await this.audit.record(
      { action: 'auth.password_changed', actorId: user.id, entityType: 'user', entityId: user.id },
      context,
    );
  }

  // ---- Helpers ------------------------------------------------------------------------------

  private async finishSignIn(
    userId: string,
    app: ClientApp,
    method: 'password' | 'sms_code',
    context: RequestContext,
    options: { mfaPassed?: boolean } = {},
  ): Promise<SignInOutcome> {
    const principal = await this.principals.load(userId);
    if (!principal || principal.status !== 'ACTIVE') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_SUSPENDED',
        'This account is suspended. Contact support.',
      );
    }
    if (!canUseApp(principal.roles, app)) {
      await this.audit.recordSafely(
        {
          action: 'auth.sign_in',
          outcome: 'FAILURE',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          metadata: { method, reason: 'wrong_app' },
        },
        context,
      );
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'This account cannot sign in here.',
      );
    }
    if (!options.mfaPassed && (await this.mfa.isEnabled(userId))) {
      return { mfa: await this.mfa.createChallenge({ userId, app, method }) };
    }
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { failedSignInCount: 0, lockedUntil: null, lastSignInAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'auth.sign_in',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          metadata: { method, mfa: !!options.mfaPassed },
        },
        context,
        tx,
      );
      return this.sessions.start(userId, app, context, tx);
    });
    return { session, response: await this.sessionResponse(userId, app, session) };
  }

  private async assertEmailAndMobileAvailable(email: string, mobile: string): Promise<void> {
    const taken = await this.prisma.user.findMany({
      where: { OR: [{ email }, { mobile }] },
      select: { email: true, mobile: true },
    });
    const fieldErrors = [
      ...(taken.some((u) => u.email === email)
        ? [{ path: 'email', message: 'This email is already registered. Sign in instead.' }]
        : []),
      ...(taken.some((u) => u.mobile === mobile)
        ? [
            {
              path: 'mobile',
              message: 'This mobile number is already registered. Sign in instead.',
            },
          ]
        : []),
    ];
    if (fieldErrors.length > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'An account with these details already exists.',
        fieldErrors,
      );
    }
  }

  private locked(until: Date) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return new ApiException(
      HttpStatus.LOCKED,
      'ACCOUNT_LOCKED',
      `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'} or reset your password.`,
    );
  }

  private sessionEnded() {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
      'Your session has ended. Sign in again.',
    );
  }

  private badLink() {
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      'BAD_REQUEST',
      'This link is invalid or has expired.',
    );
  }
}
