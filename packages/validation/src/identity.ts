import {
  CLIENT_APPS,
  PERMISSION_CODES,
  type Permission,
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
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const roleSchema = z.object({
  code: userRoleSchema,
  name: z.string(),
  description: z.string(),
  /** SUPER_ADMIN cannot be edited. */
  locked: z.boolean(),
  permissions: z.array(permissionSchema),
  userCount: z.number().int(),
});
export type RoleDto = z.infer<typeof roleSchema>;
export const roleListSchema = z.object({
  roles: z.array(roleSchema),
  permissions: z.array(z.object({ code: permissionSchema, description: z.string() })),
});
export type RoleList = z.infer<typeof roleListSchema>;

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
