import { HttpStatus } from '@nestjs/common';
import { type InventoryMovementType, Prisma } from '@marketplace/database';
import { ApiException } from '../../common/errors/api.exception';

type Tx = Prisma.TransactionClient;

export interface StockDelta {
  onHand?: number;
  reserved?: number;
  damaged?: number;
}

export interface StockAfter {
  id: string;
  onHand: number;
  reserved: number;
  damaged: number;
  threshold: number | null;
  notifiedAt: Date | null;
}

export class InsufficientStockError extends ApiException {
  constructor(message: string, available: number) {
    super(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', message, [
      { path: 'quantity', message: `Only ${available} available` },
    ]);
  }
}

/** The stock level row for a variant in a warehouse, created at zero when missing. */
export async function ensureStockLevel(
  tx: Tx,
  sellerId: string,
  warehouseId: string,
  variantId: string,
) {
  return tx.stockLevel.upsert({
    where: { warehouseId_variantId: { warehouseId, variantId } },
    create: { sellerId, warehouseId, variantId },
    update: {},
  });
}

/**
 * Applies a change to one stock level in a single guarded UPDATE. PostgreSQL locks the row and
 * re-checks the condition after any concurrent update commits, so two transactions can never
 * both take the last units: available (on hand − reserved) and every quantity stay ≥ 0.
 * Returns null when the change would break that rule (nothing is changed then).
 */
export async function applyStockChange(
  tx: Tx,
  stockLevelId: string,
  delta: StockDelta,
): Promise<StockAfter | null> {
  const dOn = delta.onHand ?? 0;
  const dRes = delta.reserved ?? 0;
  const dDam = delta.damaged ?? 0;
  const rows = await tx.$queryRaw<StockAfter[]>`
    UPDATE "stock_levels"
    SET "quantity_on_hand" = "quantity_on_hand" + ${dOn}::int,
        "reserved_quantity" = "reserved_quantity" + ${dRes}::int,
        "damaged_quantity" = "damaged_quantity" + ${dDam}::int,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${stockLevelId}::uuid
      AND "reserved_quantity" + ${dRes}::int >= 0
      AND "damaged_quantity" + ${dDam}::int >= 0
      AND ("quantity_on_hand" + ${dOn}::int) - ("reserved_quantity" + ${dRes}::int) >= 0
    RETURNING "id",
              "quantity_on_hand" AS "onHand",
              "reserved_quantity" AS "reserved",
              "damaged_quantity" AS "damaged",
              "low_stock_threshold" AS "threshold",
              "low_stock_notified_at" AS "notifiedAt"`;
  return rows[0] ?? null;
}

/** Appends a ledger row describing a change and its result. */
export function recordLedger(
  tx: Tx,
  entry: {
    sellerId: string;
    warehouseId: string;
    variantId: string;
    stockLevelId: string;
    type: InventoryMovementType;
    quantityChange: number;
    damagedChange?: number;
    after: StockAfter;
    reason?: string | null;
    transferId?: string | null;
    reservationId?: string | null;
    actorId?: string | null;
  },
) {
  return tx.inventoryMovement.create({
    data: {
      sellerId: entry.sellerId,
      warehouseId: entry.warehouseId,
      variantId: entry.variantId,
      stockLevelId: entry.stockLevelId,
      type: entry.type,
      quantityChange: entry.quantityChange,
      damagedChange: entry.damagedChange ?? 0,
      onHandAfter: entry.after.onHand,
      reservedAfter: entry.after.reserved,
      damagedAfter: entry.after.damaged,
      reason: entry.reason ?? null,
      transferId: entry.transferId ?? null,
      reservationId: entry.reservationId ?? null,
      actorId: entry.actorId ?? null,
    },
  });
}

/** How each manual movement type changes on-hand and damaged stock, for `units` (> 0; signed for ADJUSTMENT). */
export function manualDelta(
  type: InventoryMovementType,
  units: number,
): { onHand: number; damaged: number } {
  switch (type) {
    case 'STOCK_IN':
    case 'RETURN_RESTOCK':
      return { onHand: units, damaged: 0 };
    case 'STOCK_OUT':
      return { onHand: -units, damaged: 0 };
    case 'ADJUSTMENT':
      return { onHand: units, damaged: 0 };
    case 'DAMAGED':
      return { onHand: -units, damaged: units };
    case 'DAMAGED_WRITE_OFF':
      return { onHand: 0, damaged: -units };
    case 'RETURN_DAMAGED':
      return { onHand: 0, damaged: units };
    default:
      throw new Error(`${type} is not a manual movement`);
  }
}

/** Retries a transaction once when two first-time stock level inserts race (unique violation). */
export async function withUniqueRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return run();
    throw error;
  }
}
