import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type { CouponDto, CouponInput, UpdateCouponRequest } from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { checkTargets } from './promotion-targets';

const include = {
  seller: { select: { id: true, businessName: true } },
  products: { include: { product: { select: { id: true, name: true } } } },
  categories: { include: { category: { select: { id: true, name: true } } } },
} satisfies Prisma.CouponInclude;
type CouponRow = Prisma.CouponGetPayload<{ include: typeof include }>;

export const couponDto = (c: CouponRow): CouponDto => ({
  id: c.id,
  code: c.code,
  scope: c.scope,
  seller: c.seller,
  name: c.name,
  description: c.description,
  type: c.type,
  value: c.value.toFixed(2),
  maxDiscount: c.maxDiscount?.toFixed(2) ?? null,
  minSpend: c.minSpend.toFixed(2),
  startsAt: c.startsAt.toISOString(),
  endsAt: c.endsAt.toISOString(),
  usageLimit: c.usageLimit,
  perCustomerLimit: c.perCustomerLimit,
  usedCount: c.usedCount,
  status: c.status,
  appliesTo: c.appliesTo,
  products: c.products.map((p) => p.product),
  categories: c.categories.map((x) => x.category),
  firstOrderOnly: c.firstOrderOnly,
  createdAt: c.createdAt.toISOString(),
});

const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);
const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Coupon not found.');

/**
 * Coupons: marketplace coupons (staff with marketing.manage; the marketplace pays the
 * discount) and seller coupons (each seller for their own items; the seller pays).
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: {
      page: number;
      pageSize: number;
      scope?: 'PLATFORM' | 'SELLER';
      status?: 'ACTIVE' | 'INACTIVE';
      search?: string;
    },
    sellerId?: string,
  ): Promise<PaginatedResponse<CouponDto>> {
    const where: Prisma.CouponWhereInput = {
      ...(sellerId ? { sellerId } : query.scope ? { scope: query.scope } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search.toUpperCase() } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.coupon.count({ where }),
    ]);
    return {
      items: rows.map(couponDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  createPlatform(user: AuthenticatedUser, input: CouponInput, context: RequestContext) {
    return this.create(user, input, null, context);
  }

  createForSeller(user: AuthenticatedUser, input: CouponInput, context: RequestContext) {
    const { sellerId, status } = sellerScope(user);
    if (status !== 'VERIFIED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SELLER_NOT_VERIFIED',
        'Only verified sellers can create coupons.',
      );
    }
    return this.create(user, input, sellerId, context);
  }

  private async create(
    user: AuthenticatedUser,
    input: CouponInput,
    sellerId: string | null,
    context: RequestContext,
  ): Promise<CouponDto> {
    const value =
      input.type === 'FREE_SHIPPING' ? new Prisma.Decimal(0) : new Prisma.Decimal(input.value);
    if (input.type === 'FIXED_AMOUNT' && input.maxDiscount) {
      throw invalid('maxDiscount', 'An amount-off coupon has no separate cap');
    }
    const exists = await this.prisma.coupon.count({ where: { code: input.code } });
    if (exists)
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This code is already used by another coupon.',
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const scoped = await checkTargets(
        tx,
        {
          appliesTo: input.appliesTo ?? 'ALL',
          productIds: input.productIds ?? [],
          categoryIds: input.categoryIds ?? [],
        },
        sellerId,
      );
      const created = await tx.coupon.create({
        data: {
          code: input.code,
          scope: sellerId ? 'SELLER' : 'PLATFORM',
          sellerId,
          name: input.name,
          description: input.description ?? null,
          type: input.type,
          value,
          maxDiscount: input.maxDiscount ? new Prisma.Decimal(input.maxDiscount) : null,
          minSpend: new Prisma.Decimal(input.minSpend ?? '0'),
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          usageLimit:
            input.usageLimit === null || input.usageLimit === undefined
              ? null
              : Number(input.usageLimit),
          perCustomerLimit: Number(input.perCustomerLimit ?? 1),
          status: input.status ?? 'ACTIVE',
          appliesTo: input.appliesTo ?? 'ALL',
          firstOrderOnly: input.firstOrderOnly ?? false,
          products: { create: scoped.productIds.map((productId) => ({ productId })) },
          categories: { create: scoped.categoryIds.map((categoryId) => ({ categoryId })) },
          createdById: user.id,
        },
        include,
      });
      await this.audit.record(
        {
          action: 'coupon.created',
          actorId: user.id,
          entityType: 'coupon',
          entityId: created.id,
          metadata: { scope: created.scope, sellerId },
        },
        context,
        tx,
      );
      return created;
    });
    return couponDto(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCouponRequest,
    context: RequestContext,
    sellerOnly: boolean,
  ): Promise<CouponDto> {
    const where: Prisma.CouponWhereInput = sellerOnly
      ? { id, sellerId: sellerScope(user).sellerId }
      : { id, scope: 'PLATFORM' };
    const current = await this.prisma.coupon.findFirst({ where });
    if (!current) throw notFound();
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    if (endsAt <= current.startsAt) throw invalid('endsAt', 'Must be after the start');
    if (
      input.usageLimit !== null &&
      input.usageLimit !== undefined &&
      Number(input.usageLimit) < current.usedCount
    ) {
      throw invalid('usageLimit', `Already used ${current.usedCount} times`);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      if (
        input.appliesTo !== undefined ||
        input.productIds !== undefined ||
        input.categoryIds !== undefined
      ) {
        const existing = await tx.coupon.findUniqueOrThrow({ where: { id }, include });
        const scoped = await checkTargets(
          tx,
          {
            appliesTo: input.appliesTo ?? existing.appliesTo,
            productIds: input.productIds ?? existing.products.map((p) => p.productId),
            categoryIds: input.categoryIds ?? existing.categories.map((c) => c.categoryId),
          },
          current.sellerId,
        );
        await tx.couponProduct.deleteMany({ where: { couponId: id } });
        await tx.couponCategory.deleteMany({ where: { couponId: id } });
        await tx.coupon.update({
          where: { id },
          data: {
            appliesTo: input.appliesTo ?? existing.appliesTo,
            products: { create: scoped.productIds.map((productId) => ({ productId })) },
            categories: { create: scoped.categoryIds.map((categoryId) => ({ categoryId })) },
          },
        });
      }
      const updated = await tx.coupon.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.endsAt !== undefined ? { endsAt } : {}),
          ...(input.usageLimit !== undefined
            ? { usageLimit: input.usageLimit === null ? null : Number(input.usageLimit) }
            : {}),
          ...(input.perCustomerLimit !== undefined
            ? { perCustomerLimit: Number(input.perCustomerLimit) }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.firstOrderOnly !== undefined ? { firstOrderOnly: input.firstOrderOnly } : {}),
        },
        include,
      });
      await this.audit.record(
        { action: 'coupon.updated', actorId: user.id, entityType: 'coupon', entityId: id },
        context,
        tx,
      );
      return updated;
    });
    return couponDto(row);
  }
}
