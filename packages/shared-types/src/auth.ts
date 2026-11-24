/**
 * Platform roles (Master Instructions §7). Permissions attached to each role are
 * configurable data (Phase 2); these names are the stable identifiers used in code.
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

/**
 * The identity attached to an authenticated request (`request.user`).
 * Populated by the authentication module from Phase 2 onwards.
 */
export interface AuthenticatedUser {
  id: string;
  roles: UserRole[];
  /** Set for seller-staff users; every seller-scoped query filters by it. */
  sellerId?: string;
}
