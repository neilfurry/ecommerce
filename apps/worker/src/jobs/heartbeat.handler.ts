import { hostname } from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import { REDIS_KEYS, SYSTEM_JOBS, WORKER_HEARTBEAT_STALE_AFTER_SECONDS } from '@marketplace/config';
import type { WorkerHeartbeat } from '@marketplace/shared-types';
import type { Redis } from 'ioredis';
import { WorkerConfig } from '../config/worker-config';
import type { JobHandler } from '../queues/job-handler';
import { REDIS_CLIENT } from '../redis.provider';

/**
 * Records that the worker is alive. Runs through BullMQ (not a timer) so it proves the
 * whole Redis → scheduler → worker pipeline; the API reports the result in /health.
 */
@Injectable()
export class HeartbeatHandler implements JobHandler<WorkerHeartbeat> {
  readonly jobName = SYSTEM_JOBS.HEARTBEAT;

  constructor(
    private readonly config: WorkerConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async handle(): Promise<WorkerHeartbeat> {
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
    return heartbeat;
  }
}
