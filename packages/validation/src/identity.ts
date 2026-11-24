import {
  CLIENT_APPS,
  PERMISSION_CODES,
  type Permission,
  SELLER_STATUSES,
  USER_ROLES,
  type UserRole,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { paginatedSchema } from './dev-tools';

// ---- Field schemas ------------------------------------------------------------------

/**
 * Philippine mobile number in any common format — "0917 123 4567", "+63 917-123-4567",
 * "639171234567" — normalised to E.164 ("+639171234567").
 */
export const phMobileSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s\-().]/g, ''))
  .refine((value) => /^(?:\+?63|0)9\d{9}$/.test(value), {
    message: 'Enter a Philippine mobile number, e.g. 0917 123 4567',
  })
  .transform((value) => `+63${value.slice(-10)}`);

/** Masks a mobile number for display: +63 917 *** 4567. */
export function maskMobile(e164: string): string {
  const local = e164.replace(/^\+63/, '');
  return `+63 ${local.slice(0, 3)} *** ${local.slice(-4)}`;
}

export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'At most 254 characters')
  .pipe(z.email('Enter a valid email address'));

/** NIST SP 800-63B: length over composition rules. */
export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'At most 128 characters')
  .refine((value) => value.trim().length > 0, 'Password cannot be only spaces');

export const personNameSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(80, 'At most 80 characters');

/** Philippine TIN: 9 digits plus an optional 3- to 5-digit branch code; dashes optional. */
export const phTinSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{9}(\d{3,5})?$/.test(value), {
    message: 'Enter a valid TIN, e.g. 123-456-789-000',
  });

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

export const clientAppSchema = z.enum(CLIENT_APPS);
export const userRoleSchema = z.enum(USER_ROLES);
export const permissionSchema = z.enum(PERMISSION_CODES as [Permission, ...Permission[]]);

// ---- Customer sign-up -----------------------------------------------------------------

export const wholesaleBusinessSchema = z.object({
  businessName: z.string().trim().min(2, 'Required').max(160),
  tin: phTinSchema,
  businessAddress: z.string().trim().min(10, 'Enter the complete business address').max(500),
});
export type WholesaleBusiness = z.infer<typeof wholesaleBusinessSchema>;

export const customerSignUpSchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    email: emailAddressSchema,
    mobile: phMobileSchema,
    password: passwordSchema,
    accountType: z.enum(['RETAIL', 'WHOLESALE']).default('RETAIL'),
    business: wholesaleBusinessSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.accountType === 'WHOLESALE' && !value.business) {
      ctx.addIssue({
        code: 'custom',
        path: ['business'],
        message: 'Business details are required',
      });
    }
  });
export type CustomerSignUpRequest = z.input<typeof customerSignUpSchema>;
export type CustomerSignUp = z.output<typeof customerSignUpSchema>;

/** Returned whenever an SMS code was (or would have been) sent. */
export const otpChallengeResponseSchema = z.object({
  challengeId: z.uuid(),
  destination: z.string(),
  expiresAt: z.iso.datetime(),
  resendAvailableAt: z.iso.datetime(),
});
export type OtpChallengeResponse = z.infer<typeof otpChallengeResponseSchema>;

export const otpVerifySchema = z.object({ challengeId: z.uuid(), code: otpCodeSchema });
export type OtpVerifyRequest = z.infer<typeof otpVerifySchema>;

export const otpResendSchema = z.object({ challengeId: z.uuid() });

// ---- Sign-in ------------------------------------------------------------------------------

export const mobileSignInSchema = z.object({ mobile: phMobileSchema });
export type MobileSignInRequest = z.input<typeof mobileSignInSchema>;

export const emailSignInSchema = z.object({
  email: emailAddressSchema,
  // Not validated against the policy: old passwords may predate it.
  password: z.string().min(1, 'Enter your password').max(128),
});
export type EmailSignInRequest = z.infer<typeof emailSignInSchema>;

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Invalid or expired link');

export const verifyEmailSchema = z.object({ token: tokenSchema });
export const forgotPasswordSchema = z.object({ email: emailAddressSchema });
export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const acceptInvitationSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one',
  });

// ---- Session ---------------------------------------------------------------------------------

export const wholesaleStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const sessionUserSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  mobile: z.string().nullable(),
  mobileVerified: z.boolean(),
  roles: z.array(userRoleSchema),
  permissions: z.array(permissionSchema),
  wholesaleStatus: wholesaleStatusSchema.nullable(),
  /** Whether two-step verification (authenticator app) is on. */
  mfaEnabled: z.boolean(),
  /** The seller this user works for (active membership), or null. */
  seller: z
    .object({
      id: z.uuid(),
      businessName: z.string(),
      status: z.enum(SELLER_STATUSES),
      isOwner: z.boolean(),
    })
    .nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  app: clientAppSchema,
  /** When the access token expires; the client refreshes shortly before. */
  accessTokenExpiresAt: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const csrfResponseSchema = z.object({ csrfToken: z.string() });

// ---- Two-step verification (authenticator app) -----------------------------------------------

/** Six-digit authenticator code, or an XXXX-XXXX recovery code. */
export const mfaCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(\d{6}|[A-Z0-9]{4}-?[A-Z0-9]{4})$/, 'Enter the 6-digit code or a recovery code');

/** Returned by sign-in instead of a session when the account has two-step verification on. */
export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string(),
  expiresAt: z.iso.datetime(),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

/** Result of a sign-in step: a session, or a request for the authenticator code. */
export const signInResultSchema = z.union([mfaChallengeResponseSchema, sessionResponseSchema]);
export type SignInResult = z.infer<typeof signInResultSchema>;
export const isMfaChallenge = (result: SignInResult): result is MfaChallengeResponse =>
  'mfaRequired' in result;

