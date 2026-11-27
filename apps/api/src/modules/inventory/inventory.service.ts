import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { emitNotificationInTx, Prisma, sellerRecipientIdsInTx } from '@marketplace/database';
import {
  type AuthenticatedUser,
  INVENTORY_MOVEMENT_LABELS,
  MAX_WAREHOUSES_PER_SELLER,
  type PaginatedResponse,
} from '@marketplace/shared-types';
import type {
  CreateTransferRequest,
  CreateWarehouseRequest,
  InventoryOverview,
  InventorySummary,
  MovementDto,
  MovementListQuery,
  MovementResult,
  RecordMovementRequest,
  StockLevelDto,
  StockLevelListQuery,
  TransferDto,
  UpdateWarehouseRequest,
  WarehouseDto,
  WarehouseList,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { areaName, LocationsService } from '../locations/locations.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  applyStockChange,
  ensureStockLevel,
  InsufficientStockError,
  manualDelta,
  recordLedger,
  withUniqueRetry,
} from './stock-ledger';

const warehouseNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Warehouse not found.');
const invalid = (message: string, path: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

const levelInclude = {
  warehouse: { select: { id: true, name: true, code: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      title: true,
      product: { select: { id: true, name: true, status: true } },
    },
  },
} satisfies Prisma.StockLevelInclude;
type LevelRow = Prisma.StockLevelGetPayload<{ include: typeof levelInclude }>;

const movementInclude = {
  warehouse: { select: { id: true, name: true, code: true } },
  variant: {
    select: { id: true, sku: true, title: true, product: { select: { id: true, name: true } } },
  },
  actor: { select: { firstName: true, lastName: true } },
} satisfies Prisma.InventoryMovementInclude;
type MovementRow = Prisma.InventoryMovementGetPayload<{ include: typeof movementInclude }>;

export function levelDto(row: LevelRow): StockLevelDto {
  const available = row.quantityOnHand - row.reservedQuantity;
  return {
    id: row.id,
    warehouse: row.warehouse,
    variant: { id: row.variant.id, sku: row.variant.sku, title: row.variant.title },
    product: row.variant.product,
    quantityOnHand: row.quantityOnHand,
    reservedQuantity: row.reservedQuantity,
    availableQuantity: available,
    damagedQuantity: row.damagedQuantity,
    lowStockThreshold: row.lowStockThreshold,
    isLowStock: row.lowStockThreshold !== null && available <= row.lowStockThreshold,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function movementDto(row: MovementRow): MovementDto {
  return {
    id: row.id,
    type: row.type,
    warehouse: row.warehouse,
    variant: { id: row.variant.id, sku: row.variant.sku, title: row.variant.title },
    product: row.variant.product,
    quantityChange: row.quantityChange,
    damagedChange: row.damagedChange,
    onHandAfter: row.onHandAfter,
    reservedAfter: row.reservedAfter,
    damagedAfter: row.damagedAfter,
    reason: row.reason,
    transferId: row.transferId,
    reservationId: row.reservationId,
    actor: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Warehouses, stock levels and the inventory ledger for sellers, plus the staff overview.
 * Every change to stock goes through one guarded UPDATE and one ledger row, in a transaction.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly locations: LocationsService,
  ) {}

  // ---- Warehouses ---------------------------------------------------------------------------

  async warehouses(user: AuthenticatedUser): Promise<WarehouseList> {
    const { sellerId } = sellerScope(user);
    const [rows, totals] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { sellerId },
        orderBy: [{ isDefault: 'desc' }, { status: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.stockLevel.groupBy({
        by: ['warehouseId'],
        where: { sellerId },
        _count: { _all: true },
        _sum: { quantityOnHand: true, reservedQuantity: true, damagedQuantity: true },
      }),
    ]);
    const byWarehouse = new Map(totals.map((t) => [t.warehouseId, t]));
    return {
      warehouses: rows.map((w) => {
        const t = byWarehouse.get(w.id);
        return {
          id: w.id,
          name: w.name,
          code: w.code,
          addressLine1: w.addressLine1,
          addressLine2: w.addressLine2,
          barangay: w.barangay,
          city: w.city,
          province: w.province,
          postalCode: w.postalCode,
          contactName: w.contactName,
          phone: w.phone,
          location:
            w.regionCode && w.cityCode
              ? {
                  regionCode: w.regionCode,
                  provinceCode: w.provinceCode,
                  cityCode: w.cityCode,
                  barangayCode: w.barangayCode,
                }
              : null,
          canShip: !!(w.regionCode && w.cityCode),
          status: w.status,
          isDefault: w.isDefault,
          totals: {
            skus: t?._count._all ?? 0,
            onHand: t?._sum.quantityOnHand ?? 0,
            reserved: t?._sum.reservedQuantity ?? 0,
            damaged: t?._sum.damagedQuantity ?? 0,
          },
          createdAt: w.createdAt.toISOString(),
        } satisfies WarehouseDto;
      }),
    };
  }

  async createWarehouse(
    user: AuthenticatedUser,
    input: CreateWarehouseRequest,
    context: RequestContext,
  ): Promise<WarehouseList> {
    const { sellerId } = this.assertCanManage(user);
    try {
      await this.prisma.$transaction(async (tx) => {
        const count = await tx.warehouse.count({ where: { sellerId } });
        if (count >= MAX_WAREHOUSES_PER_SELLER) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'CONFLICT',
            `A seller can have at most ${MAX_WAREHOUSES_PER_SELLER} warehouses.`,
          );
        }
        // The first warehouse is the default.
        const isDefault = count === 0 || !!input.isDefault;
        if (isDefault)
          await tx.warehouse.updateMany({
            where: { sellerId, isDefault: true },
            data: { isDefault: false },
          });
        const created = await tx.warehouse.create({
          data: {
            sellerId,
            ...(await this.warehouseData(input)),
            isDefault,
          } as Prisma.WarehouseUncheckedCreateInput,
        });
        await this.audit.record(
          {
            action: 'warehouse.created',
            actorId: user.id,
            entityType: 'warehouse',
            entityId: created.id,
            metadata: { sellerId, code: created.code },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Another warehouse uses this code.',
          [{ path: 'code', message: 'Already used' }],
        );
      }
      throw error;
    }
    return this.warehouses(user);
  }

  async updateWarehouse(
    user: AuthenticatedUser,
    id: string,
    input: UpdateWarehouseRequest,
    context: RequestContext,
  ): Promise<WarehouseList> {
    const { sellerId } = this.assertCanManage(user);
    const warehouse = await this.ownWarehouse(sellerId, id);
    if (input.status === 'INACTIVE' && warehouse.isDefault) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Make another warehouse the default before deactivating this one.',
      );
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.warehouse.update({ where: { id }, data: await this.warehouseData(input) });
        await this.audit.record(
          {
            action: 'warehouse.updated',
            actorId: user.id,
            entityType: 'warehouse',
            entityId: id,
            metadata: { fields: Object.keys(input) },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'Another warehouse uses this code.',
          [{ path: 'code', message: 'Already used' }],
        );
      }
      throw error;
    }
    return this.warehouses(user);
  }

  async setDefaultWarehouse(
    user: AuthenticatedUser,
    id: string,
    context: RequestContext,
  ): Promise<WarehouseList> {
    const { sellerId } = this.assertCanManage(user);
    const warehouse = await this.ownWarehouse(sellerId, id);
    if (warehouse.status !== 'ACTIVE')
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Activate the warehouse first.');
    await this.prisma.$transaction(async (tx) => {
      await tx.warehouse.updateMany({
        where: { sellerId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.warehouse.update({ where: { id }, data: { isDefault: true } });
      await this.audit.record(
        {
          action: 'warehouse.made_default',
          actorId: user.id,
          entityType: 'warehouse',
          entityId: id,
        },
        context,
        tx,
      );
    });
    return this.warehouses(user);
  }

  // ---- Stock levels -------------------------------------------------------------------------

  async stockLevels(
    user: AuthenticatedUser,
    query: StockLevelListQuery,
  ): Promise<PaginatedResponse<StockLevelDto>> {
    const { sellerId } = sellerScope(user);
    let lowIds: string[] | undefined;
    if (query.lowStock) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "stock_levels"
        WHERE "seller_id" = ${sellerId}::uuid
          AND "low_stock_threshold" IS NOT NULL
          AND "quantity_on_hand" - "reserved_quantity" <= "low_stock_threshold"`;
      lowIds = rows.map((r) => r.id);
    }
    const where: Prisma.StockLevelWhereInput = {
      sellerId,
      ...(lowIds ? { id: { in: lowIds } } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.productId ? { variant: { productId: query.productId } } : {}),
      ...(query.search
        ? {
            OR: [
              { variant: { sku: { contains: query.search, mode: 'insensitive' } } },
              { variant: { product: { name: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.stockLevel.findMany({
        where,
        include: levelInclude,
        orderBy: [
          { variant: { product: { name: 'asc' } } },
          { variant: { position: 'asc' } },
          { warehouse: { name: 'asc' } },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.stockLevel.count({ where }),
    ]);
    return {
      items: rows.map(levelDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async summary(user: AuthenticatedUser): Promise<InventorySummary> {
    const { sellerId } = sellerScope(user);
    const [totals] = await this.totals(Prisma.sql`WHERE s."seller_id" = ${sellerId}::uuid`);
    const [warehouses, activeReservations] = await Promise.all([
      this.prisma.warehouse.count({ where: { sellerId, status: 'ACTIVE' } }),
      this.prisma.stockReservation.count({ where: { sellerId, status: 'ACTIVE' } }),
    ]);
    return { ...totals!, warehouses, activeReservations };
  }

  async setThreshold(
    user: AuthenticatedUser,
    stockLevelId: string,
    threshold: number | null,
    context: RequestContext,
  ): Promise<StockLevelDto> {
    const { sellerId } = this.assertCanManage(user);
    const level = await this.prisma.stockLevel.findFirst({ where: { id: stockLevelId, sellerId } });
    if (!level) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Stock level not found.');
    await this.prisma.stockLevel.update({
      where: { id: stockLevelId },
      // A new threshold starts a fresh notice cycle.
      data: { lowStockThreshold: threshold, lowStockNotifiedAt: null },
    });
    await this.audit.record(
      {
        action: 'inventory.threshold_set',
        actorId: user.id,
        entityType: 'stock_level',
        entityId: stockLevelId,
        metadata: { threshold },
      },
      context,
    );
    await this.checkLowStock([stockLevelId]);
    const row = await this.prisma.stockLevel.findUniqueOrThrow({
      where: { id: stockLevelId },
      include: levelInclude,
    });
    return levelDto(row);
  }

  // ---- Movements ----------------------------------------------------------------------------

  async recordMovement(
    user: AuthenticatedUser,
    input: RecordMovementRequest,
  ): Promise<MovementResult> {
    const { sellerId } = this.assertCanManage(user);
    const warehouse = await this.activeWarehouse(sellerId, input.warehouseId, 'warehouseId');
    const variant = await this.trackedVariant(sellerId, input.variantId, 'variantId');
    const quantity = Number(input.quantity);
    const delta = manualDelta(input.type, quantity);

    const movement = await withUniqueRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const level = await ensureStockLevel(tx, sellerId, warehouse.id, variant.id);
        const after = await applyStockChange(tx, level.id, delta);
        if (!after) {
          const current = await tx.stockLevel.findUniqueOrThrow({ where: { id: level.id } });
          const available = current.quantityOnHand - current.reservedQuantity;
          throw new InsufficientStockError(
            input.type === 'DAMAGED_WRITE_OFF'
              ? `Only ${current.damagedQuantity} damaged units of ${variant.sku} are recorded in ${warehouse.code}.`
              : `Only ${available} units of ${variant.sku} are available in ${warehouse.code}.`,
            input.type === 'DAMAGED_WRITE_OFF' ? current.damagedQuantity : available,
          );
        }
        return recordLedger(tx, {
          sellerId,
          warehouseId: warehouse.id,
          variantId: variant.id,
          stockLevelId: level.id,
          type: input.type,
          quantityChange: delta.onHand,
          damagedChange: delta.damaged,
          after,
          reason: input.reason ?? null,
          actorId: user.id,
        });
      }),
    );
    await this.checkLowStock([movement.stockLevelId]);
    const [row, level] = await Promise.all([
      this.prisma.inventoryMovement.findUniqueOrThrow({
        where: { id: movement.id },
        include: movementInclude,
      }),
      this.prisma.stockLevel.findUniqueOrThrow({
        where: { id: movement.stockLevelId },
        include: levelInclude,
      }),
    ]);
    return { movement: movementDto(row), stockLevel: levelDto(level) };
  }

  async movements(
    user: AuthenticatedUser,
    query: MovementListQuery,
  ): Promise<PaginatedResponse<MovementDto>> {
    const { sellerId } = sellerScope(user);
    const where: Prisma.InventoryMovementWhereInput = {
      sellerId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.productId ? { variant: { productId: query.productId } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where,
        include: movementInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return {
      items: rows.map(movementDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  // ---- Transfers ----------------------------------------------------------------------------

  /** Moves stock between two of the seller's warehouses in one transaction (all or nothing). */
  async transfer(
    user: AuthenticatedUser,
    input: CreateTransferRequest,
    context: RequestContext,
  ): Promise<TransferDto> {
    const { sellerId } = this.assertCanManage(user);
    const from = await this.activeWarehouse(sellerId, input.fromWarehouseId, 'fromWarehouseId');
    const to = await this.activeWarehouse(sellerId, input.toWarehouseId, 'toWarehouseId');
    const items = [...input.items]
      .map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) }))
      // A fixed lock order prevents deadlocks between concurrent transfers.
      .sort((a, b) => a.variantId.localeCompare(b.variantId));
    const variants = new Map<string, { id: string; sku: string }>();
    for (const [index, item] of items.entries()) {
      variants.set(
        item.variantId,
        await this.trackedVariant(sellerId, item.variantId, `items.${index}.variantId`),
      );
    }

    const transfer = await withUniqueRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.stockTransfer.create({
          data: {
            sellerId,
            fromWarehouseId: from.id,
            toWarehouseId: to.id,
            note: input.note ?? null,
            createdById: user.id,
            items: { create: items },
          },
        });
        for (const item of items) {
          const sku = variants.get(item.variantId)!.sku;
          const source = await tx.stockLevel.findUnique({
            where: { warehouseId_variantId: { warehouseId: from.id, variantId: item.variantId } },
          });
          const out = source
            ? await applyStockChange(tx, source.id, { onHand: -item.quantity })
            : null;
          if (!source || !out) {
            const available = source ? source.quantityOnHand - source.reservedQuantity : 0;
            throw new InsufficientStockError(
              `Only ${available} units of ${sku} are available in ${from.code}.`,
              available,
            );
          }
          await recordLedger(tx, {
            sellerId,
            warehouseId: from.id,
            variantId: item.variantId,
            stockLevelId: source.id,
            type: 'TRANSFER_OUT',
            quantityChange: -item.quantity,
            after: out,
            transferId: created.id,
            reason: input.note ?? null,
            actorId: user.id,
          });
          const target = await ensureStockLevel(tx, sellerId, to.id, item.variantId);
          const inn = await applyStockChange(tx, target.id, { onHand: item.quantity });
          await recordLedger(tx, {
            sellerId,
            warehouseId: to.id,
            variantId: item.variantId,
            stockLevelId: target.id,
            type: 'TRANSFER_IN',
            quantityChange: item.quantity,
            after: inn!,
            transferId: created.id,
            reason: input.note ?? null,
            actorId: user.id,
          });
        }
        await this.audit.record(
          {
            action: 'inventory.transferred',
            actorId: user.id,
            entityType: 'stock_transfer',
            entityId: created.id,
            metadata: { from: from.code, to: to.code, items },
          },
          context,
          tx,
        );
        return created;
      }),
    );
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        warehouseId: { in: [from.id, to.id] },
        variantId: { in: items.map((i) => i.variantId) },
      },
      select: { id: true },
    });
    await this.checkLowStock(levels.map((l) => l.id));
    return this.transferDto(transfer.id);
  }

  async transfers(
    user: AuthenticatedUser,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<TransferDto>> {
    const { sellerId } = sellerScope(user);
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({
        where: { sellerId },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockTransfer.count({ where: { sellerId } }),
    ]);
    return {
      items: await Promise.all(rows.map((r) => this.transferDto(r.id))),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  private async transferDto(id: string): Promise<TransferDto> {
    const row = await this.prisma.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: {
        fromWarehouse: { select: { id: true, name: true, code: true } },
        toWarehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        items: {
          include: {
            variant: { select: { sku: true, title: true, product: { select: { name: true } } } },
          },
        },
      },
    });
    return {
      id: row.id,
      fromWarehouse: row.fromWarehouse,
      toWarehouse: row.toWarehouse,
      items: row.items.map((i) => ({
        variantId: i.variantId,
        sku: i.variant.sku,
        title: i.variant.title,
        productName: i.variant.product.name,
        quantity: i.quantity,
      })),
      note: row.note,
      createdBy: `${row.createdBy.firstName} ${row.createdBy.lastName}`,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- Low stock ----------------------------------------------------------------------------

  /**
   * Sends one notice when available stock falls to the threshold, and re-arms when it rises
   * above it again. Compare-and-set on low_stock_notified_at, so concurrent changes send one notice.
   */
  async checkLowStock(stockLevelIds: string[]): Promise<void> {
    if (stockLevelIds.length === 0) return;
    try {
      const rows = await this.prisma.stockLevel.findMany({
        where: { id: { in: stockLevelIds }, lowStockThreshold: { not: null } },
        include: { ...levelInclude, seller: { select: { email: true, businessName: true } } },
      });
      const notify: typeof rows = [];
      for (const row of rows) {
        const available = row.quantityOnHand - row.reservedQuantity;
        const low = available <= row.lowStockThreshold!;
        if (low && !row.lowStockNotifiedAt) {
          const { count } = await this.prisma.stockLevel.updateMany({
            where: { id: row.id, lowStockNotifiedAt: null },
            data: { lowStockNotifiedAt: new Date() },
          });
          if (count > 0) notify.push(row);
        } else if (!low && row.lowStockNotifiedAt) {
          await this.prisma.stockLevel.updateMany({
            where: { id: row.id },
            data: { lowStockNotifiedAt: null },
          });
        }
      }
      const bySeller = new Map<string, typeof rows>();
      for (const row of notify)
        bySeller.set(row.sellerId, [...(bySeller.get(row.sellerId) ?? []), row]);
      for (const group of bySeller.values()) {
        const seller = group[0]!.seller;
        await this.notifications.safely('low stock email', () =>
          this.notifications.sendLowStock({
            to: seller.email,
            businessName: seller.businessName,
            items: group.map((r) => ({
              productName: r.variant.product.name,
              variantTitle: r.variant.title,
              sku: r.variant.sku,
              warehouse: `${r.warehouse.name} (${r.warehouse.code})`,
              available: r.quantityOnHand - r.reservedQuantity,
              threshold: r.lowStockThreshold!,
            })),
            link: `${this.config.appUrls.seller}/inventory?lowStock=true`,
          }),
        );
        await emitNotificationInTx(this.prisma, {
          event: 'LOW_STOCK',
          userIds: await sellerRecipientIdsInTx(this.prisma, group[0]!.sellerId),
          data: { count: group.length },
          link: '/inventory?lowStock=true',
        });
      }
      if (bySeller.size > 0) await this.notifications.kickDispatch();
    } catch (error) {
      // A notice is never worth failing the stock change that already committed.
      this.logger.error(`Low-stock check failed: ${(error as Error).message}`);
    }
  }

  // ---- Staff overview -----------------------------------------------------------------------

  async overview(
    search: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<InventoryOverview> {
    const [totals] = await this.totals(Prisma.empty);
    const [warehouses, activeReservations] = await Promise.all([
      this.prisma.warehouse.count({ where: { status: 'ACTIVE' } }),
      this.prisma.stockReservation.count({ where: { status: 'ACTIVE' } }),
    ]);
    const filter = search
      ? Prisma.sql`AND sel."business_name" ILIKE ${`%${search}%`}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        sellerId: string;
        businessName: string;
        warehouses: number;
        skus: number;
        onHand: number;
        reserved: number;
        available: number;
        damaged: number;
        lowStock: number;
        outOfStock: number;
        total: number;
      }[]
    >`
      SELECT sel."id" AS "sellerId", sel."business_name" AS "businessName",
             (SELECT COUNT(*)::int FROM "warehouses" w WHERE w."seller_id" = sel."id" AND w."status" = 'ACTIVE') AS "warehouses",
             COUNT(s."id")::int AS "skus",
             COALESCE(SUM(s."quantity_on_hand"), 0)::int AS "onHand",
             COALESCE(SUM(s."reserved_quantity"), 0)::int AS "reserved",
             COALESCE(SUM(s."quantity_on_hand" - s."reserved_quantity"), 0)::int AS "available",
             COALESCE(SUM(s."damaged_quantity"), 0)::int AS "damaged",
             COUNT(*) FILTER (WHERE s."low_stock_threshold" IS NOT NULL
                              AND s."quantity_on_hand" - s."reserved_quantity" <= s."low_stock_threshold")::int AS "lowStock",
             COUNT(*) FILTER (WHERE s."id" IS NOT NULL AND s."quantity_on_hand" - s."reserved_quantity" = 0)::int AS "outOfStock",
             COUNT(*) OVER ()::int AS "total"
      FROM "sellers" sel
      JOIN "stock_levels" s ON s."seller_id" = sel."id"
      WHERE TRUE ${filter}
      GROUP BY sel."id", sel."business_name"
      ORDER BY "onHand" DESC, sel."business_name"
      LIMIT ${pageSize}::int OFFSET ${(page - 1) * pageSize}::int`;
    const totalItems = rows[0]?.total ?? 0;
    return {
      totals: { ...totals!, warehouses, activeReservations },
      sellers: {
        items: rows.map(({ total: _total, ...row }) => row),
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  private totals(where: Prisma.Sql) {
    return this.prisma.$queryRaw<Omit<InventorySummary, 'warehouses' | 'activeReservations'>[]>`
      SELECT COUNT(*)::int AS "skus",
             COALESCE(SUM(s."quantity_on_hand"), 0)::int AS "onHand",
             COALESCE(SUM(s."reserved_quantity"), 0)::int AS "reserved",
             COALESCE(SUM(s."quantity_on_hand" - s."reserved_quantity"), 0)::int AS "available",
             COALESCE(SUM(s."damaged_quantity"), 0)::int AS "damaged",
             COUNT(*) FILTER (WHERE s."low_stock_threshold" IS NOT NULL
                              AND s."quantity_on_hand" - s."reserved_quantity" <= s."low_stock_threshold")::int AS "lowStock",
             COUNT(*) FILTER (WHERE s."quantity_on_hand" - s."reserved_quantity" = 0)::int AS "outOfStock"
      FROM "stock_levels" s ${where}`;
  }

  // ---- Helpers ------------------------------------------------------------------------------

  private assertCanManage(user: AuthenticatedUser) {
    const scope = sellerScope(user);
    if (!user.permissions.includes('seller.inventory.manage')) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You do not have permission to do this.',
      );
    }
    if (scope.status !== 'VERIFIED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SELLER_NOT_VERIFIED',
        'Your business must be verified (and not suspended) to manage inventory.',
      );
    }
    return scope;
  }

  private async ownWarehouse(sellerId: string, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, sellerId } });
    if (!warehouse) throw warehouseNotFound();
    return warehouse;
  }

  private async activeWarehouse(sellerId: string, id: string, path: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, sellerId } });
    if (!warehouse) throw invalid('Choose one of your warehouses.', path);
    if (warehouse.status !== 'ACTIVE') throw invalid('This warehouse is inactive.', path);
    return warehouse;
  }

  private async trackedVariant(sellerId: string, id: string, path: string) {
    const variant = await this.prisma.productVariant.findFirst({ where: { id, sellerId } });
    if (!variant) throw invalid('Choose one of your product variants.', path);
    if (!variant.trackInventory) throw invalid(`${variant.sku} does not track stock.`, path);
    return variant;
  }

  private async warehouseData(
    input: UpdateWarehouseRequest,
  ): Promise<Prisma.WarehouseUncheckedUpdateInput> {
    let place: Prisma.WarehouseUncheckedUpdateInput = {};
    if (input.location === null) {
      place = { regionCode: null, provinceCode: null, cityCode: null, barangayCode: null };
    } else if (input.location) {
      const resolved = await this.locations.resolve(input.location, 'location.');
      place = {
        regionCode: resolved.region.code,
        provinceCode: resolved.province?.code ?? null,
        cityCode: resolved.city.code,
        barangayCode: resolved.barangay.code,
        barangay: resolved.barangay.name,
        city: resolved.city.name,
        province: areaName(resolved),
      };
    }
    const text = Object.fromEntries(
      Object.entries({
        name: input.name?.trim(),
        code: input.code,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        barangay: input.barangay,
        city: input.city,
        province: input.province,
        postalCode: input.postalCode,
        contactName: input.contactName,
        phone: input.phone,
        status: input.status,
      }).filter(([, v]) => v !== undefined),
    );
    return { ...text, ...place };
  }
}

export { INVENTORY_MOVEMENT_LABELS };
