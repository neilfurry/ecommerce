import {
  canTransition,
  FINAL_SELLER_ORDER_STATUSES,
  type OrderActor,
  type SellerOrderStatus,
} from '@marketplace/shared-types';
import { postSaleInTx, postShippingCreditIfDueInTx } from './ledger';
import { type Prisma } from './generated/prisma/client';

type Tx = Prisma.TransactionClient;
type EventType = Prisma.OrderEventCreateInput['type'];

/** The move is not allowed by the state machine for this actor. */
export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(
    readonly from: SellerOrderStatus,
    readonly to: SellerOrderStatus,
    readonly actor: OrderActor,
  ) {
    super(`A seller order cannot go from ${from} to ${to} (${actor.toLowerCase()}).`);
  }
}

/** Someone else changed the seller order first; reload and try again. */
export class ConcurrentUpdateError extends Error {
  readonly code = 'CONFLICT';
  constructor() {
    super('This order was just updated by someone else. Reload it and try again.');
  }
}

export interface TransitionInput {
  sellerOrderId: string;
  to: SellerOrderStatus;
  actor: OrderActor;
  actorId: string | null;
  /** When given, the transition only happens from these statuses (stale screens fail). */
  expectedFrom?: SellerOrderStatus[];
  note?: string | null;
  eventType?: EventType;
  /** Days customers may ask for a return after delivery (settings). */
  returnWindowDays?: number;
  cancelReason?: string;
  now?: Date;
}

export interface TransitionResult {
  sellerOrderId: string;
  orderId: string;
  sellerId: string;
  from: SellerOrderStatus;
  to: SellerOrderStatus;
  orderStatus: string;
}

/**
 * Moves a seller order to another status after checking the state machine (shared-types
 * SELLER_ORDER_TRANSITIONS) and records the change in the order history.
 *
 * Compare-and-set: the UPDATE only matches the status that was read, so of two concurrent
 * changes exactly one succeeds and the other gets ConcurrentUpdateError. The parent order's
 * status is then derived from its seller orders.
 */
export async function transitionSellerOrderInTx(
  tx: Tx,
  input: TransitionInput,
): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  const current = await tx.sellerOrder.findUnique({
    where: { id: input.sellerOrderId },
    select: { status: true, orderId: true, sellerId: true, shippedAt: true },
  });
  if (!current) throw new Error(`Seller order ${input.sellerOrderId} not found`);
  const from = current.status as SellerOrderStatus;
  if (input.expectedFrom && !input.expectedFrom.includes(from)) throw new ConcurrentUpdateError();
  if (!canTransition(from, input.to, input.actor)) {
    throw new InvalidTransitionError(from, input.to, input.actor);
  }

  const data: Prisma.SellerOrderUpdateManyMutationInput = { status: input.to };
  if (input.to === 'PROCESSING' && from === 'PENDING') data.acceptedAt = now;
  if (input.to === 'SHIPPED' && !current.shippedAt) data.shippedAt = now;
  if (input.to === 'DELIVERED') {
    data.deliveredAt = now;
    data.returnWindowEndsAt = new Date(now.getTime() + (input.returnWindowDays ?? 7) * 86_400_000);
  }
  if (input.to === 'COMPLETED') data.completedAt = now;
  if (input.to === 'CANCELLED') {
    data.cancelledAt = now;
    data.cancelReason = input.cancelReason ?? input.note ?? null;
  }
  const { count } = await tx.sellerOrder.updateMany({
    where: { id: input.sellerOrderId, status: current.status },
    data,
  });
  if (count === 0) throw new ConcurrentUpdateError();

  await tx.orderEvent.create({
    data: {
      orderId: current.orderId,
      sellerOrderId: input.sellerOrderId,
      type: input.eventType ?? 'STATUS_CHANGED',
      fromStatus: from,
      toStatus: input.to,
      actorType: input.actor,
      actorId: input.actorId,
      note: input.note ?? null,
      createdAt: now,
    },
  });
  const orderStatus = await syncOrderStatusInTx(tx, current.orderId, now);
  return {
    sellerOrderId: input.sellerOrderId,
    orderId: current.orderId,
    sellerId: current.sellerId,
    from,
    to: input.to,
    orderStatus,
  };
}