export const mfaVerifySchema = z.object({
  mfaToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'Sign in again'),
  code: mfaCodeSchema,
});
export type MfaVerifyRequest = z.input<typeof mfaVerifySchema>;

export const mfaStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.iso.datetime().nullable(),
  recoveryCodesRemaining: z.number().int(),
});
export type MfaStatus = z.infer<typeof mfaStatusSchema>;

export const mfaSetupRequestSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(128),
});
export const mfaSetupResponseSchema = z.object({
  /** Base32 secret for manual entry. */
  secret: z.string(),
  /** otpauth:// URI for the QR code. */
  otpauthUrl: z.string(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const mfaEnableSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const mfaRecoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string()) });
export type MfaRecoveryCodes = z.infer<typeof mfaRecoveryCodesSchema>;
export const mfaDisableSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(128),
  code: mfaCodeSchema,
});
export const mfaRegenerateSchema = z.object({ code: mfaCodeSchema });

// ---- Administration ------------------------------------------------------------------------

export const USER_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const;

export const createStaffUserSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailAddressSchema,
  roles: z.array(userRoleSchema).min(1, 'Choose at least one role'),
});
export type CreateStaffUserRequest = z.infer<typeof createStaffUserSchema>;

export const updateUserSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  roles: z.array(userRoleSchema).min(1, 'Choose at least one role'),
});
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  role: userRoleSchema.optional(),
  status: z.enum(USER_STATUSES).optional(),
  kind: z.enum(['staff', 'customers']).optional(),
});
/** What a client sends; every field is optional. */
export type UserListQuery = Partial<z.output<typeof userListQuerySchema>>;
export type UserListFilters = z.output<typeof userListQuerySchema>;

export const adminUserSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  mobile: z.string().nullable(),
  mobileVerified: z.boolean(),
  status: z.enum(USER_STATUSES),
  roles: z.array(userRoleSchema),
  lastSignInAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;
export const adminUserListSchema = paginatedSchema(adminUserSchema);

export const adminUserDetailSchema = adminUserSchema.extend({
  activeSessions: z.number().int(),
  lockedUntil: z.iso.datetime().nullable(),
  mfaEnabled: z.boolean(),
  seller: z
    .object({
      id: z.uuid(),
      businessName: z.string(),
      status: z.enum(SELLER_STATUSES),
      isOwner: z.boolean(),
      memberStatus: z.enum(['ACTIVE', 'SUSPENDED']),
    })
    .nullable(),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const roleScopeSchema = z.enum(['platform', 'seller', 'customer']);
export const permissionScopeSchema = z.enum(['platform', 'seller']);

export const roleSchema = z.object({
  code: userRoleSchema,
  name: z.string(),
  description: z.string(),
  scope: roleScopeSchema,
  /** Locked roles (SUPER_ADMIN, SELLER_OWNER) always hold every permission of their scope. */
  locked: z.boolean(),
  permissions: z.array(permissionSchema),
  userCount: z.number().int(),
});
export type RoleDto = z.infer<typeof roleSchema>;
export const roleListSchema = z.object({
  roles: z.array(roleSchema),
  permissions: z.array(
    z.object({ code: permissionSchema, description: z.string(), scope: permissionScopeSchema }),
  ),
});
export type RoleList = z.infer<typeof roleListSchema>;

/** GET /permissions: the catalog with the roles that hold each permission. */
export const permissionListSchema = z.object({
  permissions: z.array(
    z.object({
      code: permissionSchema,
      description: z.string(),
      scope: permissionScopeSchema,
      roles: z.array(userRoleSchema),
    }),
  ),
});
export type PermissionList = z.infer<typeof permissionListSchema>;

export const updateRolePermissionsSchema = z.object({ permissions: z.array(permissionSchema) });

export const wholesaleApplicationSchema = z.object({
  id: z.uuid(),
  status: wholesaleStatusSchema,
  businessName: z.string(),
  tin: z.string(),
  businessAddress: z.string(),
  applicant: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    mobile: z.string().nullable(),
  }),
  reviewNote: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type WholesaleApplicationDto = z.infer<typeof wholesaleApplicationSchema>;
export const wholesaleApplicationListSchema = paginatedSchema(wholesaleApplicationSchema);
export type WholesaleApplicationList = z.infer<typeof wholesaleApplicationListSchema>;
/** The signed-in customer's own application; null when they never applied. */
export const myWholesaleApplicationSchema = z.object({
  application: wholesaleApplicationSchema.nullable(),
});
export type MyWholesaleApplication = z.infer<typeof myWholesaleApplicationSchema>;

export const wholesaleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: wholesaleStatusSchema.optional(),
});
export type WholesaleListQuery = Partial<z.output<typeof wholesaleListQuerySchema>>;

export const reviewWholesaleSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECT' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Tell the customer why' });
    }
  });
export type ReviewWholesaleRequest = z.infer<typeof reviewWholesaleSchema>;

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(100).optional(),
  actorId: z.uuid().optional(),
  entityId: z.string().trim().max(100).optional(),
});
export type AuditLogQuery = Partial<z.output<typeof auditLogQuerySchema>>;

export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  outcome: z.enum(['SUCCESS', 'FAILURE']),
  actor: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export const auditLogListSchema = paginatedSchema(auditLogEntrySchema);
export type AuditLogList = z.infer<typeof auditLogListSchema>;

export const devSmsMessageSchema = z.object({
  to: z.string(),
  body: z.string(),
  sentAt: z.iso.datetime(),
});
export const devSmsOutboxSchema = z.object({ messages: z.array(devSmsMessageSchema) });
export type DevSmsOutbox = z.infer<typeof devSmsOutboxSchema>;

export type { Permission, UserRole };
