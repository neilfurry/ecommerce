import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DEAD_LETTER_JOBS, QUEUE_NAMES } from '@marketplace/config';
import type { DeadLetterData } from '@marketplace/validation';
import type { Job, Queue } from 'bullmq';

/** True when BullMQ will not retry this job again. */
export function isFinalFailure(job: Job, error: Error): boolean {
  if (error.name === 'UnrecoverableError') return true;
  const maxAttempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}

/**
 * Copies permanently failed jobs to the dead-letter queue, where they stay until an admin
 * retries or discards them. The dead-letter job id is derived from the source job, so
 * recording the same failure twice is harmless.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(@InjectQueue(QUEUE_NAMES.DEAD_LETTER) private readonly deadLetterQueue: Queue) {}

  async record(sourceQueue: string, job: Job, error: Error): Promise<void> {
    if (!job.id) return;
    const entry: DeadLetterData = {
      sourceQueue,
      sourceJobId: job.id,
      jobName: job.name,
      data: job.data as unknown,
      failedReason: error.message.slice(0, 1_000),
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    await this.deadLetterQueue.add(DEAD_LETTER_JOBS.ENTRY, entry, {
      jobId: deadLetterJobId(sourceQueue, job.id),
    });
    this.logger.warn(
      `Job ${sourceQueue}/${job.id} (${job.name}) moved to the dead-letter queue after ` +
        `${job.attemptsMade} attempt(s): ${entry.failedReason}`,
    );
  }
}

/** BullMQ job ids must not contain ":"; "__" separates queue and job id instead. */
export function deadLetterJobId(sourceQueue: string, sourceJobId: string): string {
  return `${sourceQueue}__${sourceJobId}`;
}
