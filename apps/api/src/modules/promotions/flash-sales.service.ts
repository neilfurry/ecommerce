import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  FlashSaleDto,
  FlashSaleInput,
  FlashSaleItemInput,
  UpdateFlashSaleRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const include = (sellerId?: string) =>
  ({
    items: {
      ...(sellerId ? { where: { sellerId } } : {}),
      include: {
        seller: { select: { businessName: true } },
        product: { select: { name: true } },
        variant: { select: { sku: true, title: true, regularPrice: true } },
      },
      orderBy: { createdAt: 'asc' },
    },
  }) satisfies Prisma.FlashSaleInclude;
type SaleRow = Prisma.FlashSaleGetPayload<{ include: ReturnType<typeof include> }>;

const phaseOf = (sale: { startsAt: Date; endsAt: Date }, now = new Date()) =>
  now < sale.startsAt ? 'UPCOMING' : now < sale.endsAt ? 'RUNNING' : 'ENDED';

const dto = (sale: SaleRow): FlashSaleDto => ({
  id: sale.id,
  title: sale.title,
  startsAt: sale.startsAt.toISOString(),
  endsAt: sale.endsAt.toISOString(),
  status: sale.status,
  phase: phaseOf(sale),
  items: sale.items.map((i) => ({
    id: i.id,
    sellerId: i.sellerId,
    sellerName: i.seller.businessName,
    productId: i.productId,
    productName: i.product.name,
    variantId: i.variantId,
    sku: i.variant.sku,
    variantTitle: i.variant.title,
    regularPrice: i.variant.regularPrice.toFixed(2),
    flashPrice: i.flashPrice.toFixed(2),
    quantityLimit: i.quantityLimit,
    soldQuantity: i.soldQuantity,
    perOrderLimit: i.perOrderLimit,
    status: i.status,
  })),
});

const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);
const notFound = (what = 'Flash sale') =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);

/**
 * Flash sales: the marketplace schedules a campaign; sellers offer their own variants at a
 * flash price with a quantity cap. Checkout sells at the flash price only while units remain.
 */
