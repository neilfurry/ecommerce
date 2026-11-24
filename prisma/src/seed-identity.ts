import {
  assignablePermissions,
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED_ROLES,
  PERMISSION_CATALOG,
  PERMISSION_CODES,
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
  SELLER_OWNER: 'Owns a seller account: business profile, stores and employees. Cannot be edited.',
  SELLER_MANAGER: 'Manages stores and employees on behalf of the owner.',
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
 *  - locked roles (SUPER_ADMIN, SELLER_OWNER) always hold every permission of their scope;
 *  - a role never keeps a permission of another scope (seller permissions stay with seller roles);
 *  - permissions removed from the catalog are deleted (with their grants).
 */
export async function syncRolesAndPermissions(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existingPermissions = new Set(
      (await tx.permission.findMany({ select: { code: true } })).map((p) => p.code),
    );
    const newPermissions = PERMISSION_CODES.filter((code) => !existingPermissions.has(code));
    for (const code of PERMISSION_CODES) {
      const { scope, description } = PERMISSION_CATALOG[code];
      await tx.permission.upsert({
        where: { code },
        create: { code, scope, description },
        update: { scope, description },
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
      const allowed = assignablePermissions(code);
      await tx.rolePermission.deleteMany({
        where: { roleCode: code, permissionCode: { notIn: allowed } },
      });
      const defaults = isLocked
        ? allowed
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
    email: 'seller.staff@marketplace.local',
    firstName: 'Ella',
    lastName: 'Encoder',
    roles: ['SELLER_ENCODER'],
  },
  {
    email: 'customer@marketplace.local',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    roles: ['CUSTOMER'],
    mobile: '+639170000001',
  },
];

/**
 * Development-only demo seller: verified, owned by seller.owner@, with seller.staff@ as an
 * encoder and one open store. Does nothing if the owner already has a seller.
 */
export async function ensureDemoSeller(prisma: PrismaClient): Promise<boolean> {
  const owner = await prisma.user.findUnique({
    where: { email: 'seller.owner@marketplace.local' },
    include: { ownedSeller: true },
  });
  const staff = await prisma.user.findUnique({
    where: { email: 'seller.staff@marketplace.local' },
  });
  if (!owner || owner.ownedSeller) return false;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.create({
      data: {
        businessName: 'Sam Sari-Sari Trading',
        businessType: 'SOLE_PROPRIETORSHIP',
        ownerId: owner.id,
        email: owner.email,
        mobile: '+639170000002',
        addressLine1: '12 Rizal Avenue',
        barangay: 'San Antonio',
        city: 'Pasig City',
        province: 'Metro Manila',
        postalCode: '1600',
        registrationNumber: 'DTI-1234567',
        tin: '123456789000',
        status: 'VERIFIED',
        submittedAt: now,
        reviewedAt: now,
        verifiedAt: now,
        events: {
          create: [
            { type: 'REGISTERED', toStatus: 'PENDING' },
            {
              type: 'APPROVED',
              fromStatus: 'UNDER_REVIEW',
              toStatus: 'VERIFIED',
              note: 'Demo seller',
            },
          ],
        },
        members: {
          create: [
            { userId: owner.id },
            ...(staff ? [{ userId: staff.id, invitedById: owner.id }] : []),
          ],
        },
      },
    });
    await tx.store.create({
      data: {
        sellerId: seller.id,
        name: 'Sam Sari-Sari',
        slug: 'sam-sari-sari',
        description: 'Everyday groceries and household goods, delivered across Metro Manila.',
        email: owner.email,
        phone: '+639170000002',
        city: 'Pasig City',
        province: 'Metro Manila',
        settings: { create: {} },
      },
    });
  });
  return true;
}
