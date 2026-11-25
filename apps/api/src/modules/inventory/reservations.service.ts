import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, releaseExpiredReservations } from '@marketplace/database';
import {
  type AuthenticatedUser,
  DEFAULT_RESERVATION_TTL_MINUTES,
  MAX_RESERVATION_TTL_MINUTES,
  type PaginatedResponse,
} from '@marketplace/shared-types';
import type { ReservationDto, reservationStatusSchema } from '@marketplace/validation';
import type { z } from 'zod';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InventoryService } from './inventory.service';
import { applyStockChange, InsufficientStockError, recordLedger } from './stock-ledger';

type Tx = Prisma.TransactionClient;

export interface ReserveInput {
  /** The checkout session holding the stock. */
  checkoutReference: string;
  items: { variantId: string; quantity: number }[];
  ttlMinutes?: number;
}

const include = {
  variant: { select: { id: true, sku: true, title: true } },
  warehouse: { select: { id: true, name: true, code: true } },
} satisfies Prisma.StockReservationInclude;
type ReservationRow = Prisma.StockReservationGetPayload<{ include: typeof include }>;

const toDto = (r: ReservationRow): ReservationDto => ({
  id: r.id,
  variant: r.variant,
  warehouse: r.warehouse,
  quantity: r.quantity,
  status: r.status,
  checkoutReference: r.checkoutReference,
  orderItemId: r.orderItemId,
  expiresAt: r.expiresAt.toISOString(),
  releasedAt: r.releasedAt?.toISOString() ?? null,
  convertedAt: r.convertedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Stock reservations for checkout (the checkout itself arrives in the next phase).
 *
 *  - reserve: holds units (reserved_quantity up) until expires_at, all items or none;
 *  - release: gives them back (checkout cancelled);
 *  - expire: gives back holds past their expiry (worker sweep, and lazily before reserving);
 *  - convert: when the order is fulfilled, the held units leave on-hand stock (SALE movement).
 *
 * Each step locks the stock level row, so concurrent checkouts can never oversell.
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async reserve(input: ReserveInput): Promise<ReservationDto[]> {
    const ttl = Math.min(
      Math.max(input.ttlMinutes ?? DEFAULT_RESERVATION_TTL_MINUTES, 1),
      MAX_RESERVATION_TTL_MINUTES,
    );
    const expiresAt = new Date(Date.now() + ttl * 60_000);
    // Same variant twice is one line; a fixed order prevents deadlocks between checkouts.
    const merged = new Map<string, number>();
    for (const item of input.items)
      merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
    const items = [...merged].sort(([a], [b]) => a.localeCompare(b));

    const ids = await this.prisma.$transaction(async (tx) => {
      const created: string[] = [];
      for (const [variantId, quantity] of items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          include: { product: { select: { status: true } } },
        });
        if (!variant || variant.status !== 'ACTIVE' || variant.product.status !== 'ACTIVE') {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'VALIDATION_FAILED',
            'An item is not available.',
            [{ path: 'items', message: `${variant?.sku ?? variantId} is not available` }],
          );
        }
        if (!variant.trackInventory) continue;
        created.push(
          ...(await this.reserveVariant(tx, variant, quantity, input.checkoutReference, expiresAt)),
        );
      }
      return created;
    });
    const rows = await this.prisma.stockReservation.findMany({
      where: { id: { in: ids } },
      include,
    });
    return rows.map(toDto);
  }

  private async reserveVariant(
    tx: Tx,
    variant: { id: string; sku: string; sellerId: string },
    quantity: number,
    checkoutReference: string,
    expiresAt: Date,
  ): Promise<string[]> {
    const levels = await tx.stockLevel.findMany({
      where: { variantId: variant.id, warehouse: { status: 'ACTIVE' } },
      include: { warehouse: { select: { isDefault: true } } },
    });
    // Expired holds must not block this checkout, whether or not the sweep ran yet.
    await releaseExpiredReservations(tx, { stockLevelIds: levels.map((l) => l.id) });

    // Default warehouse first, then the one with the most stock.
    const ordered = [...levels].sort(
      (a, b) =>
        Number(b.warehouse.isDefault) - Number(a.warehouse.isDefault) ||
        b.quantityOnHand - b.reservedQuantity - (a.quantityOnHand - a.reservedQuantity) ||
        a.id.localeCompare(b.id),
    );
    let needed = quantity;
    const created: string[] = [];
    for (const level of ordered) {
      if (needed === 0) break;
      // Lock the row and read its current numbers (waits for concurrent checkouts).
      const [locked] = await tx.$queryRaw<{ available: number }[]>`
        SELECT ("quantity_on_hand" - "reserved_quantity")::int AS "available"
        FROM "stock_levels" WHERE "id" = ${level.id}::uuid FOR UPDATE`;
      const take = Math.min(needed, locked?.available ?? 0);
      if (take <= 0) continue;
      const after = await applyStockChange(tx, level.id, { reserved: take });
      if (!after) continue; // Cannot happen under the lock; kept as a guard.
      const reservation = await tx.stockReservation.create({
        data: {
          sellerId: variant.sellerId,
          variantId: variant.id,
          warehouseId: level.warehouseId,
          stockLevelId: level.id,
          quantity: take,
          checkoutReference,
          expiresAt,
        },
      });
      created.push(reservation.id);
      needed -= take;
    }
    if (needed > 0) {
      const available = quantity - needed;
      throw new InsufficientStockError(
        `Only ${available} of ${variant.sku} can be reserved right now.`,
        available,
      );
    }
    return created;
  }

  /** Gives back the stock of active reservations (by id or by checkout). Idempotent. */
  async release(where: { id?: string; checkoutReference?: string }): Promise<number> {
    const released = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ stockLevelId: string; quantity: number }[]>`
        UPDATE "stock_reservations"
        SET "status" = 'RELEASED', "released_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
        WHERE "status" = 'ACTIVE'
          AND (${where.id ?? null}::uuid IS NULL OR "id" = ${where.id ?? null}::uuid)
          AND (${where.checkoutReference ?? null}::text IS NULL OR "checkout_reference" = ${where.checkoutReference ?? null}::text)
        RETURNING "stock_level_id" AS "stockLevelId", "quantity"`;
      for (const row of rows)
        await applyStockChange(tx, row.stockLevelId, { reserved: -row.quantity });
      return rows;
    });
    await this.inventory.checkLowStock([...new Set(released.map((r) => r.stockLevelId))]);
    return released.length;
  }

  /**
   * The order reached fulfilment: the reserved units leave stock (SALE ledger row). Refused
   * when the reservation is no longer active (expired or released): stock may be gone.
   */
  async convert(id: string, actorId: string | null): Promise<ReservationDto> {
    const levelId = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({ where: { id } });
      if (!reservation)
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Reservation not found.');
      const { count } = await tx.stockReservation.updateMany({
        where: { id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
        data: { status: 'CONVERTED', convertedAt: new Date() },
      });
      if (count === 0) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'RESERVATION_NOT_ACTIVE',
          'This reservation has expired or was released; reserve the stock again.',
        );
      }
      const after = await applyStockChange(tx, reservation.stockLevelId, {
        onHand: -reservation.quantity,
        reserved: -reservation.quantity,
      });
      if (!after)
        throw new Error(
          `Stock level ${reservation.stockLevelId} is inconsistent with its reservations`,
        );
      await recordLedger(tx, {
        sellerId: reservation.sellerId,
        warehouseId: reservation.warehouseId,
        variantId: reservation.variantId,
        stockLevelId: reservation.stockLevelId,
        type: 'SALE',
        quantityChange: -reservation.quantity,
        after,
        reservationId: reservation.id,
        reason: reservation.orderItemId ? `Order item ${reservation.orderItemId}` : null,
        actorId,
      });
      return reservation.stockLevelId;
    });
    await this.inventory.checkLowStock([levelId]);
    return toDto(await this.prisma.stockReservation.findUniqueOrThrow({ where: { id }, include }));
  }

  /** Links reservations to the order item they hold stock for (next phase, at order creation). */
  async attachOrderItem(ids: string[], orderItemId: string): Promise<void> {
    await this.prisma.stockReservation.updateMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      data: { orderItemId },
    });
  }

  /** The periodic sweep (also run by the worker). */
  expireDue(now = new Date()): Promise<number> {
    return releaseExpiredReservations(this.prisma, { now });
  }

  async list(
    user: AuthenticatedUser,
    query: {
      page: number;
      pageSize: number;
      status?: z.infer<typeof reservationStatusSchema>;
      variantId?: string;
    },
  ): Promise<PaginatedResponse<ReservationDto>> {
    const { sellerId } = sellerScope(user);
    const where: Prisma.StockReservationWhereInput = {
      sellerId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.variantId ? { variantId: query.variantId } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.stockReservation.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.stockReservation.count({ where }),
    ]);
    return {
      items: rows.map(toDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}
