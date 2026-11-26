import type { Prisma } from '@marketplace/database';
import { applyStockChange, recordLedger } from '../inventory/stock-ledger';

type Tx = Prisma.TransactionClient;

/**
 * The parcel left the warehouse: the seller order's held units leave stock (SALE rows in the
 * inventory ledger). Runs once: only ACTIVE reservations are converted.
 * Returns the stock levels changed (for low-stock alerts after commit).
 */
export async function convertSellerOrderStockInTx(
  tx: Tx,
  sellerOrderId: string,
  actorId: string | null,
): Promise<string[]> {
  const reservations = await tx.stockReservation.findMany({
    where: { status: 'ACTIVE', orderItem: { sellerOrderId } },
  });
  const now = new Date();
  for (const r of reservations) {
    const { count } = await tx.stockReservation.updateMany({
      where: { id: r.id, status: 'ACTIVE' },
      data: { status: 'CONVERTED', convertedAt: now },
    });
    if (count === 0) continue;
    const after = await applyStockChange(tx, r.stockLevelId, {
      onHand: -r.quantity,
      reserved: -r.quantity,
    });
    if (!after)
      throw new Error(`Stock level ${r.stockLevelId} is inconsistent with its reservations`);
    await recordLedger(tx, {
      sellerId: r.sellerId,
      warehouseId: r.warehouseId,
      variantId: r.variantId,
      stockLevelId: r.stockLevelId,
      type: 'SALE',
      quantityChange: -r.quantity,
      after,
      reservationId: r.id,
      reason: `Shipped (order item ${r.orderItemId})`,
      actorId,
    });
  }
  return [...new Set(reservations.map((r) => r.stockLevelId))];
}

/**
 * Units that came back to the seller (a parcel returned undelivered, or a customer return):
 * back into sellable stock (RETURN_RESTOCK) or counted as damaged (RETURN_DAMAGED), in the
 * warehouse they were shipped from.
 */
export async function restockItemsInTx(
  tx: Tx,
  items: { orderItemId: string; quantity: number }[],
  sellable: boolean,
  reason: string,
  actorId: string | null,
): Promise<void> {
  for (const item of items) {
    if (item.quantity <= 0) continue;
    const shipped = await tx.stockReservation.findFirst({
      where: { orderItemId: item.orderItemId, status: 'CONVERTED' },
      orderBy: { convertedAt: 'desc' },
    });
    // Never shipped from tracked stock (e.g. cancelled before pickup): nothing to put back.
    if (!shipped) continue;
    const after = await applyStockChange(
      tx,
      shipped.stockLevelId,
      sellable ? { onHand: item.quantity } : { damaged: item.quantity },
    );
    if (!after) throw new Error(`Could not restock level ${shipped.stockLevelId}`);
    await recordLedger(tx, {
      sellerId: shipped.sellerId,
      warehouseId: shipped.warehouseId,
      variantId: shipped.variantId,
      stockLevelId: shipped.stockLevelId,
      type: sellable ? 'RETURN_RESTOCK' : 'RETURN_DAMAGED',
      quantityChange: sellable ? item.quantity : 0,
      damagedChange: sellable ? 0 : item.quantity,
      after,
      reason,
      actorId,
    });
  }
}
