import { Prisma } from './generated/prisma/client';
import { postSellerEarningsInTx, transitionSellerOrderInTx } from './fulfilment';
import { postPaymentFeeInTx, postPaymentReceivedInTx } from './ledger';

type Tx = Prisma.TransactionClient;

/** Locks the order row (FOR UPDATE); every transaction changing an order takes it first. */
export async function lockOrderInTx(tx: Tx, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
}

async function lockOrderOfPaymentInTx(tx: Tx, paymentId: string): Promise<void> {
  const row = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
  if (row) await lockOrderInTx(tx, row.orderId);
}

/** How a payment came to be confirmed (kept in its history). */
export type PaymentConfirmationSource = 'WEBHOOK' | 'VERIFICATION' | 'RECONCILIATION' | 'FINANCE';

export type PaymentSucceededResult =
  /** The order is now paid. */
  | {
      result: 'PAID';
      orderId: string;
      paymentId: string;
      otherOpenAttempts: { provider: string; providerReference: string }[];
    }
  /** Nothing to do: this was already recorded (duplicate webhook, retry, double click). */
  | { result: 'ALREADY_PAID'; orderId: string; paymentId: string }
  /** Money arrived but cannot pay the order; finance must refund it (review reason set). */
  | {
      result: 'NEEDS_REVIEW';
      orderId: string;
      paymentId: string;
      reason: 'AMOUNT_MISMATCH' | 'LATE_PAYMENT' | 'DUPLICATE_PAYMENT';
    };

/**
 * Records that the provider (or finance) confirmed money for a payment attempt, inside the
 * caller's transaction. Safe to call any number of times for the same payment.
 *
 * The payment row and then the order row are locked, so a confirmation and the expiry sweep
 * (or two confirmations) never interleave. The order becomes paid only when:
 *  - the amount equals the attempt's amount (otherwise AMOUNT_MISMATCH for finance);
 *  - the order is still waiting for payment (otherwise LATE_PAYMENT: it expired or was
 *    cancelled; the money must be refunded);
 *  - no other attempt already paid it (otherwise DUPLICATE_PAYMENT).
 * Then the seller orders become New, stock holds stop expiring and seller earnings are posted.
 */
export async function applyPaymentSucceededInTx(
  tx: Tx,
  input: {
    paymentId: string;
    providerPaymentId: string | null;
    amount: string;
    source: PaymentConfirmationSource;
    webhookEventId?: string | null;
    actorId?: string | null;
    now?: Date;
  },
): Promise<PaymentSucceededResult> {
  const now = input.now ?? new Date();
  // Lock order: the order row first, then the payment (every order change does the same, so
  // a confirmation and a cancellation or expiry wait for each other instead of deadlocking).
  await lockOrderOfPaymentInTx(tx, input.paymentId);
  const [payment] = await tx.$queryRaw<
    { id: string; order_id: string; status: string; amount: Prisma.Decimal }[]
  >`
    SELECT "id", "order_id", "status"::text, "amount" FROM "payments" WHERE "id" = ${input.paymentId}::uuid FOR UPDATE`;
  if (!payment) throw new Error(`Payment ${input.paymentId} not found`);
  const base = { orderId: payment.order_id, paymentId: payment.id };
  const event = (type: string, data: Record<string, unknown>, toStatus?: 'PAID' | 'CANCELLED') =>
    tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        type,
        fromStatus: payment.status as 'PENDING',
        toStatus: toStatus ?? null,
        data: {
          source: input.source,
          providerPaymentId: input.providerPaymentId,
          amount: input.amount,
          ...data,
        } as Prisma.InputJsonValue,
        actorId: input.actorId ?? null,
        webhookEventId: input.webhookEventId ?? null,
        createdAt: now,
      },
    });

  if (payment.status === 'PAID') return { result: 'ALREADY_PAID', ...base };
  // Money already recorded on this attempt (late or duplicate payment under review).
  const existing = await tx.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: { amountReceived: true, reviewReason: true },
  });
  if (existing.amountReceived.gt(0)) return { result: 'ALREADY_PAID', ...base };

  const amount = new Prisma.Decimal(input.amount);
  if (!amount.eq(payment.amount)) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        reviewReason: 'AMOUNT_MISMATCH',
        failureMessage: `Provider reported ${amount.toFixed(2)}; expected ${payment.amount.toFixed(2)}.`,
      },
    });
    await event('AMOUNT_MISMATCH', { expected: payment.amount.toFixed(2) });
    return { result: 'NEEDS_REVIEW', ...base, reason: 'AMOUNT_MISMATCH' };
  }

  const [order] = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"::text FROM "orders" WHERE "id" = ${payment.order_id}::uuid FOR UPDATE`;
  const alreadyPaid = await tx.payment.count({
    where: { orderId: payment.order_id, status: 'PAID' },
  });
  if (order?.status !== 'AWAITING_PAYMENT' || alreadyPaid > 0) {
    const reason = alreadyPaid > 0 ? 'DUPLICATE_PAYMENT' : 'LATE_PAYMENT';
    // Recorded as received (so it can be refunded) but it does not pay the order.
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CANCELLED',
        amountReceived: amount,
        providerPaymentId: input.providerPaymentId,
        paidAt: now,
        reviewReason: reason,
      },
    });
    await event(reason, {}, 'CANCELLED');
    // The money is in the books (unallocated, in clearing) until finance refunds it.
    await postPaymentReceivedInTx(tx, payment.id, now);
    await postPaymentFeeInTx(tx, payment.id, now);
    return { result: 'NEEDS_REVIEW', ...base, reason };
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      amountReceived: amount,
      providerPaymentId: input.providerPaymentId,
      paidAt: now,
      failureCode: null,
      failureMessage: null,
    },
  });
  await event('PAID', {}, 'PAID');
  await postPaymentReceivedInTx(tx, payment.id, now);

  // Other open attempts of the same order can no longer be used.
  const others = await tx.payment.findMany({
    where: {
      orderId: payment.order_id,
      id: { not: payment.id },
      status: { in: ['CREATED', 'PENDING'] },
    },
    select: { id: true, provider: true, providerReference: true, status: true },
  });
  for (const other of others) {
    await tx.payment.update({ where: { id: other.id }, data: { status: 'CANCELLED' } });
    await tx.paymentEvent.create({
      data: {
        paymentId: other.id,
        type: 'CANCELLED',
        fromStatus: other.status,
        toStatus: 'CANCELLED',
        data: { reason: 'Another attempt paid the order.' },
        createdAt: now,
      },
    });
  }

  await tx.order.update({
    where: { id: payment.order_id },
    data: { status: 'PLACED', paymentStatus: 'PAID', paymentDueAt: null },
  });
  await tx.orderEvent.create({
    data: {
      orderId: payment.order_id,
      type: 'PAYMENT_RECEIVED',
      actorType: input.source === 'FINANCE' ? 'STAFF' : 'PROVIDER',
      actorId: input.actorId ?? null,
      note: `${amount.toFixed(2)} received`,
      createdAt: now,
    },
  });
  // Stock now stays held until the parcel ships or the order is cancelled.
  await tx.$executeRaw`
    UPDATE "stock_reservations" r SET "expires_at" = NULL, "updated_at" = ${now}
    FROM "order_items" i
    WHERE r."order_item_id" = i."id" AND i."order_id" = ${payment.order_id}::uuid AND r."status" = 'ACTIVE'`;
  const sellerOrders = await tx.sellerOrder.findMany({
    where: { orderId: payment.order_id, status: 'AWAITING_PAYMENT' },
    select: { id: true },
  });
  for (const so of sellerOrders) {
    await transitionSellerOrderInTx(tx, {
      sellerOrderId: so.id,
      to: 'PENDING',
      actor: input.source === 'FINANCE' ? 'STAFF' : 'PROVIDER',
      actorId: input.actorId ?? null,
      note: 'Payment received.',
      now,
    });
    await postSellerEarningsInTx(tx, so.id, now);
  }
  await postPaymentFeeInTx(tx, payment.id, now);
  return {
    result: 'PAID',
    ...base,
    otherOpenAttempts: others
      .filter((o) => o.providerReference !== null)
      .map((o) => ({ provider: o.provider, providerReference: o.providerReference! })),
  };
}

