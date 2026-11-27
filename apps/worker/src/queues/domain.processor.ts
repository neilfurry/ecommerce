import { WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import { QUEUE_DEFINITIONS, type ProcessedQueueName } from '@marketplace/config';
import { type Job, UnrecoverableError } from 'bullmq';
import type { WorkerConfig } from '../config/worker-config';
import { type DeadLetterService, isFinalFailure } from './dead-letter.service';
import type { JobHandler } from './job-handler';
import { reportError } from '../observability/error-reporting';
import { jobDuration, jobFailures } from '../observability/metrics';

/**
 * Base class for every queue processor: routes jobs to handlers by name, applies the
 * queue's concurrency, logs retries, and dead-letters jobs that fail permanently.
 * Subclasses only declare the queue (@Processor) and which handlers they own.
 */
export abstract class DomainProcessor extends WorkerHost implements OnModuleInit {
  protected readonly logger: Logger;
  private readonly handlers: Map<string, JobHandler>;

  protected constructor(
    private readonly queueName: ProcessedQueueName,
    handlers: JobHandler[],
    private readonly config: WorkerConfig,
    private readonly deadLetters: DeadLetterService,
  ) {
    super();
    this.logger = new Logger(`${queueName}-processor`);
    this.handlers = new Map(handlers.map((handler) => [handler.jobName, handler]));
  }

  onModuleInit(): void {
    this.worker.concurrency =
      this.config.concurrencyOverride ?? QUEUE_DEFINITIONS[this.queueName].concurrency;

    this.worker.on('failed', (job, error) => {
      if (!job) return;
      const final = isFinalFailure(job, error);
      jobFailures.inc({ queue: this.queueName, job: job.name, final: String(final) });
      if (!final) {
        this.logger.warn(
          `Job ${job.id} (${job.name}) failed attempt ${job.attemptsMade}/${job.opts.attempts ?? 1}; ` +
            `retrying with backoff: ${error.message}`,
        );
        return;
      }
      reportError(error, { queue: this.queueName, job: job.name, jobId: job.id });
      this.deadLetters.record(this.queueName, job, error).catch((recordError: unknown) => {
        this.logger.error(
          `Could not dead-letter job ${job.id}: ${(recordError as Error).message}`,
          (recordError as Error).stack,
        );
      });
    });
  }

  /** Job names this processor can handle (exposed for tests and diagnostics). */
  get handledJobNames(): string[] {
    return [...this.handlers.keys()];
  }

  async process(job: Job): Promise<unknown> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      // Retrying cannot help: no code exists for this job yet.
      throw new UnrecoverableError(`No handler for job "${job.name}" on queue "${this.queueName}"`);
    }
    const end = jobDuration.startTimer({ queue: this.queueName, job: job.name });
    try {
      const result = await handler.handle(job);
      end({ result: 'completed' });
      return result;
    } catch (error) {
      end({ result: 'failed' });
      throw error;
    }
  }
}
