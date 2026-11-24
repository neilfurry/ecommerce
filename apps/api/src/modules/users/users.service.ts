import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type User } from '@marketplace/database';
import {
  type AuthenticatedUser,
  CUSTOMER_ROLES,
  grantableRoles,
  type PaginatedResponse,
  PLATFORM_STAFF_ROLES,
  ROLE_LABELS,
  SELLER_ROLES,
  type UserRole,
} from '@marketplace/shared-types';
import type {
  AdminUser,
  AdminUserDetail,
  CreateStaffUserRequest,
  UpdateUserRequest,
  UserListFilters,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrincipalService } from '../auth/principal.service';
import { SessionsService } from '../auth/sessions.service';
import { TOKEN_LIFETIMES_MS, VerificationTokensService } from '../auth/verification-tokens.service';
import { NotificationsService } from '../notifications/notifications.service';

type UserWithRoles = User & { roles: { roleCode: string }[] };

const STAFF_ROLES: readonly UserRole[] = [...PLATFORM_STAFF_ROLES, ...SELLER_ROLES];
const isCustomerRole = (role: UserRole) => (CUSTOMER_ROLES as readonly UserRole[]).includes(role);

export function toAdminUser(user: UserWithRoles): AdminUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    emailVerified: !!user.emailVerifiedAt,
    mobile: user.mobile,
    mobileVerified: !!user.mobileVerifiedAt,
    status: user.status,
    roles: user.roles.map((r) => r.roleCode as UserRole).sort(),
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found.');
const forbidden = (message: string) => new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