@Injectable()
export class FlashSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<FlashSaleDto[]> {
    const rows = await this.prisma.flashSale.findMany({
      include: include(),
      orderBy: { startsAt: 'desc' },
      take: 100,
    });
    return rows.map(dto);
  }

  async create(
    user: AuthenticatedUser,
    input: FlashSaleInput,
    context: RequestContext,
  ): Promise<FlashSaleDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.flashSale.create({
        data: {
          title: input.title,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          status: input.status ?? 'ACTIVE',
          createdById: user.id,
        },
        include: include(),
      });
      await this.audit.record(
        {
          action: 'flash_sale.created',
          actorId: user.id,
          entityType: 'flash_sale',
          entityId: created.id,
        },
        context,
        tx,
      );
      return created;
    });
    return dto(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateFlashSaleRequest,
    context: RequestContext,
  ): Promise<FlashSaleDto> {
    const current = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!current) throw notFound();
    const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    if (endsAt <= startsAt) throw invalid('endsAt', 'Must be after the start');
    if (
      input.startsAt &&
      phaseOf(current) !== 'UPCOMING' &&
      startsAt.getTime() !== current.startsAt.getTime()
    ) {
      throw invalid('startsAt', 'A flash sale that has started keeps its start time');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.flashSale.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          startsAt,
          endsAt,
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: include(),
      });
      await this.audit.record(
        { action: 'flash_sale.updated', actorId: user.id, entityType: 'flash_sale', entityId: id },
        context,
        tx,
      );
      return updated;
    });
    return dto(row);
  }

  /** Staff can switch an item off (for example a misleading price). */
  async setItemStatus(
    user: AuthenticatedUser,
    itemId: string,
    status: 'ACTIVE' | 'INACTIVE',
    context: RequestContext,
  ): Promise<FlashSaleDto> {
    const item = await this.prisma.flashSaleItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound('Flash sale item');
    await this.prisma.$transaction(async (tx) => {
      await tx.flashSaleItem.update({ where: { id: itemId }, data: { status } });
      await this.audit.record(
        {
          action: `flash_sale.item_${status === 'ACTIVE' ? 'enabled' : 'disabled'}`,
          actorId: user.id,
          entityType: 'flash_sale_item',
          entityId: itemId,
        },
        context,
        tx,
      );
    });
    return dto(
      await this.prisma.flashSale.findUniqueOrThrow({
        where: { id: item.flashSaleId },
        include: include(),
      }),
    );
  }

  // ---- Seller side ------------------------------------------------------------------------

  /** Flash sales a seller can join (upcoming and running), with only the seller's items. */
  async forSeller(user: AuthenticatedUser): Promise<FlashSaleDto[]> {
    const { sellerId } = sellerScope(user);
    const rows = await this.prisma.flashSale.findMany({
      where: { status: 'ACTIVE', endsAt: { gt: new Date() } },
      include: include(sellerId),
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(dto);
  }

  async addItem(
    user: AuthenticatedUser,
    flashSaleId: string,
    input: FlashSaleItemInput,
    context: RequestContext,
  ): Promise<FlashSaleDto> {
    const { sellerId, status } = sellerScope(user);
    if (status !== 'VERIFIED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SELLER_NOT_VERIFIED',
        'Only verified sellers can join flash sales.',
      );
    }
    const sale = await this.prisma.flashSale.findFirst({
      where: { id: flashSaleId, status: 'ACTIVE', endsAt: { gt: new Date() } },
    });
    if (!sale) throw notFound();
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: input.variantId, sellerId },
      include: { product: true },
    });
    if (!variant || variant.status !== 'ACTIVE' || variant.product.status !== 'ACTIVE') {
      throw invalid('variantId', 'Choose one of your active, approved products');
    }
    const flashPrice = new Prisma.Decimal(input.flashPrice);
    if (!flashPrice.greaterThan(0) || !flashPrice.lessThan(variant.regularPrice)) {
      throw invalid(
        'flashPrice',
        `Must be below the regular price (₱${variant.regularPrice.toFixed(2)})`,
      );
    }
    const overlapping = await this.prisma.flashSaleItem.count({
      where: {
        variantId: variant.id,
        status: 'ACTIVE',
        flashSale: {
          status: 'ACTIVE',
          startsAt: { lt: sale.endsAt },
          endsAt: { gt: sale.startsAt },
        },
      },
    });
    if (overlapping) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This variant is already in a flash sale at that time.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.flashSaleItem.create({
        data: {
          flashSaleId,
          sellerId,
          productId: variant.productId,
          variantId: variant.id,
          flashPrice,
          quantityLimit: Number(input.quantityLimit),
          perOrderLimit: input.perOrderLimit == null ? null : Number(input.perOrderLimit),
        },
      });
      await this.audit.record(
        {
          action: 'flash_sale.item_added',
          actorId: user.id,
          entityType: 'flash_sale_item',
          entityId: item.id,
          metadata: { sellerId },
        },
        context,
        tx,
      );
    });
    return this.forSellerSale(sellerId, flashSaleId);
  }

  /** Removes an item that sold nothing; once units sold, it is switched off instead. */
  async removeItem(
    user: AuthenticatedUser,
    itemId: string,
    context: RequestContext,
  ): Promise<FlashSaleDto> {
    const { sellerId } = sellerScope(user);
    const item = await this.prisma.flashSaleItem.findFirst({ where: { id: itemId, sellerId } });
    if (!item) throw notFound('Flash sale item');
    await this.prisma.$transaction(async (tx) => {
      if (item.soldQuantity === 0) await tx.flashSaleItem.delete({ where: { id: itemId } });
      else await tx.flashSaleItem.update({ where: { id: itemId }, data: { status: 'INACTIVE' } });
      await this.audit.record(
        {
          action: 'flash_sale.item_removed',
          actorId: user.id,
          entityType: 'flash_sale_item',
          entityId: itemId,
          metadata: { sellerId },
        },
        context,
        tx,
      );
    });
    return this.forSellerSale(sellerId, item.flashSaleId);
  }

  private async forSellerSale(sellerId: string, id: string) {
    return dto(
      await this.prisma.flashSale.findUniqueOrThrow({ where: { id }, include: include(sellerId) }),
    );
  }
}
