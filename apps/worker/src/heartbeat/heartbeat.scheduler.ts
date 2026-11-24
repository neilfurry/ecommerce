import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { QUEUE_NAMES, SYSTEM_JOBS, WORKER_HEARTBEAT_SCHEDULER_ID } from '@marketplace/config';
import type { Queue } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';

/**
 * Registers the recurring heartbeat with BullMQ's job scheduler. upsertJobScheduler is
 * idempotent, so several worker instances starting together still produce one schedule.
 */
@Injectable()
export class HeartbeatScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(HeartbeatScheduler.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SYSTEM) private readonly queue: Queue,
    private readonly config: WorkerConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const everyMs = this.config.heartbeatIntervalSeconds * 1000;
    await this.queue.upsertJobScheduler(
      WORKER_HEARTBEAT_SCHEDULER_ID,
      { every: everyMs },
      {
        name: SYSTEM_JOBS.HEARTBEAT,
        opts: { removeOnComplete: 100, removeOnFail: 500 },
      },
    );
    // Record one immediately so health is green right after start-up.
    await this.queue.add(SYSTEM_JOBS.HEARTBEAT, {}, { removeOnComplete: 100, removeOnFail: 500 });
    this.logger.log(`Heartbeat scheduled every ${this.config.heartbeatIntervalSeconds}s`);
  }
}
