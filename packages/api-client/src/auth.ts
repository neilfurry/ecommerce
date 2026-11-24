import {
  type AcceptSellerInvitationRequest,
  type CustomerSignUpRequest,
  type MfaRecoveryCodes,
  mfaRecoveryCodesSchema,
  type MfaSetupResponse,
  mfaSetupResponseSchema,
  type MfaStatus,
  mfaStatusSchema,
  type SellerInvitationPreview,
  sellerInvitationPreviewSchema,
  type SellerSignUpRequest,
  type SignInResult,
  signInResultSchema,
  type MobileSignInRequest,
  type OtpChallengeResponse,
  otpChallengeResponseSchema,
  type SessionResponse,
  sessionResponseSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';
import { ApiError } from './errors';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;

const noContent = z.unknown();

/** /api/v1/auth: sign-up, sign-in, session and password flows. */
export function createAuthClient(request: Request) {
  const post = <TSchema extends z.ZodType>(path: string, body: unknown, schema: TSchema) =>
    request(path, { method: 'POST', body, schema, skipRefresh: true });

  return {
    /** The current session, or null when signed out. */
    async session(signal?: AbortSignal): Promise<SessionResponse | null> {
      try {
        return await request('/auth/session', { schema: sessionResponseSchema, signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },

    // ---- Customers (storefront) ----
    startSignUp: (body: CustomerSignUpRequest): Promise<OtpChallengeResponse> =>
      post('/auth/customers/sign-up', body, otpChallengeResponseSchema),
    completeSignUp: (challengeId: string, code: string): Promise<SessionResponse> =>
      post('/auth/customers/sign-up/verify', { challengeId, code }, sessionResponseSchema),
    resendCode: (challengeId: string): Promise<OtpChallengeResponse> =>
      post('/auth/otp/resend', { challengeId }, otpChallengeResponseSchema),
    requestSignInCode: (body: MobileSignInRequest): Promise<OtpChallengeResponse> =>
      post('/auth/customers/sign-in/otp', body, otpChallengeResponseSchema),
    /** A session, or an MFA challenge when the account uses two-step verification. */
    completeSignInWithCode: (challengeId: string, code: string): Promise<SignInResult> =>
      post('/auth/customers/sign-in/otp/verify', { challengeId, code }, signInResultSchema),

    // ---- Sellers (Seller Center) ----
    signUpSeller: (body: SellerSignUpRequest): Promise<SessionResponse> =>
      post('/auth/sellers/sign-up', body, sessionResponseSchema),
    previewSellerInvitation: (token: string): Promise<SellerInvitationPreview> =>
      post('/auth/seller-invitations/preview', { token }, sellerInvitationPreviewSchema),
    acceptSellerInvitation: (body: AcceptSellerInvitationRequest) =>
      post('/auth/seller-invitations/accept', body, noContent).then(() => undefined),

    // ---- Everyone ----
    /** A session, or an MFA challenge when the account uses two-step verification. */
    signIn: (email: string, password: string): Promise<SignInResult> =>
      post('/auth/sign-in', { email, password }, signInResultSchema),
    /** Second sign-in step: the authenticator or recovery code. */
    verifyMfa: (mfaToken: string, code: string): Promise<SessionResponse> =>
      post('/auth/mfa/verify', { mfaToken, code }, sessionResponseSchema),

    // ---- Two-step verification settings ----
    mfa: {
      status: (signal?: AbortSignal): Promise<MfaStatus> =>
        request('/auth/mfa', { schema: mfaStatusSchema, signal }),
      setup: (password: string): Promise<MfaSetupResponse> =>
        request('/auth/mfa/totp/setup', {
          method: 'POST',
          body: { password },
          schema: mfaSetupResponseSchema,
        }),
      enable: (code: string): Promise<MfaRecoveryCodes> =>
        request('/auth/mfa/totp/enable', {
          method: 'POST',
          body: { code },
          schema: mfaRecoveryCodesSchema,
        }),
      regenerate: (code: string): Promise<MfaRecoveryCodes> =>
        request('/auth/mfa/recovery-codes', {
          method: 'POST',
          body: { code },
          schema: mfaRecoveryCodesSchema,
        }),
      disable: (password: string, code: string) =>
        request('/auth/mfa/disable', {
          method: 'POST',
          body: { password, code },
          schema: noContent,
        }).then(() => undefined),
    },
    signOut: () => post('/auth/sign-out', undefined, noContent).then(() => undefined),
    signOutEverywhere: () =>
      request('/auth/sign-out-everywhere', { method: 'POST', schema: noContent }).then(
        () => undefined,
      ),
    verifyEmail: (token: string) =>
      post('/auth/email/verify', { token }, noContent).then(() => undefined),
    resendVerificationEmail: () =>
      request('/auth/email/resend-verification', { method: 'POST', schema: noContent }).then(
        () => undefined,
      ),
    forgotPassword: (email: string) =>
      post('/auth/password/forgot', { email }, noContent).then(() => undefined),
    resetPassword: (token: string, password: string) =>
      post('/auth/password/reset', { token, password }, noContent).then(() => undefined),
    acceptInvitation: (token: string, password: string) =>
      post('/auth/invitations/accept', { token, password }, noContent).then(() => undefined),
    changePassword: (currentPassword: string, newPassword: string) =>
      request('/auth/password/change', {
        method: 'POST',
        body: { currentPassword, newPassword },
        schema: noContent,
      }).then(() => undefined),
  };
}
