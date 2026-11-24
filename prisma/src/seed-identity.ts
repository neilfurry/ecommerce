import {
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED_ROLES,
  PERMISSION_CODES,
  PERMISSIONS,
  ROLE_LABELS,
  USER_ROLES,
  type UserRole,
} from '@marketplace/shared-types';
import type { PrismaClient } from './generated/prisma/client';
import { hashPassword } from './password';

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Full access to everything, including role permissions. Cannot be edited.',
  ADMIN: 'Runs day-to-day marketplace operations and manages staff accounts.',
  FINANCE_ADMIN: 'Commissions, settlements, payouts and reconciliation.',
  CUSTOMER_SUPPORT: 'Helps customers and sellers with accounts and orders.',
  SELLER_OWNER: 'Owns a seller store and manages its staff.',
  SELLER_MANAGER: 'Manages a store on behalf of its owner.',
  SELLER_ENCODER: 'Creates and edits a store’s product listings.',
  SELLER_INVENTORY: 'Maintains a store’s stock levels.',
  SELLER_ORDER_PROCESSOR: 'Fulfils a store’s orders.',
  SELLER_ACCOUNTING: 'Views a store’s sales, payouts and statements.',
  WAREHOUSE_STAFF: 'Receives, stores and dispatches goods in platform warehouses.',
  DELIVERY_STAFF: 'Delivers orders handled by the platform.',
  CUSTOMER: 'Buys at retail prices.',
  WHOLESALE_CUSTOMER: 'Approved business customer with access to wholesale prices.',
};

/**
 * Synchronises roles and permissions with the catalog in @marketplace/shared-types.
 * Idempotent and safe in production:
 *  - new roles and permissions are created with their default grants;
 *  - existing grants that an admin edited are left alone;
 *  - locked roles (SUPER_ADMIN) always hold every permission;
 *  - permissions removed from the catalog are deleted (with their grants).
 */
export async function syncRolesAndPermissions(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existingPermissions = new Set(
      (await tx.permission.findMany({ select: { code: true } })).map((p) => p.code),
    );
    const newPermissions = PERMISSION_CODES.filter((code) => !existingPermissions.has(code));
    for (const code of PERMISSION_CODES) {
      await tx.permission.upsert({
        where: { code },
        create: { code, description: PERMISSIONS[code] },
        update: { description: PERMISSIONS[code] },
      });
    }
    await tx.permission.deleteMany({ where: { code: { notIn: PERMISSION_CODES } } });

    const existingRoles = new Set(
      (await tx.role.findMany({ select: { code: true } })).map((r) => r.code),
    );
    for (const code of USER_ROLES) {
      const isLocked = LOCKED_ROLES.includes(code);
      await tx.role.upsert({
        where: { code },
        create: { code, name: ROLE_LABELS[code], description: ROLE_DESCRIPTIONS[code], isLocked },
        update: { name: ROLE_LABELS[code], description: ROLE_DESCRIPTIONS[code], isLocked },
      });
      const defaults = isLocked
        ? PERMISSION_CODES
        : existingRoles.has(code)
          ? DEFAULT_ROLE_PERMISSIONS[code].filter((p) => newPermissions.includes(p))
          : DEFAULT_ROLE_PERMISSIONS[code];
      if (defaults.length > 0) {
        await tx.rolePermission.createMany({
          data: defaults.map((permissionCode) => ({ roleCode: code, permissionCode })),
          skipDuplicates: true,
        });
      }
    }
  });
}

export interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  roles: UserRole[];
  mobile?: string;
}

/** Creates a verified, active user if the email is not taken. Returns true when created. */
export async function ensureUser(
  prisma: PrismaClient,
  user: SeedUser,
  password: string,
): Promise<boolean> {
  const existing = await prisma.user.findUnique({ where: { email: user.email } });
  if (existing) return false;
  const now = new Date();
  await prisma.user.create({
    data: {
      email: user.email,
      emailVerifiedAt: now,
      mobile: user.mobile ?? null,
      mobileVerifiedAt: user.mobile ? now : null,
      passwordHash: await hashPassword(password),
      passwordChangedAt: now,
      firstName: user.firstName,
      lastName: user.lastName,
      status: 'ACTIVE',
      roles: { create: user.roles.map((roleCode) => ({ roleCode })) },
    },
  });
  return true;
}

/** Development-only demo accounts, one per frontend (see docs/development/LOCAL_DATABASE.md). */
export const DEMO_USERS: SeedUser[] = [
  {
    email: 'superadmin@marketplace.local',
    firstName: 'Sofia',
    lastName: 'Super',
    roles: ['SUPER_ADMIN'],
  },
  { email: 'admin@marketplace.local', firstName: 'Andres', lastName: 'Admin', roles: ['ADMIN'] },
  {
    email: 'support@marketplace.local',
    firstName: 'Carla',
    lastName: 'Support',
    roles: ['CUSTOMER_SUPPORT'],
  },
  {
    email: 'seller.owner@marketplace.local',
    firstName: 'Sam',
    lastName: 'Seller',
    roles: ['SELLER_OWNER'],
  },
  {
    email: 'customer@marketplace.local',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    roles: ['CUSTOMER'],
    mobile: '+639170000001',
  },
];
