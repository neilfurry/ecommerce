import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthenticatedUser,
  CLIENT_APP_HEADER,
  type ClientApp,
} from '@marketplace/shared-types';
import {
  csrfResponseSchema,
  otpChallengeResponseSchema,
  type OtpChallengeResponse,
  sessionResponseSchema,
  type SessionResponse,
  type SignInResult,
  signInResultSchema,
} from '@marketplace/validation';
import type { Request, Response } from 'express';
import {
  AllowWithoutMfa,
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
} from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { AppConfig } from '../../config/app-config';
import { AccessTokenService } from './access-token.service';
import {
  clearSessionCookies,
  CSRF_COOKIE,
  readCookie,
  refreshCookieName,
  setCsrfCookie,
  setSessionCookies,
} from './auth-cookies';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  CustomerSignUpDto,
  EmailSignInDto,
  ForgotPasswordDto,
  MobileSignInDto,
  OtpResendDto,
  OtpVerifyDto,
  MfaVerifyDto,
  ResetPasswordDto,
  SellerSignUpDto,
  VerifyEmailDto,
} from './auth.dtos';
import { AuthService, type SignedIn, type SignInOutcome } from './auth.service';
import { randomToken, sha256 } from './crypto';
import { OtpService } from './otp.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Strict per-IP limits on credential endpoints, on top of the global limit. */
const SIGN_IN_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const OTP_LIMIT = { default: { limit: 5, ttl: 60_000 } };

function requireApp(context: RequestContext, allowed?: ClientApp[]): ClientApp {
  if (!context.app || (allowed && !allowed.includes(context.app))) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'BAD_REQUEST',
      allowed
        ? `This action is only available in: ${allowed.join(', ')}.`
        : `Send the ${CLIENT_APP_HEADER} header (storefront, seller or admin).`,
    );
  }
  return context.app;
}

