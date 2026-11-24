import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_JOBS,
  QUEUE_DEFINITIONS,
  QUEUE_NAMES,
  type QueueName,
  REDIS_KEYS,
  SYSTEM_JOBS,
} from '@marketplace/config';
import type { PaginatedResponse } from '@marketplace/shared-types';
import {
  type DeadLetterEntry,
  deadLetterDataSchema,
  devSmsMessageSchema,
  type DevSmsOutbox,
  type DevSampleJobData,
  type DevTestEmailRequest,
  type EnqueuedJobResponse,
  JOB_STATES,
  type JobState,
  type JobStatusResponse,
  type QueueStatsResponse,
} from '@marketplace/validation';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { ApiException } from '../../common/errors/api.exception';
import { QueueRegistry } from '../../infrastructure/queue/queue.module';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

function toJobState(state: string): JobState {
  return (JOB_STATES as readonly string[]).includes(state) ? (state as JobState) : 'unknown';
}

const iso = (epochMs: number | undefined | null) =>
  epochMs ? new Date(epochMs).toISOString() : null;

/** Development-only job operations: enqueue test jobs, inspect queues and dead letters. */
@Injectable()
export class DevJobsService {
  constructor(
    private readonly queues: QueueRegistry,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Messages the worker's mock SMS provider captured (the list is capped by the worker). */
  async smsOutbox(): Promise<DevSmsOutbox> {
    const raw = await this.redis.lrange(REDIS_KEYS.DEV_SMS_OUTBOX, 0, 49);
    const messages = raw.flatMap((entry) => {
      try {
        const parsed = devSmsMessageSchema.safeParse(JSON.parse(entry));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
    return { messages };
  }

  async enqueueSample(data: DevSampleJobData): Promise<EnqueuedJobResponse> {
    const job = await this.queues.get(QUEUE_NAMES.SYSTEM).add(SYSTEM_JOBS.DEV_SAMPLE, data);
    return { queue: QUEUE_NAMES.SYSTEM, jobId: job.id! };
  }

  async enqueueTestEmail(data: DevTestEmailRequest): Promise<EnqueuedJobResponse> {
    const job = await this.queues.get(QUEUE_NAMES.EMAIL).add(EMAIL_JOBS.DEV_TEST, data);
    return { queue: QUEUE_NAMES.EMAIL, jobId: job.id! };
  }

  async getJob(queueName: QueueName, jobId: string): Promise<JobStatusResponse> {
    const job = await this.queues.get(queueName).getJob(jobId);
    if (!job) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Job not found.');
    return {
      queue: queueName,
      jobId: job.id!,
      name: job.name,
      state: toJobState(await job.getState()),
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      returnValue: (job.returnvalue as unknown) ?? null,
      failedReason: job.failedReason || null,
      createdAt: new Date(job.timestamp).toISOString(),
      processedAt: iso(job.processedOn),
      finishedAt: iso(job.finishedOn),
    };
  }

  async queueStats(): Promise<QueueStatsResponse> {
    const queues = await Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        const counts = await this.queues
          .get(name)
          .getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
        const definition = QUEUE_DEFINITIONS[name];
        return {
          name,
          description: definition.description,
          attempts: definition.attempts,
          backoffDelayMs: definition.backoffDelayMs,
          counts: {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
          },
        };
      }),
    );
    return { queues };
  }

  async listDeadLetters(
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<DeadLetterEntry>> {
    const queue = this.queues.get(QUEUE_NAMES.DEAD_LETTER);
    const start = (page - 1) * pageSize;
    const [jobs, totalItems] = await Promise.all([
      // Newest first. Dead letters are never processed, so they stay "waiting".
      queue.getJobs(['waiting'], start, start + pageSize - 1, false),
      queue.getWaitingCount(),
    ]);
    return {
      items: jobs.filter((job): job is Job => Boolean(job)).map((job) => this.toDeadLetter(job)),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    };
  }

  /** Re-enqueues the original job on its source queue and removes the dead letter. */
  async retryDeadLetter(id: string): Promise<EnqueuedJobResponse> {
    const job = await this.findDeadLetter(id);
    const entry = this.toDeadLetter(job);
    const sourceQueue = entry.sourceQueue as QueueName;
    if (
      !(Object.values(QUEUE_NAMES) as string[]).includes(sourceQueue) ||
      sourceQueue === QUEUE_NAMES.DEAD_LETTER
    ) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'The source queue no longer exists.');
    }
    const retried = await this.queues.get(sourceQueue).add(entry.jobName, entry.data);
    await job.remove();
    return { queue: sourceQueue, jobId: retried.id! };
  }

  async discardDeadLetter(id: string): Promise<void> {
    await (await this.findDeadLetter(id)).remove();
  }

  private async findDeadLetter(id: string): Promise<Job> {
    const job = await this.queues.get(QUEUE_NAMES.DEAD_LETTER).getJob(id);
    if (!job) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Dead letter not found.');
    return job;
  }

  private toDeadLetter(job: Job): DeadLetterEntry {
    const parsed = deadLetterDataSchema.safeParse(job.data);
    if (parsed.success) return { id: job.id!, ...parsed.data };
    return {
      id: job.id!,
      sourceQueue: 'unknown',
      sourceJobId: 'unknown',
      jobName: job.name,
      data: job.data as unknown,
      failedReason: 'Malformed dead-letter entry',
      attemptsMade: 0,
      failedAt: new Date(job.timestamp).toISOString(),
    };
  }
}
