import type { SellerStatus } from './sellers';

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
 * Roles an account can obtain without an administrator (decisions of 2026-11-25):
 * customers sign up in the storefront (WHOLESALE_CUSTOMER is granted when an admin approves
 * their wholesale application), and sellers apply in the Seller Center as SELLER_OWNER of a
 * PENDING seller that sells nothing until an admin verifies it. Seller staff are invited by
 * their seller; platform staff are created by an administrator.
 */
export const SELF_REGISTRATION_ROLES = [
  ...CUSTOMER_ROLES,
  'SELLER_OWNER',
] as const satisfies readonly UserRole[];

/** Where a role applies: the whole platform, one seller's account, or a customer's own data. */
export type RoleScope = 'platform' | 'seller' | 'customer';
export function roleScope(role: UserRole): RoleScope {
  if ((SELLER_ROLES as readonly UserRole[]).includes(role)) return 'seller';
  if ((CUSTOMER_ROLES as readonly UserRole[]).includes(role)) return 'customer';
  return 'platform';
}

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
  /**
   * The seller this user works for (active membership only). Every seller-scoped query
   * filters by it; seller-scope permissions are only ever granted through it.
   */
  sellerId?: string;
  /** Membership details when signed in to the Seller Center as a seller member. */
  seller?: {
    id: string;
    memberId: string;
    isOwner: boolean;
    status: SellerStatus;
  };
}

export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';
export type WholesaleApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// ---- Permissions ---------------------------------------------------------------

/**
 * Every permission the code checks, with its scope. Platform permissions are held by
 * platform staff roles; seller permissions apply only inside the holder's own seller account
 * (through an active seller membership). Which roles hold which permissions is data
 * (role_permissions), editable in the Admin Console; seller owners can also grant seller
 * permissions to individual employees. New phases add permissions here.
 */
export const PERMISSION_CATALOG = {
  'users.read': { scope: 'platform', description: 'View staff, seller and customer accounts' },
  'users.create': { scope: 'platform', description: 'Create staff accounts and send invitations' },
  'users.update': {
    scope: 'platform',
    description: 'Change names and roles of accounts, reset two-step verification',
  },
  'users.suspend': { scope: 'platform', description: 'Suspend and reactivate accounts' },
  'users.sessions.revoke': { scope: 'platform', description: 'Sign accounts out of all devices' },
  'roles.read': { scope: 'platform', description: 'View roles and their permissions' },
  'roles.update': { scope: 'platform', description: 'Change which permissions each role has' },
  'wholesale.read': { scope: 'platform', description: 'View wholesale applications' },
  'wholesale.review': {
    scope: 'platform',
    description: 'Approve or reject wholesale applications',
  },
  'sellers.read': {
    scope: 'platform',
    description: 'View seller applications, details and documents',
  },
  'sellers.review': {
    scope: 'platform',
    description: 'Approve, reject or request more information from sellers',
  },
  'sellers.suspend': { scope: 'platform', description: 'Suspend, reinstate and close sellers' },
  'stores.read': { scope: 'platform', description: 'View all stores' },
  'stores.manage': { scope: 'platform', description: 'Suspend and reinstate stores' },
  'audit.read': { scope: 'platform', description: 'View the audit log' },
  'dev-tools.use': {
    scope: 'platform',
    description: 'Use the development tools (never available in production)',
  },
  'seller.profile.manage': {
    scope: 'seller',
    description: 'Edit the business profile, upload documents and submit for verification',
  },
  'seller.store.manage': {
    scope: 'seller',
    description: 'Create stores and edit store details, images and settings',
  },
  'seller.members.read': { scope: 'seller', description: 'View employees and invitations' },
  'seller.members.manage': {
    scope: 'seller',
    description: 'Invite, edit, suspend and remove employees',
  },
} as const satisfies Record<string, { scope: 'platform' | 'seller'; description: string }>;
export type Permission = keyof typeof PERMISSION_CATALOG;
export type PermissionScope = (typeof PERMISSION_CATALOG)[Permission]['scope'];
export const PERMISSION_CODES = Object.keys(PERMISSION_CATALOG) as Permission[];
export const PERMISSIONS = Object.fromEntries(
  PERMISSION_CODES.map((code) => [code, PERMISSION_CATALOG[code].description]),
) as Record<Permission, string>;
export const permissionsInScope = (scope: PermissionScope): Permission[] =>
  PERMISSION_CODES.filter((code) => PERMISSION_CATALOG[code].scope === scope);
export const PLATFORM_PERMISSIONS = permissionsInScope('platform');
export const SELLER_PERMISSIONS = permissionsInScope('seller');

/**
 * Locked roles always hold every permission of their scope and cannot be edited:
 * SUPER_ADMIN (platform) prevents lock-out; SELLER_OWNER (seller) keeps owners in control.
 */
export const LOCKED_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'SELLER_OWNER'];

/** Permissions a role may hold: only those of its own scope (customers hold none). */
export function assignablePermissions(role: UserRole): Permission[] {
  const scope = roleScope(role);
  return scope === 'customer' ? [] : permissionsInScope(scope);
}

/** Default grants, written by the seed. Editable afterwards (except locked roles). */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: PLATFORM_PERMISSIONS,
  ADMIN: [
    'users.read',
    'users.create',
    'users.update',
    'users.suspend',
    'users.sessions.revoke',
    'roles.read',
    'wholesale.read',
    'wholesale.review',
    'sellers.read',
    'sellers.review',
    'sellers.suspend',
    'stores.read',
    'stores.manage',
    'audit.read',
  ],
  FINANCE_ADMIN: ['users.read', 'sellers.read', 'stores.read', 'audit.read'],
  CUSTOMER_SUPPORT: [
    'users.read',
    'users.sessions.revoke',
    'wholesale.read',
    'sellers.read',
    'stores.read',
  ],
  WAREHOUSE_STAFF: [],
  DELIVERY_STAFF: [],
  SELLER_OWNER: SELLER_PERMISSIONS,
  SELLER_MANAGER: ['seller.store.manage', 'seller.members.read', 'seller.members.manage'],
  SELLER_ENCODER: ['seller.members.read'],
  SELLER_INVENTORY: ['seller.members.read'],
  SELLER_ORDER_PROCESSOR: ['seller.members.read'],
  SELLER_ACCOUNTING: ['seller.members.read'],
  CUSTOMER: [],
  WHOLESALE_CUSTOMER: [],
};

/**
 * Which platform roles an administrator may grant. Granting the two highest roles is
 * reserved to SUPER_ADMIN. Seller roles are granted by sellers to their own employees.
 */
export function grantableRoles(granterRoles: readonly UserRole[]): UserRole[] {
  if (granterRoles.includes('SUPER_ADMIN')) return [...PLATFORM_STAFF_ROLES];
  if (granterRoles.includes('ADMIN')) {
    return PLATFORM_STAFF_ROLES.filter((role) => role !== 'SUPER_ADMIN' && role !== 'ADMIN');
  }
  return [];
}

/** Seller roles an employee may be given by the owner (all but owner) or a manager (below manager). */
export const ASSIGNABLE_SELLER_ROLES = SELLER_ROLES.filter((role) => role !== 'SELLER_OWNER');
export function grantableSellerRoles(granterRoles: readonly UserRole[]): UserRole[] {
  if (granterRoles.includes('SELLER_OWNER')) return [...ASSIGNABLE_SELLER_ROLES];
  if (granterRoles.includes('SELLER_MANAGER')) {
    return ASSIGNABLE_SELLER_ROLES.filter((role) => role !== 'SELLER_MANAGER');
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
