import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { SYSTEM_JOBS } from '@marketplace/config';
import { devSampleJobRequestSchema, type DevSampleJobResult } from '@marketplace/validation';
import { type Job, UnrecoverableError } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';
import type { JobHandler } from '../queues/job-handler';

const PROGRESS_STEPS = 5;

/**
 * DEVELOPMENT ONLY. Proves end to end that jobs are queued, processed, retried with
 * exponential backoff and dead-lettered: it fails on its first `simulateFailures`
 * attempts, then "works" for `durationMs` while reporting progress.
 */
@Injectable()
export class DevSampleHandler implements JobHandler<DevSampleJobResult> {
  readonly jobName = SYSTEM_JOBS.DEV_SAMPLE;

  constructor(private readonly config: WorkerConfig) {}

  async handle(job: Job): Promise<DevSampleJobResult> {
    if (!this.config.devToolsEnabled) {
      throw new UnrecoverableError('Developer tools are disabled (DEV_TOOLS_ENABLED=false)');
    }
    const parsed = devSampleJobRequestSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid dev-sample job payload');
    const { message, simulateFailures, durationMs } = parsed.data;

    const attempt = job.attemptsMade + 1;
    if (attempt <= simulateFailures) {
      throw new Error(`Simulated failure on attempt ${attempt} of ${simulateFailures}`);
    }

    for (let step = 1; step <= PROGRESS_STEPS; step += 1) {
      await sleep(durationMs / PROGRESS_STEPS);
      await job.updateProgress((step / PROGRESS_STEPS) * 100);
    }
    return { message, attempt, processedAt: new Date().toISOString() };
  }
}
