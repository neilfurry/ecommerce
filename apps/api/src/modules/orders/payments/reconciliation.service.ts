import { Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { Reconciliation } from '@marketplace/validation';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const m = (d: Prisma.Decimal | null | undefined) => (d ?? new Prisma.Decimal(0)).toFixed(2);
/** Manila dates → the UTC instants that bound them. */
const startOf = (date: string) => new Date(`${date}T00:00:00+08:00`);
const endOf = (date: string) => new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86_400_000);

/**
 * The finance reconciliation view: money received and refunded per method and provider in a
 * period, cash on delivery still with couriers, and every exception that needs a person
 * (unexplained money, stuck refunds, failed webhooks, totals that do not add up).
 * Test (mock or sandbox) money is reported separately (livemode) and is never real.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from: string, to: string): Promise<Reconciliation> {
    const start = startOf(from);
    const end = endOf(to);
    const byMethod = await this.prisma.$queryRaw<
      {
        method: string;
        provider: string;
        livemode: boolean;
        payments: number;
        received: Prisma.Decimal;
        refunded: Prisma.Decimal;
      }[]
    >`
      SELECT p."method"::text, p."provider"::text, p."livemode",
             COUNT(*)::int AS "payments",
             COALESCE(SUM(p."amount_received"), 0) AS "received",
             COALESCE((SELECT SUM(r."amount") FROM "refunds" r JOIN "payments" p2 ON p2."id" = r."payment_id"
                       WHERE r."status" = 'SUCCEEDED' AND p2."method" = p."method" AND p2."provider" = p."provider"
                         AND p2."livemode" = p."livemode"
                         AND r."succeeded_at" >= ${start} AND r."succeeded_at" < ${end}), 0) AS "refunded"
      FROM "payments" p
      WHERE p."amount_received" > 0 AND p."paid_at" >= ${start} AND p."paid_at" < ${end}
      GROUP BY p."method", p."provider", p."livemode"
      ORDER BY p."livemode" DESC, p."method", p."provider"`;

    const cod = await this.prisma.codCollection.groupBy({
      by: ['status'],
      _count: { _all: true },
      _sum: { expectedAmount: true, collectedAmount: true },
    });
    const codOf = (status: string) => cod.find((c) => c.status === status);
    const remitted = await this.prisma.codRemittance.aggregate({
      where: { remittedAt: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    const discrepancies = await this.prisma.codRemittance.count({
      where: { discrepancyNote: { not: null }, remittedAt: { gte: start, lt: end } },
    });

    const exceptions: Reconciliation['exceptions'] = [];
    const push = (
      e: Partial<Reconciliation['exceptions'][number]> & { kind: string; message: string },
    ) =>
      exceptions.push({
        orderId: null,
        orderNumber: null,
        paymentId: null,
        refundId: null,
        amount: null,
        ...e,
      });

    const review = await this.prisma.payment.findMany({
      where: { reviewReason: { not: null }, reviewedAt: null },
      include: { order: { select: { id: true, orderNumber: true } } },
      take: 200,
    });
    for (const p of review) {
      const outstanding = p.amountReceived.sub(p.refundedAmount);
      push({
        kind: p.reviewReason!,
        message:
          p.reviewReason === 'AMOUNT_MISMATCH'
            ? `Payment ${p.reference}: the provider reported a different amount (${p.failureMessage ?? ''}).`
            : `Payment ${p.reference}: ₱${outstanding.toFixed(2)} received that does not pay an open order; refund it.`,
        orderId: p.order.id,
        orderNumber: p.order.orderNumber,
        paymentId: p.id,
        amount: m(outstanding),
      });
    }

    // Cancelled orders still holding customer money.
    const unrefunded = await this.prisma.$queryRaw<
      { id: string; order_number: string; held: Prisma.Decimal }[]
    >`
      SELECT o."id", o."order_number", SUM(p."amount_received" - p."refunded_amount") AS "held"
      FROM "orders" o JOIN "payments" p ON p."order_id" = o."id"
      WHERE o."status" = 'CANCELLED' AND p."review_reason" IS NULL
      GROUP BY o."id", o."order_number"
      HAVING SUM(p."amount_received" - p."refunded_amount") > 0
      LIMIT 200`;
    for (const o of unrefunded) {
      push({
        kind: 'CANCELLED_NOT_REFUNDED',
        message: `Order ${o.order_number} is cancelled but ₱${m(o.held)} has not been refunded.`,
        orderId: o.id,
        orderNumber: o.order_number,
        amount: m(o.held),
      });
    }

    const stale = new Date(Date.now() - 24 * 3_600_000);
    const refunds = await this.prisma.refund.findMany({
      where: {
        OR: [
          {
            status: 'FAILED',
            order: {
              refunds: { none: { status: { in: ['PROCESSING', 'AWAITING_PAYOUT', 'SUCCEEDED'] } } },
            },
          },
          { status: { in: ['PROCESSING', 'AWAITING_PAYOUT'] }, createdAt: { lt: stale } },
        ],
      },
      include: { order: { select: { id: true, orderNumber: true } } },
      take: 200,
    });
    for (const r of refunds) {
      push({
        kind: r.status === 'FAILED' ? 'REFUND_FAILED' : 'REFUND_STUCK',
        message:
          r.status === 'FAILED'
            ? `Refund ${r.reference} failed: ${r.failureMessage ?? 'no reason given'}.`
            : `Refund ${r.reference} has been ${r.status === 'AWAITING_PAYOUT' ? 'waiting for payout' : 'processing'} for over a day.`,
        orderId: r.order.id,
        orderNumber: r.order.orderNumber,
        refundId: r.id,
        amount: m(r.amount),
      });
    }

    const failedEvents = await this.prisma.webhookEvent.count({ where: { status: 'FAILED' } });
    if (failedEvents > 0) {
      push({
        kind: 'WEBHOOK_FAILED',
        message: `${failedEvents} provider event(s) failed to process; reprocess them.`,
      });
    }

    // Online checkouts left open long after their deadline (missed webhook?).
    const open = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        provider: { in: ['MOCK', 'PAYMONGO'] },
        expiresAt: { lt: new Date(Date.now() - 3_600_000) },
      },
      include: { order: { select: { id: true, orderNumber: true } } },
      take: 200,
    });
    for (const p of open) {
      push({
        kind: 'CHECKOUT_UNRESOLVED',
        message: `Payment ${p.reference} is still open at the provider after its deadline; verify it.`,
        orderId: p.order.id,
        orderNumber: p.order.orderNumber,
        paymentId: p.id,
        amount: m(p.amount),
      });
    }

    // Paid orders whose received money does not match the order total.
    const mismatched = await this.prisma.$queryRaw<
      { id: string; order_number: string; grand_total: Prisma.Decimal; received: Prisma.Decimal }[]
    >`
      SELECT o."id", o."order_number", o."grand_total", SUM(p."amount_received") AS "received"
      FROM "orders" o JOIN "payments" p ON p."order_id" = o."id" AND p."status" = 'PAID'
      WHERE o."payment_method" <> 'COD'
      GROUP BY o."id", o."order_number", o."grand_total"
      HAVING SUM(p."amount_received") <> o."grand_total"
      LIMIT 200`;
    for (const o of mismatched) {
      push({
        kind: 'TOTAL_MISMATCH',
        message: `Order ${o.order_number}: received ₱${m(o.received)} for a total of ₱${m(o.grand_total)}.`,
        orderId: o.id,
        orderNumber: o.order_number,
        amount: m(o.received),
      });
    }

    return {
      from,
      to,
      byMethod: byMethod.map((r) => {
        const received = new Prisma.Decimal(r.received);
        const refunded = new Prisma.Decimal(r.refunded);
        return {
          method: r.method as Reconciliation['byMethod'][number]['method'],
          provider: r.provider as Reconciliation['byMethod'][number]['provider'],
          livemode: r.livemode,
          payments: r.payments,
          received: received.toFixed(2),
          refunded: refunded.toFixed(2),
          net: received.sub(refunded).toFixed(2),
        };
      }),
      cod: {
        pendingCount: codOf('PENDING')?._count._all ?? 0,
        pendingAmount: m(codOf('PENDING')?._sum.expectedAmount),
        collectedNotRemittedCount: codOf('COLLECTED')?._count._all ?? 0,
        collectedNotRemittedAmount: m(codOf('COLLECTED')?._sum.collectedAmount),
        remittedAmount: m(remitted._sum.amount),
        discrepancies,
      },
      exceptions,
    };
  }
}