/**
 * The parent order follows its seller orders: CANCELLED when none of them can be delivered
 * any more (all cancelled or returned), COMPLETED when all are final and at least one was
 * completed, otherwise unchanged (AWAITING_PAYMENT or PLACED).
 */
export async function syncOrderStatusInTx(tx: Tx, orderId: string, now = new Date()) {
  const [order, sellerOrders] = await Promise.all([
    tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } }),
    tx.sellerOrder.findMany({ where: { orderId }, select: { status: true } }),
  ]);
  const statuses = sellerOrders.map((s) => s.status as SellerOrderStatus);
  const allFinal = statuses.every((s) => FINAL_SELLER_ORDER_STATUSES.includes(s));
  let next = order.status as string;
  if (allFinal) next = statuses.includes('COMPLETED') ? 'COMPLETED' : 'CANCELLED';
  else if (order.status === 'COMPLETED' || order.status === 'CANCELLED') next = 'PLACED';
  if (next !== order.status) {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: next as 'COMPLETED' | 'CANCELLED' | 'PLACED',
        ...(next === 'CANCELLED' ? { cancelledAt: now } : {}),
      },
    });
  }
  return next;
}

/**
 * Cancels one seller order and gives back what its items held: stock reservations, flash
 * sale units, products' sold counts and the seller's own coupon use. A cash-on-delivery
 * collection that was not collected is closed. Refunding money already paid is the caller's
 * next step (refund service), outside this transaction's database work.
 */
