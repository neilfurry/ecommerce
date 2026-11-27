import { Inject, Injectable } from '@nestjs/common';
import { REDIS_KEYS } from '@marketplace/config';
import {
  PERMISSION_CATALOG,
  type Permission,
  roleScope,
  type SellerStatus,
  type UserRole,
  type UserStatus,
} from '@marketplace/shared-types';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

/** What every authenticated request needs to know about its user. */
export interface Principal {
  userId: string;
  status: UserStatus;
  /** Two-step verification is on. */
  mfaEnabled: boolean;
  roles: UserRole[];
  permissions: Permission[];
  /** Active seller membership, if any. Seller roles and permissions exist only through it. */
  seller: {
    id: string;
    memberId: string;
    businessName: string;
    status: SellerStatus;
    isOwner: boolean;
  } | null;
}

const CACHE_TTL_SECONDS = 60;

/**
 * Resolves a user's status, roles and effective permissions, cached in Redis for 60 s.
 * Changing a user's roles or status invalidates that user; changing a role's permissions
 * bumps a global version that is part of every cache key.
 */
@Injectable()
export class PrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async load(userId: string): Promise<Principal | null> {
    const version = (await this.redis.get(REDIS_KEYS.PERMISSIONS_VERSION)) ?? '0';
    const key = `${REDIS_KEYS.PRINCIPAL_PREFIX}${userId}:${version}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as Principal;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        mfa: { select: { enabledAt: true } },
        roles: {
          select: {
            role: {
              select: { code: true, permissions: { select: { permissionCode: true } } },
            },
          },
        },
        sellerMembership: {
          select: {
            id: true,
            status: true,
            permissions: { select: { permissionCode: true } },
            seller: { select: { id: true, businessName: true, status: true, ownerId: true } },
          },
        },
      },
    });
    if (!user) return null;

    // Seller roles count only while the person is an active member of an open seller, so
    // suspending or removing an employee (or closing the seller) takes effect at once.
    const membership = user.sellerMembership;
    const activeMembership =
      membership && membership.status === 'ACTIVE' && membership.seller.status !== 'CLOSED'
        ? membership
        : null;
    const roles = user.roles.filter(
      (r) => roleScope(r.role.code as UserRole) !== 'seller' || activeMembership,
    );
    // A role only ever contributes permissions of its own scope.
    const fromRoles = roles.flatMap((r) => {
      const scope = roleScope(r.role.code as UserRole);
      return r.role.permissions
        .map((p) => p.permissionCode as Permission)
        .filter((code) => PERMISSION_CATALOG[code]?.scope === scope);
    });
    const extra = (activeMembership?.permissions ?? [])
      .map((p) => p.permissionCode as Permission)
      .filter((code) => PERMISSION_CATALOG[code]?.scope === 'seller');

    const principal: Principal = {
      userId: user.id,
      status: user.status,
      mfaEnabled: !!user.mfa?.enabledAt,
      roles: roles.map((r) => r.role.code as UserRole).sort(),
      permissions: [...new Set([...fromRoles, ...extra])].sort(),
      seller: activeMembership
        ? {
            id: activeMembership.seller.id,
            memberId: activeMembership.id,
            businessName: activeMembership.seller.businessName,
            status: activeMembership.seller.status,
            isOwner: activeMembership.seller.ownerId === user.id,
          }
        : null,
    };
    await this.redis.set(key, JSON.stringify(principal), 'EX', CACHE_TTL_SECONDS);
    return principal;
  }

  /** Call after changing a user's roles or status. */
  async invalidateUser(userId: string): Promise<void> {
    const version = (await this.redis.get(REDIS_KEYS.PERMISSIONS_VERSION)) ?? '0';
    await this.redis.del(`${REDIS_KEYS.PRINCIPAL_PREFIX}${userId}:${version}`);
  }

  /** Call after changing a seller's status or name (affects every member). */
  async invalidateUsers(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    const version = (await this.redis.get(REDIS_KEYS.PERMISSIONS_VERSION)) ?? '0';
    await this.redis.del(...userIds.map((id) => `${REDIS_KEYS.PRINCIPAL_PREFIX}${id}:${version}`));
  }

  /** Call after changing any role's permissions. */
  async invalidateAll(): Promise<void> {
    await this.redis.incr(REDIS_KEYS.PERMISSIONS_VERSION);
  }
}