/**
 * Account administration. Only customers sign up themselves; every staff account is
 * created here and activated through an emailed invitation (the admin never sets or sees
 * the password).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
    private readonly sessions: SessionsService,
    private readonly tokens: VerificationTokensService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: UserListFilters): Promise<PaginatedResponse<AdminUser>> {
    const page = query.page;
    const pageSize = query.pageSize;
    const and: Prisma.UserWhereInput[] = [];
    if (query.kind === 'staff')
      and.push({ roles: { some: { roleCode: { in: [...STAFF_ROLES] } } } });
    if (query.kind === 'customers')
      and.push({ roles: { some: { roleCode: { in: [...CUSTOMER_ROLES] } } } });
    if (query.role) and.push({ roles: { some: { roleCode: query.role } } });
    if (query.status) and.push({ status: query.status });
    if (query.search) {
      const term = query.search;
      and.push({
        OR: [
          { email: { contains: term.toLowerCase() } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { mobile: { contains: term.replace(/[^\d+]/g, '') || term } },
        ],
      });
    }
    const where: Prisma.UserWhereInput = and.length > 0 ? { AND: and } : {};
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { roles: { select: { roleCode: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map(toAdminUser),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  async get(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { select: { roleCode: true } } },
    });
    if (!user) throw notFound();
    return {
      ...toAdminUser(user),
      activeSessions: await this.sessions.countActive(id),
      lockedUntil:
        user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil.toISOString() : null,
    };
  }

  async createStaff(
    input: CreateStaffUserRequest,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<AdminUser> {
    this.assertCanGrant(actor, input.roles);
    const roles = [...new Set(input.roles)];
    let created: { user: UserWithRoles; token: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            status: 'INVITED',
            roles: { create: roles.map((roleCode) => ({ roleCode })) },
          },
          include: { roles: { select: { roleCode: true } } },
        });
        await this.audit.record(
          {
            action: 'user.created',
            actorId: actor.id,
            entityType: 'user',
            entityId: user.id,
            metadata: { roles },
          },
          context,
          tx,
        );
        return { user, token: await this.tokens.issue(user.id, 'INVITATION', tx) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'An account with this email already exists.',
          [{ path: 'email', message: 'Already registered' }],
        );
      }
      throw error;
    }
    await this.sendInvitation(created.user, created.token, actor);
    return toAdminUser(created.user);
  }

  async resendInvitation(
    id: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<void> {
    const user = await this.findWithRoles(id);
    if (user.status !== 'INVITED') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This account has already been activated.',
      );
    }
    this.assertCanManage(actor, user);
    const token = await this.tokens.issue(user.id, 'INVITATION');
    await this.audit.record(
      { action: 'user.invitation_resent', actorId: actor.id, entityType: 'user', entityId: id },
      context,
    );
    await this.sendInvitation(user, token, actor);
  }

  async update(
    id: string,
    input: UpdateUserRequest,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<AdminUser> {
    const user = await this.findWithRoles(id);
    const current = user.roles.map((r) => r.roleCode as UserRole);
    const next = [...new Set(input.roles)];
    const added = next.filter((role) => !current.includes(role));
    const removed = current.filter((role) => !next.includes(role));

    if ([...added, ...removed].some(isCustomerRole)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Customer roles change only through sign-up and wholesale approval.',
        [{ path: 'roles', message: 'Customer roles cannot be edited here' }],
      );
    }
    this.assertCanGrant(actor, [...added, ...removed]);
    if (removed.includes('SUPER_ADMIN')) await this.assertNotLastSuperAdmin(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (removed.length > 0)
        await tx.userRoleAssignment.deleteMany({
          where: { userId: id, roleCode: { in: removed } },
        });
      if (added.length > 0)
        await tx.userRoleAssignment.createMany({
          data: added.map((roleCode) => ({ userId: id, roleCode })),
        });
      const row = await tx.user.update({
        where: { id },
        data: { firstName: input.firstName, lastName: input.lastName },
        include: { roles: { select: { roleCode: true } } },
      });
      await this.audit.record(
        {
          action: 'user.updated',
          actorId: actor.id,
          entityType: 'user',
          entityId: id,
          metadata: {
            addedRoles: added,
            removedRoles: removed,
            nameChanged: input.firstName !== user.firstName || input.lastName !== user.lastName,
          },
        },
        context,
        tx,
      );
      return row;
    });
    await this.principals.invalidateUser(id);
    return toAdminUser(updated);
  }

  async suspend(id: string, actor: AuthenticatedUser, context: RequestContext): Promise<AdminUser> {
    if (id === actor.id) throw forbidden('You cannot suspend your own account.');
    const user = await this.findWithRoles(id);
    this.assertCanManage(actor, user);
    if (user.roles.some((r) => r.roleCode === 'SUPER_ADMIN'))
      await this.assertNotLastSuperAdmin(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: { status: 'SUSPENDED' },
        include: { roles: { select: { roleCode: true } } },
      });
      await this.audit.record(
        { action: 'user.suspended', actorId: actor.id, entityType: 'user', entityId: id },
        context,
        tx,
      );
      return row;
    });
    await this.principals.invalidateUser(id);
    await this.sessions.revokeAllForUser(id, 'USER_SUSPENDED');
    return toAdminUser(updated);
  }

  /** Reactivates a suspended account and clears any sign-in lock-out. */
  async reactivate(
    id: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<AdminUser> {
    const user = await this.findWithRoles(id);
    this.assertCanManage(actor, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: {
          status:
            user.status === 'SUSPENDED' ? (user.passwordHash ? 'ACTIVE' : 'INVITED') : user.status,
          failedSignInCount: 0,
          lockedUntil: null,
        },
        include: { roles: { select: { roleCode: true } } },
      });
      await this.audit.record(
        { action: 'user.reactivated', actorId: actor.id, entityType: 'user', entityId: id },
        context,
        tx,
      );
      return row;
    });
    await this.principals.invalidateUser(id);
    return toAdminUser(updated);
  }

  async revokeSessions(
    id: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<number> {
    const user = await this.findWithRoles(id);
    this.assertCanManage(actor, user);
    const count = await this.sessions.revokeAllForUser(id, 'ADMIN_REVOKED');
    await this.audit.record(
      {
        action: 'user.sessions_revoked',
        actorId: actor.id,
        entityType: 'user',
        entityId: id,
        metadata: { sessions: count },
      },
      context,
    );
    return count;
  }

  private async findWithRoles(id: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: { select: { roleCode: true } } },
    });
    if (!user) throw notFound();
    return user;
  }

  /** Every role being granted or removed must be grantable by the actor. */
  private assertCanGrant(actor: AuthenticatedUser, roles: readonly UserRole[]): void {
    const allowed = grantableRoles(actor.roles);
    const denied = roles.filter((role) => !allowed.includes(role));
    if (denied.length > 0) {
      throw forbidden(
        `You cannot grant or remove: ${denied.map((role) => ROLE_LABELS[role]).join(', ')}.`,
      );
    }
  }

  /** Staff accounts can be managed only by someone allowed to grant all of their roles. */
  private assertCanManage(actor: AuthenticatedUser, user: UserWithRoles): void {
    const staffRoles = user.roles
      .map((r) => r.roleCode as UserRole)
      .filter((role) => !isCustomerRole(role));
    this.assertCanGrant(actor, staffRoles);
  }

  private async assertNotLastSuperAdmin(userId: string): Promise<void> {
    const others = await this.prisma.userRoleAssignment.count({
      where: { roleCode: 'SUPER_ADMIN', userId: { not: userId }, user: { status: 'ACTIVE' } },
    });
    if (others === 0) throw forbidden('The platform must keep at least one active super admin.');
  }

  /** Seller staff activate their account in the Seller Center, platform staff in the Admin Console. */
  private invitationAppUrl(user: UserWithRoles): string {
    const platform = user.roles.some((r) =>
      (PLATFORM_STAFF_ROLES as readonly string[]).includes(r.roleCode),
    );
    return platform ? this.config.appUrls.admin : this.config.appUrls.seller;
  }

  private async sendInvitation(
    user: UserWithRoles,
    token: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const inviter = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { firstName: true, lastName: true },
    });
    await this.notifications.safely('staff invitation', () =>
      this.notifications.sendStaffInvitation({
        to: user.email,
        firstName: user.firstName,
        link: `${this.invitationAppUrl(user)}/accept-invitation?token=${token}`,
        invitedBy: inviter ? `${inviter.firstName} ${inviter.lastName}` : 'An administrator',
        roles: user.roles.map((r) => ROLE_LABELS[r.roleCode as UserRole]),
        expiresInHours: TOKEN_LIFETIMES_MS.INVITATION / 3_600_000,
      }),
    );
  }
}
