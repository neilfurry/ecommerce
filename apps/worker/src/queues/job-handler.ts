import type { Job } from 'bullmq';

/**
 * One handler per job name. Processors route each job to the handler whose `jobName`
 * matches. Handlers must be idempotent: a job can run more than once after a crash or retry.
 *
 * Throw a normal Error for transient failures (the job is retried with backoff) and
 * BullMQ's UnrecoverableError for permanent ones (bad payload, feature disabled) so the job
 * goes straight to the dead-letter queue.
 */
export interface JobHandler<TResult = unknown> {
  readonly jobName: string;
  handle(job: Job): Promise<TResult>;
}
