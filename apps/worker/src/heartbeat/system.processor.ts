import { hostname } from 'node:os';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import {
  QUEUE_NAMES,
  REDIS_KEYS,
  SYSTEM_JOBS,
  WORKER_HEARTBEAT_STALE_AFTER_SECONDS,
} from '@marketplace/config';
import type { WorkerHeartbeat } from '@marketplace/types';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { WorkerConfig } from '../config/worker-config';
import { REDIS_CLIENT } from '../redis.provider';

/**
 * Consumes the "system" queue. The heartbeat job proves the whole pipeline works
 * (Redis → BullMQ scheduler → worker → Redis) and lets the API report worker health.
 */
@Processor(QUEUE_NAMES.SYSTEM)
export class SystemProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SystemProcessor.name);

  constructor(
    private readonly config: WorkerConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  onModuleInit(): void {
    this.worker.concurrency = this.config.concurrency;
  }

  async process(job: Job): Promise<WorkerHeartbeat> {
    switch (job.name) {
      case SYSTEM_JOBS.HEARTBEAT:
        return this.recordHeartbeat();
      default:
        // Failing loudly keeps unknown jobs visible in the failed set instead of silently lost.
        throw new Error(`Unknown job "${job.name}" on queue "${QUEUE_NAMES.SYSTEM}"`);
    }
  }

  async recordHeartbeat(): Promise<WorkerHeartbeat> {
    const heartbeat: WorkerHeartbeat = {
      at: new Date().toISOString(),
      version: this.config.version,
      hostname: hostname(),
      pid: process.pid,
    };
    // Expire well after the staleness threshold so a dead worker eventually leaves no key.
    await this.redis.set(
      REDIS_KEYS.WORKER_HEARTBEAT,
      JSON.stringify(heartbeat),
      'EX',
      WORKER_HEARTBEAT_STALE_AFTER_SECONDS * 10,
    );
    this.logger.debug(`Heartbeat recorded at ${heartbeat.at}`);
    return heartbeat;
  }
}
