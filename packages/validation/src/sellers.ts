import {
  BUSINESS_TYPES,
  SELLER_DOCUMENT_TYPES,
  SELLER_EVENT_TYPES,
  SELLER_MEMBER_STATUSES,
  SELLER_PERMISSIONS,
  SELLER_STATUSES,
  STORE_STATUSES,
  ASSIGNABLE_SELLER_ROLES,
  type Permission,
  type UserRole,
} from '@marketplace/shared-types';
import { z } from 'zod';
import { paginatedSchema } from './dev-tools';
import {
  emailAddressSchema,
  passwordSchema,
  personNameSchema,
  phMobileSchema,
  phTinSchema,
  tokenSchema,
  userRoleSchema,
} from './identity';

// ---- Fields ----------------------------------------------------------------------------------

export const sellerStatusSchema = z.enum(SELLER_STATUSES);
export const businessTypeSchema = z.enum(BUSINESS_TYPES);
export const sellerDocumentTypeSchema = z.enum(SELLER_DOCUMENT_TYPES);
export const storeStatusSchema = z.enum(STORE_STATUSES);
export const sellerPermissionSchema = z.enum(SELLER_PERMISSIONS as [Permission, ...Permission[]]);
export const assignableSellerRoleSchema = z.enum(
  ASSIGNABLE_SELLER_ROLES as [UserRole, ...UserRole[]],
);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const businessNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter the registered business name')
  .max(160, 'At most 160 characters');

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'Philippine postal codes have 4 digits');

/** Philippine address. Barangay and second line are optional. */
export const addressSchema = z.object({
  addressLine1: z.string().trim().min(3, 'Enter the street address').max(160),
  addressLine2: optionalText(160),
  barangay: optionalText(100),
  city: z.string().trim().min(2, 'Enter the city or municipality').max(100),
  province: z.string().trim().min(2, 'Enter the province').max(100),
  postalCode: postalCodeSchema,
});
export type Address = z.infer<typeof addressSchema>;

// ---- Seller registration ---------------------------------------------------------------------

/** POST /auth/sellers/sign-up (Seller Center). Creates the owner account and a PENDING seller. */
export const sellerSignUpSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailAddressSchema,
  password: passwordSchema,
  businessName: businessNameSchema,
  businessType: businessTypeSchema,
  mobile: phMobileSchema,
});
export type SellerSignUpRequest = z.input<typeof sellerSignUpSchema>;
export type SellerSignUp = z.output<typeof sellerSignUpSchema>;

/**
 * PATCH /sellers/me. Every field optional. Legal details (name, type, registration, TIN, VAT)
 * can change only before verification; contact details and address can change any time.
 */
export const updateSellerProfileSchema = z
  .object({
    businessName: businessNameSchema,
    businessType: businessTypeSchema,
    email: emailAddressSchema,
    mobile: phMobileSchema,
    registrationNumber: z.string().trim().min(3, 'Enter the registration number').max(40),
    tin: phTinSchema,
    vatRegistered: z.boolean(),
  })
  .extend(addressSchema.shape)
  .partial();
export type UpdateSellerProfileRequest = z.input<typeof updateSellerProfileSchema>;
export type UpdateSellerProfile = z.output<typeof updateSellerProfileSchema>;

export const SELLER_LEGAL_FIELDS = [
  'businessName',
  'businessType',
  'registrationNumber',
  'tin',
  'vatRegistered',
] as const;

// ---- Seller views ---------------------------------------------------------------------------

