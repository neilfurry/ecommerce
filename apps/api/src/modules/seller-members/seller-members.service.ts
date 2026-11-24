import { HttpStatus, Injectable } from '@nestjs/common';
import { hashPassword, Prisma, verifyPassword } from '@marketplace/database';
import {
  type AuthenticatedUser,
  grantableSellerRoles,
  type Permission,
  PERMISSION_CATALOG,
  ROLE_LABELS,
  roleScope,
  SELLER_INVITATION_TTL_HOURS,
  SELLER_PERMISSIONS,
  type UserRole,
} from '@marketplace/shared-types';
import {
  type AcceptSellerInvitationRequest,
  type InviteSellerMemberRequest,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  personNameSchema,
  type SellerInvitationPreview,
  type SellerMemberDto,
  type SellerTeam,
  type UpdateSellerMemberRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../auth/crypto';
import { PrincipalService } from '../auth/principal.service';
import { NotificationsService } from '../notifications/notifications.service';

const memberInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      lastSignInAt: true,
      roles: { select: { roleCode: true } },
    },
  },
  permissions: { select: { permissionCode: true } },
} satisfies Prisma.SellerMemberInclude;
type MemberRow = Prisma.SellerMemberGetPayload<{ include: typeof memberInclude }>;

const isSellerRole = (role: string) => roleScope(role as UserRole) === 'seller';
const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Employee not found.');
const forbidden = (message: string) => new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
const conflict = (message: string, path?: string) =>
  new ApiException(
    HttpStatus.CONFLICT,
    'CONFLICT',
    message,
    path ? [{ path, message }] : undefined,
  );
const badLink = () =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'BAD_REQUEST',
    'This invitation link is invalid, expired or already used. Ask for a new invitation.',
  );

/**
 * A seller's employees (Phase 2 brief §5). Every query is scoped to the caller's own seller
 * (from their membership), so a seller can never see or change another seller's employees.
 * The owner can assign any seller role except owner; a manager can assign the roles below
 * manager. Nobody can grant a permission they do not hold themselves.
 */
