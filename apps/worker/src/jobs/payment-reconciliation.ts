import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  EMAIL_JOBS,
  PAYMENT_JOBS,
  PAYMENT_RECONCILIATION_INTERVAL_SECONDS,
  PAYMENT_RECONCILIATION_SCHEDULER_ID,
  QUEUE_NAMES,
} from '@marketplace/config';
import {
  applyPaymentFailedInTx,
  applyPaymentSucceededInTx,
  type PrismaClient,
} from '@marketplace/database';
import {
  MockGateway,
  type MockSessionStore,
  type PaymentGateway,
  PayMongoGateway,
} from '@marketplace/payments';
import type { OrderUpdateJob } from '@marketplace/validation';
import type { Queue } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../database/database.provider';
import type { JobHandler } from '../queues/job-handler';

/**
 * Asks payment providers about online payments still open on our side: a webhook can be
 * delayed or lost, and a payment made just before the deadline must not be missed. Uses the
 * same database functions as the API's webhook path, so a payment is applied exactly once
 * whichever path sees it first.
 */
@Injectable()
export class PaymentReconciler {
  private readonly logger = new Logger(PaymentReconciler.name);
  private readonly gateways: Partial<Record<string, PaymentGateway>> = {};

  constructor(
    private readonly database: WorkerDatabase,
    private readonly config: WorkerConfig,
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly email: Queue,
  ) {
    const db = database.client;
    if (db && config.nodeEnv !== 'production') {
      this.gateways.MOCK = new MockGateway({
        webhookSecret: config.payments.mockWebhookSecret,
        checkoutPageUrl: `${config.storefrontUrl}/pay/mock`,
        store: mockStore(db),
      });
    }
    if (config.payments.paymongo) {
      this.gateways.PAYMONGO = new PayMongoGateway(config.payments.paymongo);
    }
  }

  gateway(provider: string): PaymentGateway | null {
    return this.gateways[provider] ?? null;
  }

  /**
   * Checks open attempts: those of orders whose deadline passed (`due`) before the expiry
   * sweep cancels them, or every open attempt older than a few minutes.
   */
  async run(options: {
    dueOnly: boolean;
    limit?: number;
  }): Promise<{ checked: number; paid: number; closed: number }> {
    const db = this.database.client;
    const result = { checked: 0, paid: 0, closed: 0 };
    if (!db) return result;
    const now = new Date();
    const open = await db.payment.findMany({
      where: {
        status: 'PENDING',
        providerReference: { not: null },
        provider: { in: Object.keys(this.gateways) as ('MOCK' | 'PAYMONGO')[] },
        ...(options.dueOnly
          ? { order: { status: 'AWAITING_PAYMENT', paymentDueAt: { lte: now } } }
          : { createdAt: { lte: new Date(now.getTime() - 3 * 60_000) } }),
      },
      orderBy: { createdAt: 'asc' },
      take: options.limit ?? 100,
      select: { id: true, provider: true, providerReference: true, orderId: true, reference: true },
    });
    for (const payment of open) {
      result.checked += 1;
      const gateway = this.gateways[payment.provider]!;
      let state;
      try {
        state = await gateway.retrieve(payment.providerReference!);
      } catch (error) {
        this.logger.warn(
          `Payment ${payment.reference}: lookup failed (${(error as Error).message})`,
        );
        continue;
      }
      if (state.state === 'PAID' && state.amountPaid) {
        const applied = await db.$transaction((tx) =>
          applyPaymentSucceededInTx(tx, {
            paymentId: payment.id,
            providerPaymentId: state.providerPaymentId,
            amount: state.amountPaid!,
            source: 'RECONCILIATION',
          }),
        );
        if (applied.result === 'PAID') {
          result.paid += 1;
          for (const other of applied.otherOpenAttempts) {
            await this.gateways[other.provider]
              ?.expire(other.providerReference)
              .catch(() => undefined);
          }
          await this.notifyPaid(db, payment.orderId);
        }
      } else if (state.state === 'FAILED' || state.state === 'EXPIRED') {
        const closed = await db.$transaction((tx) =>
          applyPaymentFailedInTx(tx, {
            paymentId: payment.id,
            final: true,
            failureCode: state.state === 'EXPIRED' ? 'EXPIRED' : state.failureCode,
            failureMessage:
              state.state === 'EXPIRED'
                ? 'The payment page expired.'
                : (state.failureMessage ?? 'The payment did not go through.'),
          }),
        );
        if (closed.closed) result.closed += 1;
      }
    }
    if (result.paid > 0 || result.closed > 0) {
      this.logger.log(
        `Reconciled ${result.checked} payment(s): ${result.paid} paid, ${result.closed} closed`,
      );
    }
    return result;
  }

  private async notifyPaid(db: PrismaClient, orderId: string) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, customer: { select: { email: true, firstName: true } } },
    });
    if (!order) return;
    const job: OrderUpdateJob = {
      to: order.customer.email,
      firstName: order.customer.firstName,
      orderNumber: order.orderNumber,
      title: 'Payment received',
      message:
        'We received your payment. The sellers will now prepare your items; we will email you when they ship.',
      link: `${this.config.storefrontUrl}/account/orders/${orderId}`,
    };
    await this.email.add(EMAIL_JOBS.ORDER_UPDATE, job).catch(() => undefined);
  }
}

function mockStore(db: PrismaClient): MockSessionStore {
  return {
    async create(session) {
      await db.mockPaymentSession.create({
        data: {
          id: session.id,
          paymentReference: session.paymentReference,
          amount: session.amount,
          status: 'OPEN',
        },
      });
    },
    async get(id) {
      const row = await db.mockPaymentSession.findUnique({ where: { id } });
      return row
        ? {
            id: row.id,
            paymentReference: row.paymentReference,
            amount: row.amount.toFixed(2),
            status: row.status as 'OPEN',
            paymentId: row.paymentId,
          }
        : null;
    },
    async update(id, change) {
      await db.mockPaymentSession.update({
        where: { id },
        data: {
          status: change.status,
          ...(change.paymentId ? { paymentId: change.paymentId } : {}),
        },
      });
    },
  };
}

@Injectable()
export class ReconcileOpenPaymentsHandler implements JobHandler<{
  checked: number;
  paid: number;
  closed: number;
}> {
  readonly jobName = PAYMENT_JOBS.RECONCILE_OPEN_PAYMENTS;
  constructor(private readonly reconciler: PaymentReconciler) {}
  handle() {
    return this.reconciler.run({ dueOnly: false });
  }
}

@Injectable()
export class PaymentReconciliationScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.PAYMENT_EVENTS) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    await this.queue.upsertJobScheduler(
      PAYMENT_RECONCILIATION_SCHEDULER_ID,
      { every: PAYMENT_RECONCILIATION_INTERVAL_SECONDS * 1000 },
      {
        name: PAYMENT_JOBS.RECONCILE_OPEN_PAYMENTS,
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