/**
 * Records a failed payment attempt. A final failure closes the attempt (the customer may
 * start another while the order still waits); a non-final one (the hosted checkout lets the
 * customer try again) only keeps the reason. Repeated failures are recorded once per event.
 */
export async function applyPaymentFailedInTx(
  tx: Tx,
  input: {
    paymentId: string;
    final: boolean;
    failureCode: string | null;
    failureMessage: string | null;
    webhookEventId?: string | null;
    now?: Date;
  },
): Promise<{ orderId: string; closed: boolean }> {
  const now = input.now ?? new Date();
  await lockOrderOfPaymentInTx(tx, input.paymentId);
  const [payment] = await tx.$queryRaw<{ id: string; order_id: string; status: string }[]>`
    SELECT "id", "order_id", "status"::text FROM "payments" WHERE "id" = ${input.paymentId}::uuid FOR UPDATE`;
  if (!payment) throw new Error(`Payment ${input.paymentId} not found`);
  const open = payment.status === 'CREATED' || payment.status === 'PENDING';
  const close = open && input.final;
  if (open) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        ...(close ? { status: 'FAILED' } : {}),
        failureCode: input.failureCode,
        failureMessage: input.failureMessage ?? 'The payment did not go through.',
      },
    });
  }
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      type: close ? 'FAILED' : 'ATTEMPT_FAILED',
      fromStatus: payment.status as 'PENDING',
      toStatus: close ? 'FAILED' : null,
      data: {
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        final: input.final,
      },
      webhookEventId: input.webhookEventId ?? null,
      createdAt: now,
    },
  });
  if (close) {
    await tx.orderEvent.create({
      data: {
        orderId: payment.order_id,
        type: 'PAYMENT_FAILED',
        actorType: 'PROVIDER',
        note: input.failureMessage ?? 'The payment did not go through.',
        createdAt: now,
      },
    });
  }
  return { orderId: payment.order_id, closed: close };
}

/**
 * The order's payment summary after refunds: REFUNDED when everything received went back,
 * PARTIALLY_REFUNDED when some did.
 */
export async function syncOrderPaymentStatusInTx(tx: Tx, orderId: string) {
  const payments = await tx.payment.findMany({
    where: { orderId },
    select: { status: true, amountReceived: true, refundedAmount: true, provider: true },
  });
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { paymentStatus: true },
  });
  const received = payments.reduce((s, p) => s.add(p.amountReceived), new Prisma.Decimal(0));
  const refunded = payments.reduce((s, p) => s.add(p.refundedAmount), new Prisma.Decimal(0));
  let next = order.paymentStatus as string;
  if (refunded.gt(0)) next = refunded.gte(received) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (next !== order.paymentStatus) {
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: next as 'REFUNDED' } });
  }
}
