import type { Prisma, PrismaClient } from './generated/prisma/client';

type Tx = Prisma.TransactionClient;

export interface CancelledOrder {
  id: string;
  orderNumber: string;
  customerEmail: string;
  customerFirstName: string;
}

/**
 * Cancels an order and undoes everything placing it did, inside the caller's transaction:
 *
 *  - the order and its seller suborders become CANCELLED (unpaid payments are voided);
 *  - stock held for its items is given back (reservations RELEASED, reserved quantity down);
 *  - coupon redemptions are released (used_count down);
 *  - flash sale quantities and products' sold counts are given back;
 *  - an order event records why.
 *
 * Only orders in one of `fromStatuses` are cancelled (compare-and-set, so two cancellations
 * can never both succeed). Returns null when the order was not in such a status.
 */
export async function cancelOrderInTx(
  tx: Tx,
  input: {
    orderId: string;
    fromStatuses: ('AWAITING_PAYMENT' | 'PLACED')[];
    reason: string;
    eventType: 'CANCELLED_BY_CUSTOMER' | 'PAYMENT_EXPIRED';
    actorId: string | null;
    now?: Date;
  },
): Promise<CancelledOrder | null> {
  const now = input.now ?? new Date();
  const statuses = input.fromStatuses as string[];
  const updated = await tx.$queryRaw<{ id: string; order_number: string; customer_id: string }[]>`
    UPDATE "orders"
    SET "status" = 'CANCELLED',
        "payment_status" = CASE WHEN "payment_status" = 'PAID' THEN "payment_status" ELSE 'VOIDED' END,
        "cancelled_at" = ${now}, "cancel_reason" = ${input.reason},
        "cancelled_by_id" = ${input.actorId}::uuid, "updated_at" = ${now}
    WHERE "id" = ${input.orderId}::uuid AND "status"::text = ANY(${statuses}::text[])
    RETURNING "id", "order_number", "customer_id"`;
  const order = updated[0];
  if (!order) return null;

  await tx.sellerOrder.updateMany({
    where: { orderId: order.id },
    data: { status: 'CANCELLED', cancelledAt: now },
  });

  // Stock held for the order's items goes back, in one statement per stock row.
  await tx.$executeRaw`
    WITH released AS (
      UPDATE "stock_reservations" r
      SET "status" = 'RELEASED', "released_at" = ${now}, "updated_at" = ${now}
      FROM "order_items" i
      WHERE r."order_item_id" = i."id" AND i."order_id" = ${order.id}::uuid AND r."status" = 'ACTIVE'
      RETURNING r."stock_level_id", r."quantity"
    ),
    totals AS (
      SELECT "stock_level_id", SUM("quantity")::int AS "quantity" FROM released GROUP BY "stock_level_id"
    )
    UPDATE "stock_levels" s
    SET "reserved_quantity" = s."reserved_quantity" - totals."quantity", "updated_at" = ${now}
    FROM totals WHERE s."id" = totals."stock_level_id"`;

  await tx.$executeRaw`
    WITH released AS (
      UPDATE "coupon_redemptions" SET "released_at" = ${now}
      WHERE "order_id" = ${order.id}::uuid AND "released_at" IS NULL
      RETURNING "coupon_id"
    ),
    totals AS (SELECT "coupon_id", COUNT(*)::int AS "uses" FROM released GROUP BY "coupon_id")
    UPDATE "coupons" c SET "used_count" = c."used_count" - totals."uses", "updated_at" = ${now}
    FROM totals WHERE c."id" = totals."coupon_id"`;

  await tx.$executeRaw`
    WITH totals AS (
      SELECT "flash_sale_item_id" AS "id", SUM("quantity")::int AS "quantity"
      FROM "order_items" WHERE "order_id" = ${order.id}::uuid AND "flash_sale_item_id" IS NOT NULL
      GROUP BY "flash_sale_item_id"
    )
    UPDATE "flash_sale_items" f
    SET "sold_quantity" = GREATEST(f."sold_quantity" - totals."quantity", 0), "updated_at" = ${now}
    FROM totals WHERE f."id" = totals."id"`;

  await tx.$executeRaw`
    WITH totals AS (
      SELECT "product_id", SUM("quantity")::int AS "quantity"
      FROM "order_items" WHERE "order_id" = ${order.id}::uuid GROUP BY "product_id"
    )
    UPDATE "products" p SET "sold_count" = GREATEST(p."sold_count" - totals."quantity", 0)
    FROM totals WHERE p."id" = totals."product_id"`;

  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: input.eventType,
      note: input.reason,
      actorId: input.actorId,
      createdAt: now,
    },
  });

  const customer = await tx.user.findUniqueOrThrow({
    where: { id: order.customer_id },
    select: { email: true, firstName: true },
  });
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerEmail: customer.email,
    customerFirstName: customer.firstName,
  };
}

/**
 * Cancels orders still waiting for an online payment after their deadline. Each order is
 * cancelled in its own transaction; orders another process is handling are skipped and picked
 * up next time. Used by the worker's periodic sweep.
 */
export async function expireUnpaidOrders(
  db: Pick<PrismaClient, '$queryRaw' | '$transaction'>,
  options: { now?: Date; limit?: number } = {},
): Promise<CancelledOrder[]> {
  const now = options.now ?? new Date();
  const due = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "orders"
    WHERE "status" = 'AWAITING_PAYMENT' AND "payment_due_at" <= ${now}
    ORDER BY "payment_due_at" LIMIT ${options.limit ?? 100}::int`;
  const cancelled: CancelledOrder[] = [];
  for (const { id } of due) {
    const result = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "orders" WHERE "id" = ${id}::uuid AND "status" = 'AWAITING_PAYMENT'
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      return cancelOrderInTx(tx, {
        orderId: id,
        fromStatuses: ['AWAITING_PAYMENT'],
        reason: 'Payment was not received in time.',
        eventType: 'PAYMENT_EXPIRED',
        actorId: null,
        now,
      });
    });
    if (result) cancelled.push(result);
  }
  return cancelled;
}
