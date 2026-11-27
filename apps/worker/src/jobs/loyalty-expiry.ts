import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  ENGAGEMENT_JOBS,
  LOYALTY_EXPIRY_INTERVAL_SECONDS,
  LOYALTY_EXPIRY_SCHEDULER_ID,
  QUEUE_NAMES,
} from '@marketplace/config';
import { expireLoyaltyPoints } from '@marketplace/database';
import type { Queue } from 'bullmq';
import { WorkerDatabase } from '../database/database.provider';
import type { JobHandler } from '../queues/job-handler';

/** Daily: loyalty points past their expiry date are expired (first in, first out; ADR 0031). */
@Injectable()
export class ExpireLoyaltyPointsHandler implements JobHandler<{ customers: number }> {
  readonly jobName = ENGAGEMENT_JOBS.EXPIRE_LOYALTY_POINTS;
  private readonly logger = new Logger(ExpireLoyaltyPointsHandler.name);
  constructor(private readonly database: WorkerDatabase) {}

  async handle(): Promise<{ customers: number }> {
    if (!this.database.client) return { customers: 0 };
    const customers = await expireLoyaltyPoints(this.database.client);
    if (customers > 0) this.logger.log(`Expired loyalty points of ${customers} customer(s)`);
    return { customers };
  }
}

@Injectable()
export class LoyaltyExpiryScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.ORDER_PROCESSING) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    await this.queue.upsertJobScheduler(
      LOYALTY_EXPIRY_SCHEDULER_ID,
      { every: LOYALTY_EXPIRY_INTERVAL_SECONDS * 1000 },
      {
        name: ENGAGEMENT_JOBS.EXPIRE_LOYALTY_POINTS,
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