export const sellerDocumentSchema = z.object({
  id: z.uuid(),
  type: sellerDocumentTypeSchema,
  description: z.string().nullable(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type SellerDocumentDto = z.infer<typeof sellerDocumentSchema>;

export const sellerEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(SELLER_EVENT_TYPES),
  fromStatus: sellerStatusSchema.nullable(),
  toStatus: sellerStatusSchema,
  note: z.string().nullable(),
  /** Staff names are not shown to sellers; "Marketplace team" instead. */
  actor: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SellerEventDto = z.infer<typeof sellerEventSchema>;

export const sellerSummarySchema = z.object({
  id: z.uuid(),
  status: sellerStatusSchema,
  businessName: z.string(),
  businessType: businessTypeSchema,
  owner: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  email: z.string(),
  mobile: z.string(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type SellerSummary = z.infer<typeof sellerSummarySchema>;
export const sellerListSchema = paginatedSchema(sellerSummarySchema);
export type SellerList = z.infer<typeof sellerListSchema>;

export const sellerDetailSchema = sellerSummarySchema.extend({
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  barangay: z.string().nullable(),
  postalCode: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  tin: z.string().nullable(),
  vatRegistered: z.boolean(),
  statusNote: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  documents: z.array(sellerDocumentSchema),
  events: z.array(sellerEventSchema),
  /** What still blocks submission (empty when it can be submitted). */
  missingForSubmission: z.array(z.string()),
  /** Whether legal details (name, type, registration, TIN) can still be edited. */
  legalDetailsEditable: z.boolean(),
  storeCount: z.number().int(),
  memberCount: z.number().int(),
});
export type SellerDetail = z.infer<typeof sellerDetailSchema>;

export const sellerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: sellerStatusSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});
export type SellerListQuery = Partial<z.output<typeof sellerListQuerySchema>>;

export const uploadSellerDocumentSchema = z.object({
  type: sellerDocumentTypeSchema,
  description: optionalText(200),
});

// ---- Admin decisions --------------------------------------------------------------------------

const reasonSchema = z
  .string()
  .trim()
  .min(5, 'Explain the reason (at least 5 characters)')
  .max(1000, 'At most 1000 characters');

/** POST /sellers/{id}/review. A note is required to reject or to ask for more information. */
export const reviewSellerSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO']),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== 'APPROVE' && (!value.note || value.note.length < 5)) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message:
          value.decision === 'REJECT'
            ? 'Tell the seller why the application is rejected'
            : 'Tell the seller what information is needed',
      });
    }
  });
export type ReviewSellerRequest = z.infer<typeof reviewSellerSchema>;

export const sellerReasonSchema = z.object({ reason: reasonSchema });
export type SellerReasonRequest = z.infer<typeof sellerReasonSchema>;

// ---- Stores ----------------------------------------------------------------------------------

export const storeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,58}[a-z0-9]$/,
    'Use 3–60 lowercase letters, numbers and single hyphens; start and end with a letter or number',
  );

/** Reserved so store links never clash with site pages. */
export const RESERVED_STORE_SLUGS = [
  'account',
  'admin',
  'api',
  'cart',
  'checkout',
  'help',
  'login',
  'marketplace',
  'orders',
  'search',
  'sell',
  'seller',
  'sellers',
  'sign-in',
  'sign-up',
  'status',
  'store',
  'stores',
  'support',
] as const;

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .url('Enter a full link starting with https://')
  .refine((url) => url.startsWith('https://'), 'Links must start with https://');

export const socialLinksSchema = z
  .object({
    facebook: httpsUrl,
    instagram: httpsUrl,
    tiktok: httpsUrl,
    youtube: httpsUrl,
    website: httpsUrl,
  })
  .partial();
export type SocialLinks = z.infer<typeof socialLinksSchema>;

const storeContactShape = {
  description: optionalText(2000),
  email: emailAddressSchema.nullable().optional(),
  phone: phMobileSchema.nullable().optional(),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  barangay: optionalText(100),
  city: optionalText(100),
  province: optionalText(100),
  postalCode: postalCodeSchema.nullable().optional(),
  socialLinks: socialLinksSchema.optional(),
};

export const createStoreSchema = z.object({
  name: z.string().trim().min(2, 'Enter the store name').max(120),
  slug: storeSlugSchema,
  ...storeContactShape,
});
export type CreateStoreRequest = z.input<typeof createStoreSchema>;

export const updateStoreSchema = z
  .object({ name: z.string().trim().min(2, 'Enter the store name').max(120), ...storeContactShape })
  .partial();
export type UpdateStoreRequest = z.input<typeof updateStoreSchema>;

const colorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Use a hex colour like #1d4ed8');

export const storeSettingsSchema = z.object({
  primaryColor: colorSchema,
  accentColor: colorSchema.nullable(),
  announcement: z.string().trim().max(280).nullable(),
  shippingPolicy: z.string().trim().max(5000).nullable(),
  returnPolicy: z.string().trim().max(5000).nullable(),
  vacationMode: z.boolean(),
  vacationMessage: z.string().trim().max(280).nullable(),
});
export type StoreSettingsDto = z.infer<typeof storeSettingsSchema>;
export const updateStoreSettingsSchema = storeSettingsSchema.partial();
export type UpdateStoreSettingsRequest = z.input<typeof updateStoreSettingsSchema>;