@Injectable()
export class SellerMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
    private readonly notifications: NotificationsService,
  ) {}

  async team(user: AuthenticatedUser): Promise<SellerTeam> {
    const { sellerId } = sellerScope(user);
    const [seller, members, invitations, rolePermissions] = await Promise.all([
      this.prisma.seller.findUniqueOrThrow({ where: { id: sellerId }, select: { ownerId: true } }),
      this.prisma.sellerMember.findMany({
        where: { sellerId },
        include: memberInclude,
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.sellerInvitation.findMany({
        where: { sellerId, acceptedAt: null, revokedAt: null },
        include: { invitedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.sellerRolePermissions(),
    ]);
    const now = Date.now();
    return {
      members: members.map((m) => this.toMember(m, seller.ownerId, rolePermissions)),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        roles: i.roles as UserRole[],
        permissions: i.permissions as Permission[],
        invitedBy: `${i.invitedBy.firstName} ${i.invitedBy.lastName}`,
        expiresAt: i.expiresAt.toISOString(),
        expired: i.expiresAt.getTime() <= now,
        createdAt: i.createdAt.toISOString(),
      })),
      assignableRoles: user.permissions.includes('seller.members.manage')
        ? grantableSellerRoles(user.roles)
        : [],
      assignablePermissions: user.permissions.includes('seller.members.manage')
        ? this.grantablePermissions(user)
        : [],
    };
  }

  async invite(user: AuthenticatedUser, input: InviteSellerMemberRequest, context: RequestContext) {
    const { sellerId } = sellerScope(user);
    const seller = await this.assertSellerOpen(sellerId);
    const roles = [...new Set(input.roles)] as UserRole[];
    const permissions = [...new Set(input.permissions ?? [])] as Permission[];
    this.assertCanAssign(user, roles, permissions);

    const email = input.email;
    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: {
        roles: { select: { roleCode: true } },
        sellerMembership: { select: { sellerId: true } },
      },
    });
    if (existing?.sellerMembership) {
      throw conflict(
        existing.sellerMembership.sellerId === sellerId
          ? 'This person already works for your business.'
          : 'This person already works for another seller.',
        'email',
      );
    }
    if (existing?.roles.some((r) => roleScope(r.roleCode as UserRole) === 'platform')) {
      throw conflict('Marketplace staff accounts cannot join a seller.', 'email');
    }

    const token = randomToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      // One open invitation per person: a new one replaces the previous link.
      await tx.sellerInvitation.updateMany({
        where: { sellerId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const row = await tx.sellerInvitation.create({
        data: {
          sellerId,
          email,
          roles,
          permissions,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + SELLER_INVITATION_TTL_HOURS * 3_600_000),
          invitedById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'seller_member.invited',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { invitationId: row.id, email, roles, permissions },
        },
        context,
        tx,
      );
      return row;
    });
    await this.sendInvitation(user, seller.businessName, email, roles, token);
    return { id: invitation.id };
  }

  async resendInvitation(user: AuthenticatedUser, invitationId: string, context: RequestContext) {
    const { sellerId } = sellerScope(user);
    const seller = await this.assertSellerOpen(sellerId);
    this.assertManager(user);
    const invitation = await this.prisma.sellerInvitation.findFirst({
      where: { id: invitationId, sellerId, acceptedAt: null, revokedAt: null },
    });
    if (!invitation)
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Invitation not found.');
    this.assertCanAssign(
      user,
      invitation.roles as UserRole[],
      invitation.permissions as Permission[],
    );
    const token = randomToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerInvitation.update({
        where: { id: invitation.id },
        data: {
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + SELLER_INVITATION_TTL_HOURS * 3_600_000),
        },
      });
      await this.audit.record(
        {
          action: 'seller_member.invitation_resent',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { invitationId },
        },
        context,
        tx,
      );
    });
    await this.sendInvitation(
      user,
      seller.businessName,
      invitation.email,
      invitation.roles as UserRole[],
      token,
    );
  }

  async revokeInvitation(user: AuthenticatedUser, invitationId: string, context: RequestContext) {
    const { sellerId } = sellerScope(user);
    this.assertManager(user);
    const revoked = await this.prisma.sellerInvitation.updateMany({
      where: { id: invitationId, sellerId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1)
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Invitation not found.');
    await this.audit.record(
      {
        action: 'seller_member.invitation_revoked',
        actorId: user.id,
        entityType: 'seller',
        entityId: sellerId,
        metadata: { invitationId },
      },
      context,
    );
  }

  async update(
    user: AuthenticatedUser,
    memberId: string,
    input: UpdateSellerMemberRequest,
    context: RequestContext,
  ): Promise<SellerMemberDto> {
    const { sellerId } = sellerScope(user);
    await this.assertSellerOpen(sellerId);
    const { member, ownerId } = await this.findManageable(user, memberId);
    const roles = [...new Set(input.roles)] as UserRole[];
    const permissions = [...new Set(input.permissions ?? [])] as Permission[];
    this.assertCanAssign(user, roles, permissions);

    const currentRoles = member.user.roles.map((r) => r.roleCode).filter(isSellerRole);
    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({
        where: {
          userId: member.userId,
          roleCode: { in: currentRoles.filter((r) => !roles.includes(r as UserRole)) },
        },
      });
      await tx.userRoleAssignment.createMany({
        data: roles.map((roleCode) => ({ userId: member.userId, roleCode })),
        skipDuplicates: true,
      });
      await tx.sellerMemberPermission.deleteMany({ where: { memberId } });
      if (permissions.length > 0) {
        await tx.sellerMemberPermission.createMany({
          data: permissions.map((permissionCode) => ({ memberId, permissionCode })),
        });
      }
      await this.audit.record(
        {
          action: 'seller_member.updated',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: {
            memberId,
            userId: member.userId,
            roles,
            permissions,
            previousRoles: currentRoles,
            previousPermissions: member.permissions.map((p) => p.permissionCode),
          },
        },
        context,
        tx,
      );
    });
    await this.principals.invalidateUser(member.userId);
    return this.memberDto(memberId, ownerId);
  }

  async setSuspended(
    user: AuthenticatedUser,
    memberId: string,
    suspended: boolean,
    context: RequestContext,
  ): Promise<SellerMemberDto> {
    const { sellerId } = sellerScope(user);
    const { member, ownerId } = await this.findManageable(user, memberId);
    if ((member.status === 'SUSPENDED') !== suspended) {
      await this.prisma.$transaction(async (tx) => {
        await tx.sellerMember.update({
          where: { id: memberId },
          data: suspended
            ? { status: 'SUSPENDED', suspendedAt: new Date() }
            : { status: 'ACTIVE', suspendedAt: null },
        });
        await this.audit.record(
          {
            action: suspended ? 'seller_member.suspended' : 'seller_member.reactivated',
            actorId: user.id,
            entityType: 'seller',
            entityId: sellerId,
            metadata: { memberId, userId: member.userId },
          },
          context,
          tx,
        );
      });
      // Seller roles stop counting on the employee's next request (they are signed out of
      // the Seller Center; other apps, e.g. their customer account, are unaffected).
      await this.principals.invalidateUser(member.userId);
    }
    return this.memberDto(memberId, ownerId);
  }

  async remove(user: AuthenticatedUser, memberId: string, context: RequestContext): Promise<void> {
    const { sellerId } = sellerScope(user);
    const { member } = await this.findManageable(user, memberId);
    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.deleteMany({
        where: {
          userId: member.userId,
          roleCode: { in: member.user.roles.map((r) => r.roleCode).filter(isSellerRole) },
        },
      });
      await tx.sellerMember.delete({ where: { id: memberId } });
      await this.audit.record(
        {
          action: 'seller_member.removed',
          actorId: user.id,
          entityType: 'seller',
          entityId: sellerId,
          metadata: { memberId, userId: member.userId, email: member.user.email },
        },
        context,
        tx,
      );
    });
    await this.principals.invalidateUser(member.userId);
  }

  // ---- Accepting an invitation (public) --------------------------------------------------

  async preview(token: string): Promise<SellerInvitationPreview> {
    const invitation = await this.openInvitation(token);
    const existing = await this.prisma.user.count({ where: { email: invitation.email } });
    return {
      sellerName: invitation.seller.businessName,
      email: invitation.email,
      roles: invitation.roles as UserRole[],
      existingAccount: existing > 0,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * New people choose a name and password; people who already have an account (for example
   * as a customer) confirm with that account's password. Either way the email is proven by
   * the link, and the person signs in to the Seller Center afterwards.
   */
  async accept(input: AcceptSellerInvitationRequest, context: RequestContext): Promise<void> {
    const invitation = await this.openInvitation(input.token);
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      include: { roles: { select: { roleCode: true } }, sellerMembership: true },
    });

    let passwordHash: string | null = null;
    if (existing) {
      if (
        existing.status !== 'ACTIVE' ||
        !existing.passwordHash ||
        !(await verifyPassword(existing.passwordHash, input.password))
      ) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_CREDENTIALS',
          'Incorrect password for this account.',
          [{ path: 'password', message: 'Enter the password of your existing account' }],
        );
      }
      if (existing.sellerMembership) throw conflict('This account already works for a seller.');
      if (existing.roles.some((r) => roleScope(r.roleCode as UserRole) === 'platform')) {
        throw conflict('Marketplace staff accounts cannot join a seller.');
      }
    } else {
      const fieldErrors = [
        ...(personNameSchema.safeParse(input.firstName ?? '').success
          ? []
          : [{ path: 'firstName', message: 'Enter your first name' }]),
        ...(personNameSchema.safeParse(input.lastName ?? '').success
          ? []
          : [{ path: 'lastName', message: 'Enter your last name' }]),
        ...(passwordSchema.safeParse(input.password).success
          ? []
          : [{ path: 'password', message: `Use at least ${PASSWORD_MIN_LENGTH} characters` }]),
      ];
      if (fieldErrors.length > 0) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'Check the highlighted fields.',
          fieldErrors,
        );
      }
      passwordHash = await hashPassword(input.password);
    }

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        // Single use, even when two requests race.
        const claimed = await tx.sellerInvitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) throw badLink();
        const now = new Date();
        const user =
          existing ??
          (await tx.user.create({
            data: {
              email: invitation.email,
              emailVerifiedAt: now,
              passwordHash: passwordHash!,
              passwordChangedAt: now,
              firstName: personNameSchema.parse(input.firstName),
              lastName: personNameSchema.parse(input.lastName),
              status: 'ACTIVE',
            },
          }));
        const member = await tx.sellerMember.create({
          data: {
            sellerId: invitation.sellerId,
            userId: user.id,
            invitedById: invitation.invitedById,
          },
        });
        await tx.userRoleAssignment.createMany({
          data: invitation.roles.map((roleCode) => ({ userId: user.id, roleCode })),
          skipDuplicates: true,
        });
        const permissions = invitation.permissions.filter(
          (p) => PERMISSION_CATALOG[p as Permission]?.scope === 'seller',
        );
        if (permissions.length > 0) {
          await tx.sellerMemberPermission.createMany({
            data: permissions.map((permissionCode) => ({ memberId: member.id, permissionCode })),
          });
        }
        if (existing && !existing.emailVerifiedAt) {
          await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
        }
        await this.audit.record(
          {
            action: 'seller_member.joined',
            actorId: user.id,
            entityType: 'seller',
            entityId: invitation.sellerId,
            metadata: { invitationId: invitation.id, memberId: member.id, newAccount: !existing },
          },
          context,
          tx,
        );
        return user.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict(
          'This account already works for a seller, or the email is already registered.',
        );
      }
      throw error;
    }
    await this.principals.invalidateUser(userId);
  }

  // ---- Internals -------------------------------------------------------------------------

  private async openInvitation(token: string) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw badLink();
    const invitation = await this.prisma.sellerInvitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { seller: { select: { businessName: true, status: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.seller.status === 'CLOSED' ||
      invitation.seller.status === 'SUSPENDED'
    ) {
      throw badLink();
    }
    return invitation;
  }

  private async assertSellerOpen(sellerId: string) {
    const seller = await this.prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    if (seller.status === 'SUSPENDED' || seller.status === 'CLOSED') {
      throw forbidden(
        'Employees cannot be changed while the seller account is suspended or closed.',
      );
    }
    return seller;
  }

  private assertManager(user: AuthenticatedUser) {
    if (!user.permissions.includes('seller.members.manage')) {
      throw forbidden('You need the permission to manage employees.');
    }
  }

  /** Seller permissions the user can hand out: the ones they hold. */
  private grantablePermissions(user: AuthenticatedUser): Permission[] {
    return SELLER_PERMISSIONS.filter((p) => user.permissions.includes(p));
  }

  private assertCanAssign(
    user: AuthenticatedUser,
    roles: readonly UserRole[],
    permissions: readonly Permission[],
  ) {
    this.assertManager(user);
    const allowedRoles = grantableSellerRoles(user.roles);
    const deniedRoles = roles.filter((r) => !allowedRoles.includes(r));
    if (deniedRoles.length > 0) {
      throw forbidden(`You cannot assign: ${deniedRoles.map((r) => ROLE_LABELS[r]).join(', ')}.`);
    }
    const allowedPermissions = this.grantablePermissions(user);
    const deniedPermissions = permissions.filter((p) => !allowedPermissions.includes(p));
    if (deniedPermissions.length > 0) {
      throw forbidden(
        `You cannot grant permissions you do not have: ${deniedPermissions.join(', ')}.`,
      );
    }
  }

  /** The owner and yourself are off limits; managers cannot manage people above their reach. */
  private async findManageable(user: AuthenticatedUser, memberId: string) {
    const { sellerId } = sellerScope(user);
    this.assertManager(user);
    const member = await this.prisma.sellerMember.findFirst({
      where: { id: memberId, sellerId },
      include: { ...memberInclude, seller: { select: { ownerId: true } } },
    });
    if (!member) throw notFound();
    if (member.userId === member.seller.ownerId)
      throw forbidden("The owner's access cannot be changed.");
    if (member.userId === user.id) throw forbidden('You cannot change your own access.');
    const roles = member.user.roles.map((r) => r.roleCode as UserRole).filter(isSellerRole);
    const allowedRoles = grantableSellerRoles(user.roles);
    const allowedPermissions = this.grantablePermissions(user);
    if (
      roles.some((r) => !allowedRoles.includes(r)) ||
      member.permissions.some((p) => !allowedPermissions.includes(p.permissionCode as Permission))
    ) {
      throw forbidden('Only the owner can manage this employee.');
    }
    return { member, ownerId: member.seller.ownerId };
  }

  private async sellerRolePermissions(): Promise<Map<string, Permission[]>> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { permission: { scope: 'seller' } },
      select: { roleCode: true, permissionCode: true },
    });
    const map = new Map<string, Permission[]>();
    for (const grant of grants) {
      map.set(grant.roleCode, [
        ...(map.get(grant.roleCode) ?? []),
        grant.permissionCode as Permission,
      ]);
    }
    return map;
  }

  private async memberDto(memberId: string, ownerId: string): Promise<SellerMemberDto> {
    const member = await this.prisma.sellerMember.findUniqueOrThrow({
      where: { id: memberId },
      include: memberInclude,
    });
    return this.toMember(member, ownerId, await this.sellerRolePermissions());
  }

  private toMember(
    member: MemberRow,
    ownerId: string,
    rolePermissions: Map<string, Permission[]>,
  ): SellerMemberDto {
    const roles = member.user.roles.map((r) => r.roleCode as UserRole).filter(isSellerRole);
    const extra = member.permissions.map((p) => p.permissionCode as Permission);
    const effective = new Set<Permission>([
      ...extra,
      ...roles.flatMap((r) => rolePermissions.get(r) ?? []),
    ]);
    return {
      id: member.id,
      userId: member.userId,
      name: `${member.user.firstName} ${member.user.lastName}`,
      email: member.user.email,
      status: member.status,
      isOwner: member.userId === ownerId,
      roles,
      extraPermissions: extra.sort(),
      effectivePermissions: SELLER_PERMISSIONS.filter((p) => effective.has(p)),
      joinedAt: member.joinedAt.toISOString(),
      lastSignInAt: member.user.lastSignInAt?.toISOString() ?? null,
    };
  }

  private async sendInvitation(
    inviter: AuthenticatedUser,
    sellerName: string,
    email: string,
    roles: readonly UserRole[],
    token: string,
  ): Promise<void> {
    const from = await this.prisma.user.findUniqueOrThrow({
      where: { id: inviter.id },
      select: { firstName: true, lastName: true },
    });
    await this.notifications.safely('seller invitation email', () =>
      this.notifications.sendSellerInvitation({
        to: email,
        sellerName,
        invitedBy: `${from.firstName} ${from.lastName}`,
        roles: roles.map((r) => ROLE_LABELS[r]),
        link: `${this.config.appUrls.seller}/join?token=${token}`,
        expiresInHours: SELLER_INVITATION_TTL_HOURS,
      }),
    );
  }
}