export async function cancelSellerOrderInTx(
  tx: Tx,
  input: {
    sellerOrderId: string;
    actor: OrderActor;
    actorId: string | null;
    reason: string;
    eventType:
      | 'CANCELLED_BY_CUSTOMER'
      | 'CANCELLED_BY_SELLER'
      | 'CANCELLED_BY_STAFF'
      | 'PAYMENT_EXPIRED'
      | 'CANCELLATION_APPROVED';
    expectedFrom?: SellerOrderStatus[];
    now?: Date;
  },
): Promise<TransitionResult> {
  const now = input.now ?? new Date();
  const result = await transitionSellerOrderInTx(tx, {
    sellerOrderId: input.sellerOrderId,
    to: 'CANCELLED',
    actor: input.actor,
    actorId: input.actorId,
    expectedFrom: input.expectedFrom,
    note: input.reason,
    cancelReason: input.reason,
    eventType: input.eventType,
    now,
  });
  await releaseSellerOrderHoldsInTx(tx, input.sellerOrderId, result.sellerId, now);
  await tx.codCollection.updateMany({
    where: { sellerOrderId: input.sellerOrderId, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
  return result;
}

async function releaseSellerOrderHoldsInTx(
  tx: Tx,
  sellerOrderId: string,
  sellerId: string,
  now: Date,
) {
  await tx.$executeRaw`
    WITH released AS (
      UPDATE "stock_reservations" r
      SET "status" = 'RELEASED', "released_at" = ${now}, "updated_at" = ${now}
      FROM "order_items" i
      WHERE r."order_item_id" = i."id" AND i."seller_order_id" = ${sellerOrderId}::uuid AND r."status" = 'ACTIVE'
      RETURNING r."stock_level_id", r."quantity"
    ),
    totals AS (
      SELECT "stock_level_id", SUM("quantity")::int AS "quantity" FROM released GROUP BY "stock_level_id"
    )
    UPDATE "stock_levels" s
    SET "reserved_quantity" = s."reserved_quantity" - totals."quantity", "updated_at" = ${now}
    FROM totals WHERE s."id" = totals."stock_level_id"`;
  await tx.$executeRaw`
    WITH totals AS (
      SELECT "flash_sale_item_id" AS "id", SUM("quantity")::int AS "quantity"
      FROM "order_items" WHERE "seller_order_id" = ${sellerOrderId}::uuid AND "flash_sale_item_id" IS NOT NULL
      GROUP BY "flash_sale_item_id"
    )
    UPDATE "flash_sale_items" f
    SET "sold_quantity" = GREATEST(f."sold_quantity" - totals."quantity", 0), "updated_at" = ${now}
    FROM totals WHERE f."id" = totals."id"`;
  await tx.$executeRaw`
    WITH totals AS (
      SELECT "product_id", SUM("quantity")::int AS "quantity"
      FROM "order_items" WHERE "seller_order_id" = ${sellerOrderId}::uuid GROUP BY "product_id"
    )
    UPDATE "products" p SET "sold_count" = GREATEST(p."sold_count" - totals."quantity", 0)
    FROM totals WHERE p."id" = totals."product_id"`;
  // The seller's own coupon use on this order is given back.
  await tx.$executeRaw`
    WITH released AS (
      UPDATE "coupon_redemptions" r SET "released_at" = ${now}
      FROM "coupons" c, "seller_orders" so
      WHERE r."coupon_id" = c."id" AND so."id" = ${sellerOrderId}::uuid AND r."order_id" = so."order_id"
        AND c."seller_id" = ${sellerId}::uuid AND r."released_at" IS NULL
      RETURNING r."coupon_id"
    ),
    totals AS (SELECT "coupon_id", COUNT(*)::int AS "uses" FROM released GROUP BY "coupon_id")
    UPDATE "coupons" c SET "used_count" = c."used_count" - totals."uses", "updated_at" = ${now}
    FROM totals WHERE c."id" = totals."coupon_id"`;
}

// ---- Seller payables -------------------------------------------------------------------------

/**
 * The seller earned this seller order, posted once in the double-entry ledger (Phase 6) when
 * the money is financially received: online payment, bank transfer approval, or the
 * cash-on-delivery remittance. See `postSaleInTx`.
 */
export async function postSellerEarningsInTx(tx: Tx, sellerOrderId: string, now = new Date()) {
  await postSaleInTx(tx, sellerOrderId, now);
}

export { postShippingCreditIfDueInTx };

// ---- Periodic jobs ---------------------------------------------------------------------------

/**
 * Delivered seller orders whose return window has ended, with no return being worked on,
 * become COMPLETED. Each in its own transaction; returns how many were completed.
 */
export async function completeDeliveredSellerOrders(
  db: { $queryRaw: Tx['$queryRaw']; $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> },
  options: { now?: Date; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await db.$queryRaw<{ id: string }[]>`
    SELECT so."id" FROM "seller_orders" so
    WHERE so."status" = 'DELIVERED' AND so."return_window_ends_at" <= ${now}
      AND NOT EXISTS (
        SELECT 1 FROM "return_requests" r WHERE r."seller_order_id" = so."id"
          AND r."status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'ESCALATED', 'RETURN_SHIPPED', 'RECEIVED')
      )
    ORDER BY so."return_window_ends_at" LIMIT ${options.limit ?? 200}::int`;
  let completed = 0;
  for (const { id } of due) {
    try {
      await db.$transaction((tx) =>
        transitionSellerOrderInTx(tx, {
          sellerOrderId: id,
          to: 'COMPLETED',
          actor: 'SYSTEM',
          actorId: null,
          expectedFrom: ['DELIVERED'],
          note: 'Return window ended.',
          now,
        }),
      );
      completed += 1;
    } catch (error) {
      // Someone changed it meanwhile (e.g. a return was just requested): skip.
      if (!(error instanceof ConcurrentUpdateError)) throw error;
    }
  }
  return completed;
}

/** Return requests the seller did not answer in time go to the marketplace. */
export async function escalateOverdueReturns(
  db: {
    returnRequest: Tx['returnRequest'];
    orderEvent: Tx['orderEvent'];
    $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  },
  options: { now?: Date; limit?: number } = {},
): Promise<string[]> {
  const now = options.now ?? new Date();
  const overdue = await db.returnRequest.findMany({
    where: { status: 'REQUESTED', sellerDeadline: { lte: now } },
    select: { id: true },
    take: options.limit ?? 200,
  });
  const escalated: string[] = [];
  for (const { id } of overdue) {
    const done = await db.$transaction(async (tx) => {
      const { count } = await tx.returnRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status: 'ESCALATED',
          escalatedAt: now,
          escalationNote: 'The seller did not answer in time.',
        },
      });
      if (count === 0) return false;
      const r = await tx.returnRequest.findUniqueOrThrow({
        where: { id },
        select: { orderId: true, sellerOrderId: true, number: true },
      });
      await tx.orderEvent.create({
        data: {
          orderId: r.orderId,
          sellerOrderId: r.sellerOrderId,
          type: 'RETURN_UPDATED',
          actorType: 'SYSTEM',
          note: `Return ${r.number} went to the marketplace: the seller did not answer in time.`,
          createdAt: now,
        },
      });
      return true;
    });
    if (done) escalated.push(id);
  }
  return escalated;
}