export const storeSchema = z.object({
  id: z.uuid(),
  sellerId: z.uuid(),
  sellerName: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string().nullable(),
  province: z.string().nullable(),
  postalCode: z.string().nullable(),
  socialLinks: socialLinksSchema,
  status: storeStatusSchema,
  statusNote: z.string().nullable(),
  customDomain: z.string().nullable(),
  settings: storeSettingsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoreDto = z.infer<typeof storeSchema>;
export const storeListSchema = paginatedSchema(storeSchema);
export type StoreList = z.infer<typeof storeListSchema>;
export const myStoresSchema = z.object({ stores: z.array(storeSchema), canCreate: z.boolean() });
export type MyStores = z.infer<typeof myStoresSchema>;

export const storeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: storeStatusSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sellerId: z.uuid().optional(),
});
export type StoreListQuery = Partial<z.output<typeof storeListQuerySchema>>;

/** What shoppers see: no internal ids of people, no status notes. */
export const publicStoreSchema = storeSchema
  .pick({
    id: true,
    name: true,
    slug: true,
    description: true,
    logoUrl: true,
    bannerUrl: true,
    email: true,
    phone: true,
    city: true,
    province: true,
    socialLinks: true,
  })
  .extend({
    sellerName: z.string(),
    settings: storeSettingsSchema.pick({
      primaryColor: true,
      accentColor: true,
      announcement: true,
      shippingPolicy: true,
      returnPolicy: true,
      vacationMode: true,
      vacationMessage: true,
    }),
  });
export type PublicStore = z.infer<typeof publicStoreSchema>;

export const slugAvailabilitySchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  reason: z.string().nullable(),
});
export type SlugAvailability = z.infer<typeof slugAvailabilitySchema>;

// ---- Seller employees ------------------------------------------------------------------------

export const sellerMemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(SELLER_MEMBER_STATUSES),
  isOwner: z.boolean(),
  roles: z.array(userRoleSchema),
  /** Permissions granted to this person on top of their roles. */
  extraPermissions: z.array(sellerPermissionSchema),
  /** Everything they can do (roles plus extra permissions). */
  effectivePermissions: z.array(sellerPermissionSchema),
  joinedAt: z.iso.datetime(),
  lastSignInAt: z.iso.datetime().nullable(),
});
export type SellerMemberDto = z.infer<typeof sellerMemberSchema>;

export const sellerInvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  roles: z.array(userRoleSchema),
  permissions: z.array(sellerPermissionSchema),
  invitedBy: z.string(),
  expiresAt: z.iso.datetime(),
  expired: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type SellerInvitationDto = z.infer<typeof sellerInvitationSchema>;

export const sellerTeamSchema = z.object({
  members: z.array(sellerMemberSchema),
  invitations: z.array(sellerInvitationSchema),
  /** Seller roles and permissions the signed-in user may assign. */
  assignableRoles: z.array(userRoleSchema),
  assignablePermissions: z.array(sellerPermissionSchema),
});
export type SellerTeam = z.infer<typeof sellerTeamSchema>;

export const inviteSellerMemberSchema = z.object({
  email: emailAddressSchema,
  roles: z.array(assignableSellerRoleSchema).min(1, 'Choose at least one role'),
  permissions: z.array(sellerPermissionSchema).default([]),
});
export type InviteSellerMemberRequest = z.input<typeof inviteSellerMemberSchema>;

export const updateSellerMemberSchema = z.object({
  roles: z.array(assignableSellerRoleSchema).min(1, 'Choose at least one role'),
  permissions: z.array(sellerPermissionSchema).default([]),
});
export type UpdateSellerMemberRequest = z.input<typeof updateSellerMemberSchema>;

/** POST /auth/seller-invitations/preview */
export const sellerInvitationPreviewSchema = z.object({
  sellerName: z.string(),
  email: z.string(),
  roles: z.array(userRoleSchema),
  /** An account with this email exists: accept with its password instead of creating one. */
  existingAccount: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export type SellerInvitationPreview = z.infer<typeof sellerInvitationPreviewSchema>;

/**
 * POST /auth/seller-invitations/accept. New people choose a name and password; people who
 * already have an account confirm with its password.
 */
export const acceptSellerInvitationSchema = z.object({
  token: tokenSchema,
  password: z.string().min(1, 'Enter a password').max(128),
  firstName: personNameSchema.optional(),
  lastName: personNameSchema.optional(),
});
export type AcceptSellerInvitationRequest = z.input<typeof acceptSellerInvitationSchema>;
