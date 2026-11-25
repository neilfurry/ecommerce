import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  EMAIL_JOBS,
  ORDER_JOBS,
  QUEUE_NAMES,
  UNPAID_ORDER_SWEEP_INTERVAL_SECONDS,
  UNPAID_ORDER_SWEEP_SCHEDULER_ID,
} from '@marketplace/config';
import { expireUnpaidOrders } from '@marketplace/database';
import type { OrderCancelledJob } from '@marketplace/validation';
import type { Queue } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../database/database.provider';
import type { JobHandler } from '../queues/job-handler';

/**
 * Cancels orders still waiting for an online payment after their deadline: the order and its
 * suborders become CANCELLED, held stock, coupon uses and flash sale units are given back
 * (cancelOrderInTx), and the customer is emailed.
 */
@Injectable()
export class ExpireUnpaidOrdersHandler implements JobHandler<{ cancelled: number }> {
  readonly jobName = ORDER_JOBS.EXPIRE_UNPAID_ORDERS;
  private readonly logger = new Logger(ExpireUnpaidOrdersHandler.name);

  constructor(
    private readonly database: WorkerDatabase,
    private readonly config: WorkerConfig,
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly email: Queue,
  ) {}

  async handle(): Promise<{ cancelled: number }> {
    if (!this.database.client) return { cancelled: 0 };
    const cancelled = await expireUnpaidOrders(this.database.client, { limit: 100 });
    for (const order of cancelled) {
      const job: OrderCancelledJob = {
        to: order.customerEmail,
        firstName: order.customerFirstName,
        orderNumber: order.orderNumber,
        reason: 'Payment was not received in time.',
        link: `${this.config.storefrontUrl}/account/orders/${order.id}`,
      };
      await this.email.add(EMAIL_JOBS.ORDER_CANCELLED, job);
    }
    if (cancelled.length > 0) this.logger.log(`Cancelled ${cancelled.length} unpaid order(s)`);
    return { cancelled: cancelled.length };
  }
}

/** Registers the sweep with BullMQ's scheduler (idempotent across worker instances). */
@Injectable()
export class UnpaidOrderSweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.ORDER_PROCESSING) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    await this.queue.upsertJobScheduler(
      UNPAID_ORDER_SWEEP_SCHEDULER_ID,
      { every: UNPAID_ORDER_SWEEP_INTERVAL_SECONDS * 1000 },
      {
        name: ORDER_JOBS.EXPIRE_UNPAID_ORDERS,
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
