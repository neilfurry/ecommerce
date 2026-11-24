import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AuthenticatedUser,
  type Permission,
  PERMISSION_CODES,
  PERMISSIONS,
  USER_ROLES,
  type UserRole,
} from '@marketplace/shared-types';
import type { RoleDto, RoleList } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrincipalService } from '../auth/principal.service';

/** Configurable permissions per role (Master Instructions §7: "Permissions must be configurable"). */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
  ) {}

  async list(): Promise<RoleList> {
    const roles = await this.prisma.role.findMany({
      include: {
        permissions: { select: { permissionCode: true } },
        _count: { select: { users: true } },
      },
    });
    const order = new Map(USER_ROLES.map((code, index) => [code, index]));
    return {
      roles: roles
        .sort(
          (a, b) => (order.get(a.code as UserRole) ?? 99) - (order.get(b.code as UserRole) ?? 99),
        )
        .map((role): RoleDto => ({
          code: role.code as UserRole,
          name: role.name,
          description: role.description,
          locked: role.isLocked,
          permissions: role.permissions.map((p) => p.permissionCode as Permission).sort(),
          userCount: role._count.users,
        })),
      permissions: PERMISSION_CODES.map((code) => ({ code, description: PERMISSIONS[code] })),
    };
  }

  async updatePermissions(
    code: UserRole,
    permissions: Permission[],
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({
      where: { code },
      include: { permissions: { select: { permissionCode: true } } },
    });
    if (!role) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Role not found.');
    if (role.isLocked) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        `${role.name} always has every permission and cannot be edited.`,
      );
    }
    const next = [...new Set(permissions)];
    const current = role.permissions.map((p) => p.permissionCode as Permission);
    const added = next.filter((p) => !current.includes(p));
    const removed = current.filter((p) => !next.includes(p));

    await this.prisma.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.rolePermission.deleteMany({
          where: { roleCode: code, permissionCode: { in: removed } },
        });
      }
      if (added.length > 0) {
        await tx.rolePermission.createMany({
          data: added.map((permissionCode) => ({ roleCode: code, permissionCode })),
        });
      }
      await this.audit.record(
        {
          action: 'role.permissions_updated',
          actorId: actor.id,
          entityType: 'role',
          entityId: code,
          metadata: { added, removed },
        },
        context,
        tx,
      );
    });
    // Every signed-in user's permissions are re-read on their next request.
    await this.principals.invalidateAll();
    const updated = (await this.list()).roles.find((r) => r.code === code);
    if (!updated) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Role not found.');
    return updated;
  }
}
