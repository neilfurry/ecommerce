import { z } from 'zod';

/**
 * Contracts for the development-only tools (/api/v1/dev/*): test jobs, queue inspection,
 * dead letters and test uploads. Shared by the API (validation + Swagger) and the
 * Admin Console (forms + response parsing).
 */

/** Builds the standard paginated-list envelope around an item schema. */
export function paginatedSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalItems: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  });
}

// ---- Jobs -------------------------------------------------------------------

export const DEV_SAMPLE_MAX_SIMULATED_FAILURES = 5;

export const devSampleJobRequestSchema = z.object({
  message: z.string().trim().min(1, 'Enter a message').max(200, 'At most 200 characters'),
  /** The job throws on its first N attempts, to demonstrate retries and dead-lettering. */
  simulateFailures: z.coerce
    .number()
    .int()
    .min(0)
    .max(DEV_SAMPLE_MAX_SIMULATED_FAILURES, `At most ${DEV_SAMPLE_MAX_SIMULATED_FAILURES}`)
    .default(0),
  /** Simulated work time. */
  durationMs: z.coerce.number().int().min(0).max(10_000, 'At most 10 seconds').default(500),
});
export type DevSampleJobRequest = z.input<typeof devSampleJobRequestSchema>;
export type DevSampleJobData = z.output<typeof devSampleJobRequestSchema>;

export const devSampleJobResultSchema = z.object({
  message: z.string(),
  attempt: z.number().int(),
  processedAt: z.iso.datetime(),
});
export type DevSampleJobResult = z.infer<typeof devSampleJobResultSchema>;

export const devTestEmailRequestSchema = z.object({
  to: z.email('Enter a valid email address').max(254),
});
export type DevTestEmailRequest = z.infer<typeof devTestEmailRequestSchema>;

export const enqueuedJobResponseSchema = z.object({
  queue: z.string(),
  jobId: z.string(),
});
export type EnqueuedJobResponse = z.infer<typeof enqueuedJobResponseSchema>;

export const JOB_STATES = [
  'waiting',
  'waiting-children',
  'prioritized',
  'delayed',
  'active',
  'completed',
  'failed',
  'unknown',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const jobStatusResponseSchema = z.object({
  queue: z.string(),
  jobId: z.string(),
  name: z.string(),
  state: z.enum(JOB_STATES),
  attemptsMade: z.number().int(),
  maxAttempts: z.number().int(),
  progress: z.number().min(0).max(100),
  returnValue: z.unknown().nullable(),
  failedReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

export const queueStatsSchema = z.object({
  name: z.string(),
  description: z.string(),
  attempts: z.number().int(),
  backoffDelayMs: z.number().int(),
  counts: z.object({
    waiting: z.number().int(),
    active: z.number().int(),
    delayed: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
  }),
});
export type QueueStats = z.infer<typeof queueStatsSchema>;

export const queueStatsResponseSchema = z.object({ queues: z.array(queueStatsSchema) });
export type QueueStatsResponse = z.infer<typeof queueStatsResponseSchema>;

// ---- Dead letters -------------------------------------------------------------

/** Payload of a job on the dead-letter queue. Written by the worker. */
export const deadLetterDataSchema = z.object({
  sourceQueue: z.string(),
  sourceJobId: z.string(),
  jobName: z.string(),
  data: z.unknown(),
  failedReason: z.string(),
  attemptsMade: z.number().int(),
  failedAt: z.iso.datetime(),
});
export type DeadLetterData = z.infer<typeof deadLetterDataSchema>;

export const deadLetterEntrySchema = deadLetterDataSchema.extend({ id: z.string() });
export type DeadLetterEntry = z.infer<typeof deadLetterEntrySchema>;

export const deadLetterListResponseSchema = paginatedSchema(deadLetterEntrySchema);
export type DeadLetterListResponse = z.infer<typeof deadLetterListResponseSchema>;

// ---- Files ----------------------------------------------------------------------

export const FILE_STATUSES = ['PENDING', 'AVAILABLE', 'DELETED'] as const;

export const storedFileSchema = z.object({
  id: z.uuid(),
  originalName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().min(0),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  purpose: z.string(),
  status: z.enum(FILE_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredFileDto = z.infer<typeof storedFileSchema>;

export const storedFileListResponseSchema = paginatedSchema(storedFileSchema);
export type StoredFileListResponse = z.infer<typeof storedFileListResponseSchema>;

export const signedUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type SignedUrlResponse = z.infer<typeof signedUrlResponseSchema>;
