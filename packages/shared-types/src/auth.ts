/**
 * Platform roles (Master Instructions §7). The permissions attached to each role are
 * configurable data (roles table); these codes are the stable identifiers used in code.
 */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE_ADMIN',
  'CUSTOMER_SUPPORT',
  'SELLER_OWNER',
  'SELLER_MANAGER',
  'SELLER_ENCODER',
  'SELLER_INVENTORY',
  'SELLER_ORDER_PROCESSOR',
  'SELLER_ACCOUNTING',
  'WAREHOUSE_STAFF',
  'DELIVERY_STAFF',
  'CUSTOMER',
  'WHOLESALE_CUSTOMER',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles that act on behalf of one seller and must be scoped to that seller's data. */
export const SELLER_ROLES = [
  'SELLER_OWNER',
  'SELLER_MANAGER',
  'SELLER_ENCODER',
  'SELLER_INVENTORY',
  'SELLER_ORDER_PROCESSOR',
  'SELLER_ACCOUNTING',
] as const satisfies readonly UserRole[];

/** Platform staff who sign in to the Admin Console. */
export const PLATFORM_STAFF_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'FINANCE_ADMIN',
  'CUSTOMER_SUPPORT',
  'WAREHOUSE_STAFF',
  'DELIVERY_STAFF',
] as const satisfies readonly UserRole[];

export const CUSTOMER_ROLES = [
  'CUSTOMER',
  'WHOLESALE_CUSTOMER',
] as const satisfies readonly UserRole[];

/**
 * Only customers can create their own account. Every other role is created by an admin
 * (decision of 2026-11-25). WHOLESALE_CUSTOMER is granted when an admin approves the
 * customer's wholesale application; until then the account has CUSTOMER only.
 */
export const SELF_REGISTRATION_ROLES = CUSTOMER_ROLES;

/** The three frontends. Each has its own session cookies and accepts only its own roles. */
export const CLIENT_APPS = ['storefront', 'seller', 'admin'] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

export const CLIENT_APP_ROLES: Record<ClientApp, readonly UserRole[]> = {
  storefront: CUSTOMER_ROLES,
  seller: SELLER_ROLES,
  admin: PLATFORM_STAFF_ROLES,
};

/** Header every frontend sends so the API knows which app's session cookies to use. */
export const CLIENT_APP_HEADER = 'x-client-app';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * The identity attached to an authenticated request (`request.user`), resolved from the
 * access token and the user's current roles and permissions.
 */
export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  app: ClientApp;
  roles: UserRole[];
  permissions: Permission[];
  /** ISO time the current access token expires (the client refreshes before then). */
  accessTokenExpiresAt: string;
  /** Set for seller-staff users from Phase 3; every seller-scoped query filters by it. */
  sellerId?: string;
}

export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';
export type WholesaleApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// ---- Permissions ---------------------------------------------------------------

/**
 * Every permission the code checks. Which roles hold which permissions is data
 * (role_permissions), editable by a SUPER_ADMIN in the Admin Console. New phases add
 * permissions here and grant defaults in the seed.
 */
export const PERMISSIONS = {
  'users.read': 'View staff and customer accounts',
  'users.create': 'Create staff accounts and send invitations',
  'users.update': 'Change names and roles of accounts',
  'users.suspend': 'Suspend and reactivate accounts',
  'users.sessions.revoke': 'Sign accounts out of all devices',
  'roles.read': 'View roles and their permissions',
  'roles.update': 'Change which permissions each role has',
  'wholesale.read': 'View wholesale applications',
  'wholesale.review': 'Approve or reject wholesale applications',
  'audit.read': 'View the audit log',
  'dev-tools.use': 'Use the development tools (never available in production)',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

/** SUPER_ADMIN always holds every permission; it cannot be edited (prevents lock-out). */
export const LOCKED_ROLES: readonly UserRole[] = ['SUPER_ADMIN'];

/** Default grants, written by the seed. Editable afterwards (except SUPER_ADMIN). */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSION_CODES,
  ADMIN: [
    'users.read',
    'users.create',
    'users.update',
    'users.suspend',
    'users.sessions.revoke',
    'roles.read',
    'wholesale.read',
    'wholesale.review',
    'audit.read',
  ],
  FINANCE_ADMIN: ['users.read', 'audit.read'],
  CUSTOMER_SUPPORT: ['users.read', 'users.sessions.revoke', 'wholesale.read'],
  WAREHOUSE_STAFF: [],
  DELIVERY_STAFF: [],
  SELLER_OWNER: [],
  SELLER_MANAGER: [],
  SELLER_ENCODER: [],
  SELLER_INVENTORY: [],
  SELLER_ORDER_PROCESSOR: [],
  SELLER_ACCOUNTING: [],
  CUSTOMER: [],
  WHOLESALE_CUSTOMER: [],
};

/**
 * Which roles an administrator may grant. Granting the two highest roles is reserved to
 * SUPER_ADMIN; seller roles are granted through seller onboarding (Phase 3).
 */
export function grantableRoles(granterRoles: readonly UserRole[]): UserRole[] {
  if (granterRoles.includes('SUPER_ADMIN')) return [...PLATFORM_STAFF_ROLES];
  if (granterRoles.includes('ADMIN')) {
    return PLATFORM_STAFF_ROLES.filter((role) => role !== 'SUPER_ADMIN' && role !== 'ADMIN');
  }
  return [];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  FINANCE_ADMIN: 'Finance admin',
  CUSTOMER_SUPPORT: 'Customer support',
  SELLER_OWNER: 'Seller owner',
  SELLER_MANAGER: 'Seller manager',
  SELLER_ENCODER: 'Seller encoder',
  SELLER_INVENTORY: 'Seller inventory',
  SELLER_ORDER_PROCESSOR: 'Seller order processor',
  SELLER_ACCOUNTING: 'Seller accounting',
  WAREHOUSE_STAFF: 'Warehouse staff',
  DELIVERY_STAFF: 'Delivery staff',
  CUSTOMER: 'Customer',
  WHOLESALE_CUSTOMER: 'Wholesale customer',
};
