import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, WholesaleApplication } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type {
  ReviewWholesaleRequest,
  WholesaleApplicationDto,
  WholesaleBusiness,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrincipalService } from '../auth/principal.service';
import { NotificationsService } from '../notifications/notifications.service';

type WithApplicant = WholesaleApplication & {
  user: { id: string; firstName: string; lastName: string; email: string; mobile: string | null };
};

const applicantSelect = {
  select: { id: true, firstName: true, lastName: true, email: true, mobile: true },
} as const;

function toDto(application: WithApplicant): WholesaleApplicationDto {
  return {
    id: application.id,
    status: application.status,
    businessName: application.businessName,
    tin: application.tin,
    businessAddress: application.businessAddress,
    applicant: application.user,
    reviewNote: application.reviewNote,
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
    createdAt: application.createdAt.toISOString(),
  };
}

/**
 * Wholesale customers sign up (or apply later from their account) and shop at retail
 * prices until an admin approves their business; approval grants WHOLESALE_CUSTOMER.
 */
@Injectable()
export class WholesaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly principals: PrincipalService,
    private readonly notifications: NotificationsService,
  ) {}

  async getMine(userId: string): Promise<WholesaleApplicationDto | null> {
    const application = await this.prisma.wholesaleApplication.findUnique({
      where: { userId },
      include: { user: applicantSelect },
    });
    return application ? toDto(application) : null;
  }

  /** New application, or resubmission after a rejection. */
  async submit(
    userId: string,
    business: WholesaleBusiness,
    context: RequestContext,
  ): Promise<WholesaleApplicationDto> {
    const existing = await this.prisma.wholesaleApplication.findUnique({ where: { userId } });
    if (existing && existing.status !== 'REJECTED') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        existing.status === 'PENDING'
          ? 'Your application is already being reviewed.'
          : 'Your account already has wholesale access.',
      );
    }
    const application = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.wholesaleApplication.update({
            where: { id: existing.id },
            data: {
              ...business,
              status: 'PENDING',
              reviewedById: null,
              reviewedAt: null,
              reviewNote: null,
            },
            include: { user: applicantSelect },
          })
        : await tx.wholesaleApplication.create({
            data: { userId, ...business },
            include: { user: applicantSelect },
          });
      await this.audit.record(
        {
          action: 'wholesale.application_submitted',
          actorId: userId,
          entityType: 'wholesale_application',
          entityId: row.id,
        },
        context,
        tx,
      );
      return row;
    });
    return toDto(application);
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  }): Promise<PaginatedResponse<WholesaleApplicationDto>> {
    const where: Prisma.WholesaleApplicationWhereInput = query.status
      ? { status: query.status }
      : {};
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.wholesaleApplication.findMany({
        where,
        include: { user: applicantSelect },
        // Oldest pending first, so applications are handled in order.
        orderBy: [{ createdAt: query.status === 'PENDING' ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.wholesaleApplication.count({ where }),
    ]);
    return {
      items: rows.map(toDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async review(
    id: string,
    input: ReviewWholesaleRequest,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<WholesaleApplicationDto> {
    const decision = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const application = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set: two admins reviewing at once cannot both succeed.
      const updated = await tx.wholesaleApplication.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: decision,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewNote: input.note ?? null,
        },
      });
      if (updated.count !== 1) {
        const exists = await tx.wholesaleApplication.count({ where: { id } });
        throw exists
          ? new ApiException(
              HttpStatus.CONFLICT,
              'CONFLICT',
              'This application has already been reviewed.',
            )
          : new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Application not found.');
      }
      const row = await tx.wholesaleApplication.findUniqueOrThrow({
        where: { id },
        include: { user: applicantSelect },
      });
      if (decision === 'APPROVED') {
        await tx.userRoleAssignment.createMany({
          data: [{ userId: row.userId, roleCode: 'WHOLESALE_CUSTOMER' }],
          skipDuplicates: true,
        });
      }
      await this.audit.record(
        {
          action:
            decision === 'APPROVED'
              ? 'wholesale.application_approved'
              : 'wholesale.application_rejected',
          actorId: actor.id,
          entityType: 'wholesale_application',
          entityId: id,
          metadata: { customerId: row.userId },
        },
        context,
        tx,
      );
      return row;
    });
    await this.principals.invalidateUser(application.userId);
    await this.notifications.safely('wholesale decision email', () =>
      this.notifications.sendWholesaleDecision({
        to: application.user.email,
        firstName: application.user.firstName,
        decision,
        businessName: application.businessName,
        note: application.reviewNote,
        link: `${this.config.appUrls.storefront}/account`,
      }),
    );
    return toDto(application);
  }
}
