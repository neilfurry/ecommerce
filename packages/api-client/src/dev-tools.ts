import {
  deadLetterListResponseSchema,
  type DeadLetterListResponse,
  type DevSampleJobRequest,
  type DevSmsOutbox,
  devSmsOutboxSchema,
  type DevTestEmailRequest,
  enqueuedJobResponseSchema,
  type EnqueuedJobResponse,
  jobStatusResponseSchema,
  type JobStatusResponse,
  queueStatsResponseSchema,
  type QueueStatsResponse,
  signedUrlResponseSchema,
  type SignedUrlResponse,
  storedFileListResponseSchema,
  type StoredFileListResponse,
  storedFileSchema,
  type StoredFileDto,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;

const noContent = z.undefined();

/** Development-only endpoints (/api/v1/dev/*). */
export function createDevToolsClient(request: Request) {
  return {
    enqueueSampleJob: (body: DevSampleJobRequest): Promise<EnqueuedJobResponse> =>
      request('/dev/jobs/sample', { method: 'POST', body, schema: enqueuedJobResponseSchema }),
    enqueueTestEmail: (body: DevTestEmailRequest): Promise<EnqueuedJobResponse> =>
      request('/dev/jobs/test-email', { method: 'POST', body, schema: enqueuedJobResponseSchema }),
    getJob: (queue: string, jobId: string, signal?: AbortSignal): Promise<JobStatusResponse> =>
      request(`/dev/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(jobId)}`, {
        schema: jobStatusResponseSchema,
        signal,
      }),
    smsOutbox: (signal?: AbortSignal): Promise<DevSmsOutbox> =>
      request('/dev/sms-outbox', { schema: devSmsOutboxSchema, signal }),
    queueStats: (signal?: AbortSignal): Promise<QueueStatsResponse> =>
      request('/dev/queues', { schema: queueStatsResponseSchema, signal }),
    listDeadLetters: (
      page: number,
      pageSize: number,
      signal?: AbortSignal,
    ): Promise<DeadLetterListResponse> =>
      request('/dev/dead-letters', {
        query: { page, pageSize },
        schema: deadLetterListResponseSchema,
        signal,
      }),
    retryDeadLetter: (id: string): Promise<EnqueuedJobResponse> =>
      request(`/dev/dead-letters/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
        schema: enqueuedJobResponseSchema,
      }),
    discardDeadLetter: (id: string): Promise<undefined> =>
      request(`/dev/dead-letters/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: noContent,
      }),
    uploadFile: (file: File): Promise<StoredFileDto> => {
      const form = new FormData();
      form.append('file', file);
      return request('/dev/files', { method: 'POST', body: form, schema: storedFileSchema });
    },
    listFiles: (
      page: number,
      pageSize: number,
      signal?: AbortSignal,
    ): Promise<StoredFileListResponse> =>
      request('/dev/files', {
        query: { page, pageSize },
        schema: storedFileListResponseSchema,
        signal,
      }),
    getFileDownloadUrl: (id: string): Promise<SignedUrlResponse> =>
      request(`/dev/files/${encodeURIComponent(id)}/download-url`, {
        schema: signedUrlResponseSchema,
      }),
    deleteFile: (id: string): Promise<undefined> =>
      request(`/dev/files/${encodeURIComponent(id)}`, { method: 'DELETE', schema: noContent }),
  };
}
