import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type {
  ActiveCampaign,
  CampaignDto,
  CampaignInput,
  UpdateCampaignRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { campaignHeadline } from '../checkout/promotion-engine';
import { checkTargets } from './promotion-targets';

const include = {
  seller: { select: { id: true, businessName: true } },
  products: { include: { product: { select: { id: true, name: true } } } },
  categories: { include: { category: { select: { id: true, name: true } } } },
} satisfies Prisma.CampaignInclude;
type CampaignRow = Prisma.CampaignGetPayload<{ include: typeof include }>;

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Campaign not found.');
const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

/**
 * Campaigns: automatic promotions without a code (ADR 0030). Marketplace campaigns
 * (marketing.manage) cover every store and are paid by the marketplace; seller campaigns cover
 * that seller's items and are paid by the seller. Checkout applies them (CheckoutPricingService).
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async usage(ids: string[]) {
    if (ids.length === 0) return new Map<string, { orders: number; discount: string }>();
    const rows = await this.prisma.$queryRaw<
      { campaign_id: string; orders: number; discount: Prisma.Decimal }[]
    >`
      SELECT p."campaign_id", COUNT(*)::int AS "orders", SUM(p."amount" + p."shipping_amount") AS "discount"
      FROM "order_promotions" p JOIN "seller_orders" so ON so."id" = p."seller_order_id"
      WHERE p."campaign_id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND so."status" <> 'CANCELLED'
      GROUP BY p."campaign_id"`;
    return new Map(
      rows.map((r) => [r.campaign_id, { orders: r.orders, discount: D(r.discount).toFixed(2) }]),
    );
  }

  private dto(c: CampaignRow, usage?: { orders: number; discount: string }): CampaignDto {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      season: c.season,
      scope: c.scope,
      seller: c.seller,
      type: c.type,
      value: c.value.toFixed(2),
      maxDiscount: c.maxDiscount?.toFixed(2) ?? null,
      minQuantity: c.minQuantity,
      buyQuantity: c.buyQuantity,
      getQuantity: c.getQuantity,
      minSpend: c.minSpend.toFixed(2),
      appliesTo: c.appliesTo,
      products: c.products.map((p) => p.product),
      categories: c.categories.map((x) => x.category),
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      status: c.status,
      priority: c.priority,
      usage: usage ?? { orders: 0, discount: '0.00' },
      createdAt: c.createdAt.toISOString(),
    };
  }

  async list(
    query: {
      page: number;
      pageSize: number;
      scope?: 'PLATFORM' | 'SELLER';
      status?: 'ACTIVE' | 'INACTIVE';
      type?: CampaignRow['type'];
      search?: string;
    },
    sellerId?: string,
  ): Promise<PaginatedResponse<CampaignDto>> {
    const where: Prisma.CampaignWhereInput = {
      ...(sellerId ? { sellerId } : query.scope ? { scope: query.scope } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { season: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        include,
        orderBy: { startsAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    const usage = await this.usage(rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.dto(r, usage.get(r.id))),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  createPlatform(user: AuthenticatedUser, input: CampaignInput, context: RequestContext) {
    return this.create(user, input, null, context);
  }

  createForSeller(user: AuthenticatedUser, input: CampaignInput, context: RequestContext) {
    const { sellerId, status } = sellerScope(user);
    if (status !== 'VERIFIED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SELLER_NOT_VERIFIED',
        'Only verified sellers can run campaigns.',
      );
    }
    return this.create(user, input, sellerId, context);
  }

  private shapeFor(
    type: CampaignRow['type'],
    input: {
      value?: string;
      maxDiscount?: string | null;
      buyQuantity?: number | null;
      getQuantity?: number | null;
      minQuantity?: number;
    },
  ) {
    return {
      value: type === 'FREE_SHIPPING' ? D(0) : D(input.value ?? '0'),
      maxDiscount:
        type === 'FIXED_OFF' || type === 'BUY_X_GET_Y' || !input.maxDiscount
          ? null
          : D(input.maxDiscount),
      buyQuantity: type === 'BUY_X_GET_Y' ? Number(input.buyQuantity ?? 1) : null,
      getQuantity: type === 'BUY_X_GET_Y' ? Number(input.getQuantity ?? 1) : null,
      minQuantity: type === 'BUNDLE' ? Number(input.minQuantity ?? 2) : 1,
    };
  }

  private async create(
    user: AuthenticatedUser,
    input: CampaignInput,
    sellerId: string | null,
    context: RequestContext,
  ): Promise<CampaignDto> {
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
      const created = await tx.campaign.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          season: input.season ?? null,
          scope: sellerId ? 'SELLER' : 'PLATFORM',
          sellerId,
          type: input.type,
          ...this.shapeFor(input.type, {
            value: input.value,
            maxDiscount: input.maxDiscount,
            buyQuantity: input.buyQuantity === undefined ? null : Number(input.buyQuantity),
            getQuantity: input.getQuantity === undefined ? null : Number(input.getQuantity),
            minQuantity: input.minQuantity === undefined ? undefined : Number(input.minQuantity),
          }),
          minSpend: D(input.minSpend ?? '0'),
          appliesTo: input.appliesTo ?? 'ALL',
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          status: input.status ?? 'ACTIVE',
          priority: Number(input.priority ?? 0),
          createdById: user.id,
          products: { create: scoped.productIds.map((productId) => ({ productId })) },
          categories: { create: scoped.categoryIds.map((categoryId) => ({ categoryId })) },
        },
        include,
      });
      await this.audit.record(
        {
          action: 'campaign.created',
          actorId: user.id,
          entityType: 'campaign',
          entityId: created.id,
          metadata: { scope: created.scope, type: created.type, sellerId },
        },
        context,
        tx,
      );
      return created;
    });
    return this.dto(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCampaignRequest,
    context: RequestContext,
    sellerOnly: boolean,
  ): Promise<CampaignDto> {
    const where: Prisma.CampaignWhereInput = sellerOnly
      ? { id, sellerId: sellerScope(user).sellerId }
      : { id, scope: 'PLATFORM' };
    const current = await this.prisma.campaign.findFirst({ where, include });
    if (!current) throw notFound();
    const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    if (endsAt <= startsAt) throw invalid('endsAt', 'Must be after the start');
    const value = input.value !== undefined ? D(input.value) : current.value;
    if (['PERCENTAGE_OFF', 'BUNDLE', 'BUY_X_GET_Y'].includes(current.type)) {
      if (value.lte(0) || value.gt(100)) throw invalid('value', 'Between 1 and 100 percent');
    }
    if (current.type === 'FIXED_OFF' && value.lte(0)) throw invalid('value', 'Enter an amount');
    const row = await this.prisma.$transaction(async (tx) => {
      const targetsChanged =
        input.appliesTo !== undefined ||
        input.productIds !== undefined ||
        input.categoryIds !== undefined;
      if (targetsChanged) {
        const scoped = await checkTargets(
          tx,
          {
            appliesTo: input.appliesTo ?? current.appliesTo,
            productIds: input.productIds ?? current.products.map((p) => p.productId),
            categoryIds: input.categoryIds ?? current.categories.map((c) => c.categoryId),
          },
          current.sellerId,
        );
        await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
        await tx.campaignCategory.deleteMany({ where: { campaignId: id } });
        await tx.campaign.update({
          where: { id },
          data: {
            appliesTo: input.appliesTo ?? current.appliesTo,
            products: { create: scoped.productIds.map((productId) => ({ productId })) },
            categories: { create: scoped.categoryIds.map((categoryId) => ({ categoryId })) },
          },
        });
      }
      const shape = this.shapeFor(current.type, {
        value: value.toString(),
        maxDiscount:
          input.maxDiscount !== undefined ? input.maxDiscount : current.maxDiscount?.toString(),
        buyQuantity:
          input.buyQuantity !== undefined ? Number(input.buyQuantity) : current.buyQuantity,
        getQuantity:
          input.getQuantity !== undefined ? Number(input.getQuantity) : current.getQuantity,
        minQuantity:
          input.minQuantity !== undefined ? Number(input.minQuantity) : current.minQuantity,
      });
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.season !== undefined ? { season: input.season } : {}),
          ...shape,
          ...(input.minSpend !== undefined ? { minSpend: D(input.minSpend) } : {}),
          startsAt,
          endsAt,
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.priority !== undefined ? { priority: Number(input.priority) } : {}),
        },
        include,
      });
      await this.audit.record(
        { action: 'campaign.updated', actorId: user.id, entityType: 'campaign', entityId: id },
        context,
        tx,
      );
      return updated;
    });
    const usage = await this.usage([id]);
    return this.dto(row, usage.get(id));
  }

  /** Storefront: campaigns running now (optionally one store's, with marketplace-wide ones). */
  async active(storeId?: string): Promise<{ items: ActiveCampaign[] }> {
    const now = new Date();
    const store = storeId
      ? await this.prisma.store.findUnique({ where: { id: storeId }, select: { sellerId: true } })
      : null;
    const rows = await this.prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        AND: [
          ...(store
            ? [{ OR: [{ scope: 'PLATFORM' as const }, { sellerId: store.sellerId }] }]
            : []),
          // Only sellers that can sell.
          { OR: [{ scope: 'PLATFORM' as const }, { seller: { status: 'VERIFIED' as const } }] },
        ],
      },
      include: {
        seller: {
          select: {
            stores: {
              where: { status: 'ACTIVE' },
              select: { id: true, name: true, slug: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { endsAt: 'asc' }],
      take: 50,
    });
    return {
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        season: c.season,
        type: c.type,
        scope: c.scope,
        store: c.seller?.stores[0] ?? null,
        headline: campaignHeadline(c),
        minSpend: c.minSpend.toFixed(2),
        minQuantity: c.minQuantity,
        endsAt: c.endsAt.toISOString(),
      })),
    };
  }
}
