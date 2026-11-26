import {
  FINAL_SELLER_ORDER_STATUSES,
  type OrderActor,
  type SellerOrderStatus,
} from '@marketplace/shared-types';
import { cancelSellerOrderInTx } from './fulfilment';
import type { Prisma, PrismaClient } from './generated/prisma/client';

type Tx = Prisma.TransactionClient;

export interface CancelledOrder {
  id: string;
  orderNumber: string;
  customerEmail: string;
  customerFirstName: string;
  /** Money was received: the caller must refund it. */
  moneyReceived: boolean;
  /** Provider checkouts to expire (best effort). */
  closedPayments: { provider: string; providerReference: string }[];
}

/**
 * Cancels a whole order inside the caller's transaction:
 *
 *  - every seller order that is not final is cancelled through the state machine (so a seller
 *    order the seller already started makes the whole cancellation fail), giving back its
 *    stock, flash sale units, sold counts and seller coupon use;
 *  - the remaining (marketplace) coupon uses are released;
 *  - open payment attempts are closed (EXPIRED or CANCELLED); the caller expires them at the
 *    provider with the returned references;
 *  - the order becomes CANCELLED with the reason (payment VOIDED unless money was received:
 *    then the caller refunds it).
 *
 * Only orders in one of `fromStatuses` are cancelled; the order row is locked first, so two
 * cancellations (or a cancellation and a payment) never interleave. Returns null when the order
 * was not in such a status.
 */
export async function cancelOrderInTx(
  tx: Tx,
  input: {
    orderId: string;
    fromStatuses: ('AWAITING_PAYMENT' | 'PLACED')[];
    reason: string;
    eventType: 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_STAFF' | 'PAYMENT_EXPIRED';
    actorId: string | null;
    now?: Date;
  },
): Promise<CancelledOrder | null> {
  const now = input.now ?? new Date();
  const statuses = input.fromStatuses as string[];
  const locked = await tx.$queryRaw<
    { id: string; order_number: string; customer_id: string; payment_status: string }[]
  >`
    SELECT "id", "order_number", "customer_id", "payment_status"::text FROM "orders"
    WHERE "id" = ${input.orderId}::uuid AND "status"::text = ANY(${statuses}::text[])
    FOR UPDATE`;
  const order = locked[0];
  if (!order) return null;
  const actor: OrderActor =
    input.eventType === 'PAYMENT_EXPIRED'
      ? 'SYSTEM'
      : input.eventType === 'CANCELLED_BY_STAFF'
        ? 'STAFF'
        : 'CUSTOMER';

  const sellerOrders = await tx.sellerOrder.findMany({
    where: { orderId: order.id },
    select: { id: true, status: true },
    orderBy: { number: 'asc' },
  });
  for (const so of sellerOrders) {
    if (FINAL_SELLER_ORDER_STATUSES.includes(so.status as SellerOrderStatus)) continue;
    await cancelSellerOrderInTx(tx, {
      sellerOrderId: so.id,
      actor,
      actorId: input.actorId,
      reason: input.reason,
      eventType: input.eventType,
      now,
    });
  }

  await tx.$executeRaw`
    WITH released AS (
      UPDATE "coupon_redemptions" SET "released_at" = ${now}
      WHERE "order_id" = ${order.id}::uuid AND "released_at" IS NULL
      RETURNING "coupon_id"
    ),
    totals AS (SELECT "coupon_id", COUNT(*)::int AS "uses" FROM released GROUP BY "coupon_id")
    UPDATE "coupons" c SET "used_count" = c."used_count" - totals."uses", "updated_at" = ${now}
    FROM totals WHERE c."id" = totals."coupon_id"`;

  const closed = await tx.payment.findMany({
    where: { orderId: order.id, status: { in: ['CREATED', 'PENDING'] } },
    select: { id: true, provider: true, providerReference: true, status: true },
  });
  const closedStatus = input.eventType === 'PAYMENT_EXPIRED' ? 'EXPIRED' : 'CANCELLED';
  for (const p of closed) {
    await tx.payment.update({ where: { id: p.id }, data: { status: closedStatus } });
    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        type: closedStatus,
        fromStatus: p.status,
        toStatus: closedStatus,
        data: { reason: input.reason },
        actorId: input.actorId,
        createdAt: now,
      },
    });
  }

  const moneyReceived = ['PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'].includes(
    order.payment_status,
  );
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'CANCELLED',
      ...(moneyReceived ? {} : { paymentStatus: 'VOIDED' }),
      paymentDueAt: null,
      cancelledAt: now,
      cancelReason: input.reason,
      cancelledById: input.actorId,
    },
  });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: input.eventType,
      actorType: actor,
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
    moneyReceived,
    closedPayments: closed
      .filter((p) => p.providerReference !== null)
      .map((p) => ({ provider: p.provider, providerReference: p.providerReference! })),
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
      AND NOT EXISTS (
        SELECT 1 FROM "bank_transfer_proofs" bp JOIN "payments" p ON p."id" = bp."payment_id"
        WHERE p."order_id" = "orders"."id" AND bp."status" = 'SUBMITTED')
    ORDER BY "payment_due_at" LIMIT ${options.limit ?? 100}::int`;
  const cancelled: CancelledOrder[] = [];
  for (const { id } of due) {
    const result = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "orders" WHERE "id" = ${id}::uuid AND "status" = 'AWAITING_PAYMENT'
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      // A payment recorded meanwhile wins: only orders with no paid attempt expire.
      const paid = await tx.payment.count({ where: { orderId: id, status: 'PAID' } });
      if (paid > 0) return null;
      // A bank transfer proof waiting for finance keeps the order open until it is reviewed.
      const proofs = await tx.bankTransferProof.count({
        where: { payment: { orderId: id }, status: 'SUBMITTED' },
      });
      if (proofs > 0) return null;
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