@ApiTags('Authentication')
@ApiHeader({ name: CLIENT_APP_HEADER, description: 'storefront | seller | admin', required: true })
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly config: AppConfig,
    private readonly accessTokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('csrf')
  @Public()
  @ApiOperation({
    summary: 'Get the CSRF token to send as X-CSRF-Token on state-changing requests',
  })
  @ApiOkResponse({ schema: zodToOpenApi(csrfResponseSchema) })
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = readCookie(request, CSRF_COOKIE) ?? randomToken();
    setCsrfCookie(response, this.config, token);
    response.setHeader('Cache-Control', 'no-store');
    return { csrfToken: token };
  }

  // ---- Customer sign-up ---------------------------------------------------------

  @Post('customers/sign-up')
  @Public()
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start customer sign-up: validates details and texts a code to the mobile number',
  })
  @ApiBody({ schema: CustomerSignUpDto.openApiSchema })
  @ApiAcceptedResponse({ schema: zodToOpenApi(otpChallengeResponseSchema) })
  startSignUp(
    @Body() body: CustomerSignUpDto,
    @ReqContext() context: RequestContext,
  ): Promise<OtpChallengeResponse> {
    requireApp(context, ['storefront']);
    return this.auth.startCustomerSignUp(body, context);
  }

  @Post('customers/sign-up/verify')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @ApiOperation({ summary: 'Finish sign-up with the SMS code: creates the account and signs in' })
  @ApiBody({ schema: OtpVerifyDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(sessionResponseSchema) })
  async completeSignUp(
    @Body() body: OtpVerifyDto,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    requireApp(context, ['storefront']);
    return this.signedIn(
      response,
      'storefront',
      await this.auth.completeCustomerSignUp(body.challengeId, body.code, context),
    );
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle(OTP_LIMIT)
  @ApiOperation({ summary: 'Send a new code for an existing sign-up or sign-in challenge' })
  @ApiBody({ schema: OtpResendDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(otpChallengeResponseSchema) })
  resend(
    @Body() body: OtpResendDto,
    @ReqContext() context: RequestContext,
  ): Promise<OtpChallengeResponse> {
    requireApp(context, ['storefront']);
    return this.otp.resend(body.challengeId);
  }

  // ---- Sign-in ------------------------------------------------------------------------

  @Post('customers/sign-in/otp')
  @Public()
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Customer sign-in, step 1: text a code to the mobile number',
    description: 'Responds identically whether or not the number has an account.',
  })
  @ApiBody({ schema: MobileSignInDto.openApiSchema })
  @ApiAcceptedResponse({ schema: zodToOpenApi(otpChallengeResponseSchema) })
  requestOtp(
    @Body() body: MobileSignInDto,
    @ReqContext() context: RequestContext,
  ): Promise<OtpChallengeResponse> {
    requireApp(context, ['storefront']);
    return this.auth.requestMobileSignIn(body.mobile, context);
  }

  @Post('customers/sign-in/otp/verify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @ApiOperation({ summary: 'Customer sign-in, step 2: verify the SMS code' })
  @ApiBody({ schema: OtpVerifyDto.openApiSchema })
  @ApiOkResponse({
    schema: zodToOpenApi(signInResultSchema),
    description: 'A session, or { mfaRequired, mfaToken } when two-step verification is on',
  })
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResult> {
    requireApp(context, ['storefront']);
    return this.signedIn(
      response,
      'storefront',
      await this.auth.completeMobileSignIn(body.challengeId, body.code, context),
    );
  }

  @Post('sign-in')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password (any app; roles must match the app)' })
  @ApiBody({ schema: EmailSignInDto.openApiSchema })
  @ApiOkResponse({
    schema: zodToOpenApi(signInResultSchema),
    description: 'A session, or { mfaRequired, mfaToken } when two-step verification is on',
  })
  async signIn(
    @Body() body: EmailSignInDto,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResult> {
    const app = requireApp(context);
    return this.signedIn(
      response,
      app,
      await this.auth.signInWithPassword(body.email, body.password, app, context),
    );
  }

  @Post('mfa/verify')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Second sign-in step: the authenticator code (or a recovery code) for an mfaToken',
  })
  @ApiBody({ schema: MfaVerifyDto.openApiSchema })
  @ApiOkResponse({ schema: zodToOpenApi(sessionResponseSchema) })
  async verifyMfa(
    @Body() body: MfaVerifyDto,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const app = requireApp(context);
    return this.signedIn(
      response,
      app,
      await this.auth.completeMfaSignIn(body.mfaToken, body.code, app, context),
    );
  }

  @Post('sellers/sign-up')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @ApiOperation({
    summary: 'Seller Center: register a business. Creates the owner account and a PENDING seller',
  })
  @ApiBody({ schema: SellerSignUpDto.openApiSchema })
  @ApiCreatedResponse({ schema: zodToOpenApi(sessionResponseSchema) })
  async sellerSignUp(
    @Body() body: SellerSignUpDto,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    requireApp(context, ['seller']);
    return this.signedIn(response, 'seller', await this.auth.signUpSeller(body, context));
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and issue a new access token',
    description:
      'Each refresh token works once. Reusing an old one signs out every device of that sign-in. ' +
      '409 means another tab refreshed at the same moment: retry the original request.',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sessionResponseSchema) })
  async refresh(
    @Req() request: Request,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const app = requireApp(context);
    const token = readCookie(request, refreshCookieName(app));
    if (!token)
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to continue.');
    try {
      const result = await this.auth.refresh(token, app, context);
      if (result === 'race') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Session was refreshed by another tab.',
        );
      }
      return this.signedIn(response, app, result);
    } catch (error) {
      if (error instanceof ApiException && error.code === 'UNAUTHENTICATED')
        clearSessionCookies(response, this.config, app);
      throw error;
    }
  }

  @Post('sign-out')
  @AllowWithoutMfa()
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out of this app on this device (works with an expired access token)',
  })
  @ApiNoContentResponse()
  async signOut(
    @Req() request: Request,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const app = requireApp(context);
    let session: { id: string; userId: string } | null = user
      ? { id: user.sessionId, userId: user.id }
      : null;
    if (!session) {
      const refresh = readCookie(request, refreshCookieName(app));
      if (refresh) {
        session = await this.prisma.session.findUnique({
          where: { refreshTokenHash: sha256(refresh) },
          select: { id: true, userId: true },
        });
      }
    }
    if (session) await this.auth.signOut(session.id, session.userId, context);
    clearSessionCookies(response, this.config, app);
  }

  @Post('sign-out-everywhere')
  @AllowWithoutMfa()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out of every app on every device' })
  @ApiNoContentResponse()
  async signOutEverywhere(
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.signOutEverywhere(user, context);
    clearSessionCookies(response, this.config, user.app);
  }

  @Get('session')
  @AllowWithoutMfa()
  @ApiOperation({ summary: 'The signed-in user, roles, permissions and token expiry' })
  @ApiOkResponse({ schema: zodToOpenApi(sessionResponseSchema) })
  session(@CurrentUser() user: AuthenticatedUser): Promise<SessionResponse> {
    return this.auth.sessionResponse(user.id, user.app, {
      accessTokenExpiresAt: user.accessTokenExpiresAt,
    });
  }

  // ---- Email, password, invitations -------------------------------------------------------

  @Post('email/verify')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an email address with the token from the verification email' })
  @ApiBody({ schema: VerifyEmailDto.openApiSchema })
  @ApiNoContentResponse()
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.verifyEmail(body.token, context);
  }

  @Post('email/resend-verification')
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send the verification email again' })
  async resendVerification(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.resendVerificationEmail(user.id, user.app);
  }

  @Post('password/forgot')
  @Public()
  @Throttle(OTP_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Email a password-reset link',
    description: 'Always 202, whether or not the email has an account.',
  })
  @ApiBody({ schema: ForgotPasswordDto.openApiSchema })
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.requestPasswordReset(body.email, requireApp(context), context);
  }

  @Post('password/reset')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with the reset link token; signs out every device' })
  @ApiBody({ schema: ResetPasswordDto.openApiSchema })
  @ApiNoContentResponse()
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password, context);
  }

  @Post('password/change')
  @AllowWithoutMfa()
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password; other devices are signed out' })
  @ApiBody({ schema: ChangePasswordDto.openApiSchema })
  @ApiNoContentResponse()
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, context);
  }

  @Post('invitations/accept')
  @Public()
  @Throttle(SIGN_IN_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Staff: set a password from the invitation email and activate the account',
  })
  @ApiBody({ schema: AcceptInvitationDto.openApiSchema })
  @ApiNoContentResponse()
  async acceptInvitation(
    @Body() body: AcceptInvitationDto,
    @ReqContext() context: RequestContext,
  ): Promise<void> {
    await this.auth.acceptInvitation(body.token, body.password, context);
  }

  /**
   * Sets the session cookies, or, when two-step verification is on, returns the challenge
   * without any cookie (the session starts only after POST /auth/mfa/verify).
   */
  private signedIn(response: Response, app: ClientApp, result: SignedIn): SessionResponse;
  private signedIn(response: Response, app: ClientApp, result: SignInOutcome): SignInResult;
  private signedIn(response: Response, app: ClientApp, result: SignInOutcome): SignInResult {
    response.setHeader('Cache-Control', 'no-store');
    if ('mfa' in result) return result.mfa;
    setSessionCookies(response, this.config, app, {
      accessToken: result.session.accessToken,
      refreshToken: result.session.refreshToken,
      refreshExpiresAt: result.session.refreshExpiresAt,
    });
    response.setHeader('Cache-Control', 'no-store');
    return result.response;
  }
}
