import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  ORDER_JOBS,
  QUEUE_NAMES,
  SETTLEMENT_INTERVAL_SECONDS,
  SETTLEMENT_SCHEDULER_ID,
} from '@marketplace/config';
import { runSettlement } from '@marketplace/database';
import type { Queue } from 'bullmq';
import { WorkerDatabase } from '../database/database.provider';
import type { JobHandler } from '../queues/job-handler';

/**
 * Settles every seller with eligible orders for the last closed settlement period (ADR 0028).
 * Safe to run repeatedly: a seller is settled once per period, an order once ever.
 */
@Injectable()
export class SettleSellersHandler implements JobHandler<{ settled: number }> {
  readonly jobName = ORDER_JOBS.SETTLE_SELLERS;
  private readonly logger = new Logger(SettleSellersHandler.name);
  constructor(private readonly database: WorkerDatabase) {}

  async handle(): Promise<{ settled: number }> {
    if (!this.database.client) return { settled: 0 };
    const results = await runSettlement(this.database.client);
    for (const r of results) {
      this.logger.log(
        `Settled ${r.reference}: ${r.ordersCount} order(s), net ${r.netSettled}, withholding ${r.withholdingTax}`,
      );
    }
    return { settled: results.length };
  }
}

@Injectable()
export class SettlementScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE_NAMES.ORDER_PROCESSING) private readonly queue: Queue,
    private readonly database: WorkerDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.database.client) return;
    await this.queue.upsertJobScheduler(
      SETTLEMENT_SCHEDULER_ID,
      { every: SETTLEMENT_INTERVAL_SECONDS * 1000 },
      {
        name: ORDER_JOBS.SETTLE_SELLERS,
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
}
