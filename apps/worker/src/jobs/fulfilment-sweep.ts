import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  FULFILMENT_SWEEP_INTERVAL_SECONDS,
  FULFILMENT_SWEEP_SCHEDULER_ID,
  ORDER_JOBS,
  QUEUE_NAMES,
  RETURN_ESCALATION_SCHEDULER_ID,
} from '@marketplace/config';
import { completeDeliveredSellerOrders, escalateOverdueReturns } from '@marketplace/database';
import type { Queue } from 'bullmq';
import { WorkerDatabase } from '../database/database.provider';
import type { JobHandler } from '../queues/job-handler';

/** Delivered seller orders whose return window ended (and no return is open) are completed. */
@Injectable()
export class CompleteDeliveredHandler implements JobHandler<{ completed: number }> {
  readonly jobName = ORDER_JOBS.COMPLETE_DELIVERED;
  private readonly logger = new Logger(CompleteDeliveredHandler.name);
  constructor(private readonly database: WorkerDatabase) {}

  async handle(): Promise<{ completed: number }> {
    if (!this.database.client) return { completed: 0 };
    const completed = await completeDeliveredSellerOrders(this.database.client, { limit: 500 });
    if (completed > 0) this.logger.log(`Completed ${completed} delivered seller order(s)`);
    return { completed };
  }
}

/** Return requests the seller did not answer by the deadline go to the marketplace. */
@Injectable()
export class EscalateOverdueReturnsHandler implements JobHandler<{ escalated: number }> {
  readonly jobName = ORDER_JOBS.ESCALATE_OVERDUE_RETURNS;
  private readonly logger = new Logger(EscalateOverdueReturnsHandler.name);
  constructor(private readonly database: WorkerDatabase) {}

  async handle(): Promise<{ escalated: number }> {
    if (!this.database.client) return { escalated: 0 };
    const escalated = await escalateOverdueReturns(this.database.client, { limit: 200 });
    if (escalated.length > 0) this.logger.log(`Escalated ${escalated.length} unanswered return(s)`);
    return { escalated: escalated.length };
  }
}

@Injectable()
export class FulfilmentSweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.ORDER_PROCESSING) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    const opts = { attempts: 1, removeOnComplete: 100, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      FULFILMENT_SWEEP_SCHEDULER_ID,
      { every: FULFILMENT_SWEEP_INTERVAL_SECONDS * 1000 },
      { name: ORDER_JOBS.COMPLETE_DELIVERED, opts },
    );
    await this.queue.upsertJobScheduler(
      RETURN_ESCALATION_SCHEDULER_ID,
      { every: FULFILMENT_SWEEP_INTERVAL_SECONDS * 1000 },
      { name: ORDER_JOBS.ESCALATE_OVERDUE_RETURNS, opts },
    );
  }
}
