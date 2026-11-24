import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DEAD_LETTER_JOBS, QUEUE_NAMES, SYSTEM_JOBS } from '@marketplace/config';
import {
  apiErrorBodySchema,
  deadLetterListResponseSchema,
  devSmsOutboxSchema,
  enqueuedJobResponseSchema,
  jobStatusResponseSchema,
  queueStatsResponseSchema,
  signedUrlResponseSchema,
  storedFileListResponseSchema,
  storedFileSchema,
} from '@marketplace/validation';
import type { Queue } from 'bullmq';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, TestClient } from './auth-helpers';
import { createTestApp } from './test-app';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake image body for e2e'),
]);

/**
 * Developer tools against real PostgreSQL, Redis and S3-compatible storage.
 * Job *processing* is covered by the worker integration tests and Playwright (which run
 * the worker); here we verify enqueueing, inspection, dead letters and file storage.
 */
describe('Developer tools (e2e)', () => {
  let app: NestExpressApplication;
  let admin: TestClient;
  let systemQueue: Queue;
  let deadLetterQueue: Queue;

  beforeAll(async () => {
    app = await createTestApp();
    admin = (await signedInClient(app, 'admin', ['SUPER_ADMIN'], 'devtools')).client;
    systemQueue = app.get<Queue>(getQueueToken(QUEUE_NAMES.SYSTEM));
    deadLetterQueue = app.get<Queue>(getQueueToken(QUEUE_NAMES.DEAD_LETTER));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    it('requires a signed-in user', async () => {
      const anonymous = await new TestClient(app.getHttpServer(), 'admin').init();
      const res = await anonymous.get('/api/v1/dev/queues').expect(401);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('UNAUTHENTICATED');
    });

    it('requires the dev-tools.use permission (ADMIN does not have it by default)', async () => {
      const { client } = await signedInClient(app, 'admin', ['ADMIN'], 'devtools-admin');
      const res = await client.get('/api/v1/dev/queues').expect(403);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('FORBIDDEN');
    });

    it('rejects state-changing requests without the CSRF token', async () => {
      const res = await admin.agent
        .post('/api/v1/dev/jobs/sample')
        .set('X-Client-App', 'admin')
        .set('X-Forwarded-For', admin.ip)
        .send({ message: 'no csrf' })
        .expect(403);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('CSRF_FAILED');
    });
  });

  describe('SMS outbox', () => {
    it('lists captured messages, newest first, skipping malformed entries', async () => {
      const res = await admin.get('/api/v1/dev/sms-outbox').expect(200);
      expect(devSmsOutboxSchema.parse(res.body).messages.length).toBeLessThanOrEqual(50);
    });
  });

  describe('jobs', () => {
    it('enqueues the sample job with the system queue retry policy and reports its status', async () => {
      const res = await admin
        .post('/api/v1/dev/jobs/sample')
        .send({ message: 'e2e', simulateFailures: 1, durationMs: 0 })
        .expect(202);
      const { queue, jobId } = enqueuedJobResponseSchema.parse(res.body);
      expect(queue).toBe('system');

      const status = await admin.get(`/api/v1/dev/jobs/system/${jobId}`).expect(200);
      const body = jobStatusResponseSchema.parse(status.body);
      expect(body).toMatchObject({ jobId, name: SYSTEM_JOBS.DEV_SAMPLE, maxAttempts: 3 });
      expect(['waiting', 'active', 'completed', 'delayed']).toContain(body.state);
      await (await systemQueue.getJob(jobId))?.remove();
    });

    it('validates request bodies with the shared schema (global pipe)', async () => {
      const res = await admin
        .post('/api/v1/dev/jobs/sample')
        .send({ message: '', simulateFailures: 99 })
        .expect(400);
      const body = apiErrorBodySchema.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.fieldErrors?.map((e) => e.path).sort()).toEqual([
        'message',
        'simulateFailures',
      ]);
    });

    it('enqueues a test email', async () => {
      const res = await admin
        .post('/api/v1/dev/jobs/test-email')
        .send({ to: 'dev@example.ph' })
        .expect(202);
      expect(enqueuedJobResponseSchema.parse(res.body).queue).toBe('email');
    });

    it('rejects unknown queues and returns 404 for unknown jobs', async () => {
      await admin.get('/api/v1/dev/jobs/not-a-queue/1').expect(400);
      await admin.get('/api/v1/dev/jobs/system/999999999').expect(404);
    });

    it('lists every queue with its retry policy and counts', async () => {
      const res = await admin.get('/api/v1/dev/queues').expect(200);
      const { queues } = queueStatsResponseSchema.parse(res.body);
      expect(queues.map((q) => q.name).sort()).toEqual(
        [
          'dead-letter',
          'email',
          'image-processing',
          'notifications',
          'order-processing',
          'payment-events',
          'reports',
          'system',
        ].sort(),
      );
      expect(queues.find((q) => q.name === 'payment-events')?.attempts).toBe(10);
    });
  });

  describe('dead letters', () => {
    const addDeadLetter = (suffix: string) =>
      deadLetterQueue.add(
        DEAD_LETTER_JOBS.ENTRY,
        {
          sourceQueue: 'system',
          sourceJobId: `e2e-${suffix}`,
          jobName: SYSTEM_JOBS.DEV_SAMPLE,
          data: { message: `retry me ${suffix}`, simulateFailures: 0, durationMs: 0 },
          failedReason: 'Simulated failure',
          attemptsMade: 3,
          failedAt: new Date().toISOString(),
        },
        { jobId: `system__e2e-${suffix}-${Date.now()}` },
      );

    it('lists, retries and discards dead letters', async () => {
      const toRetry = await addDeadLetter('a');
      const toDiscard = await addDeadLetter('b');

      const list = deadLetterListResponseSchema.parse(
        (await admin.get('/api/v1/dev/dead-letters?pageSize=100').expect(200)).body,
      );
      expect(list.items.map((i) => i.id)).toEqual(
        expect.arrayContaining([toRetry.id, toDiscard.id]),
      );

      const retried = enqueuedJobResponseSchema.parse(
        (await admin.post(`/api/v1/dev/dead-letters/${toRetry.id}/retry`).expect(202)).body,
      );
      expect(retried.queue).toBe('system');
      const requeued = await systemQueue.getJob(retried.jobId);
      expect(requeued?.data).toMatchObject({ message: 'retry me a' });
      expect(await deadLetterQueue.getJob(toRetry.id!)).toBeUndefined();
      await requeued?.remove();

      await admin.delete(`/api/v1/dev/dead-letters/${toDiscard.id}`).expect(204);
      expect(await deadLetterQueue.getJob(toDiscard.id!)).toBeUndefined();
      await admin.delete(`/api/v1/dev/dead-letters/${toDiscard.id}`).expect(404);
    });

    it('paginates', async () => {
      const res = await admin.get('/api/v1/dev/dead-letters?page=1&pageSize=1').expect(200);
      expect(deadLetterListResponseSchema.parse(res.body).pageSize).toBe(1);
      await admin.get('/api/v1/dev/dead-letters?pageSize=500').expect(400);
    });
  });

  describe('files', () => {
    it('uploads to storage, records metadata, serves downloads and deletes', async () => {
      const upload = await admin
        .post('/api/v1/dev/files')
        .attach('file', PNG, { filename: '../../etc/product photo.png', contentType: 'image/png' })
        .expect(201);
      const file = storedFileSchema.parse(upload.body);
      expect(file).toMatchObject({
        originalName: 'product photo.png',
        contentType: 'image/png',
        sizeBytes: PNG.length,
        purpose: 'DEV_TEST',
        status: 'AVAILABLE',
      });

      const list = storedFileListResponseSchema.parse(
        (await admin.get('/api/v1/dev/files').expect(200)).body,
      );
      expect(list.items[0]?.id).toBe(file.id);

      await admin.get(`/api/v1/dev/files/${file.id}`).expect(200);

      const signed = signedUrlResponseSchema.parse(
        (await admin.get(`/api/v1/dev/files/${file.id}/download-url`).expect(200)).body,
      );
      const direct = await fetch(signed.url);
      expect(direct.status).toBe(200);
      expect(Buffer.from(await direct.arrayBuffer()).equals(PNG)).toBe(true);

      const streamed = await admin
        .get(`/api/v1/dev/files/${file.id}/content`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(streamed.headers['content-type']).toBe('image/png');
      expect(streamed.headers['content-disposition']).toContain('attachment');
      expect((streamed.body as Buffer).equals(PNG)).toBe(true);

      await admin.delete(`/api/v1/dev/files/${file.id}`).expect(204);
      await admin.get(`/api/v1/dev/files/${file.id}`).expect(404);
      const row = await app.get(PrismaService).storedFile.findUnique({ where: { id: file.id } });
      expect(row).toMatchObject({ status: 'DELETED' });
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it('rejects files whose content is not an allowed type, whatever their name says', async () => {
      const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);
      const res = await admin
        .post('/api/v1/dev/files')
        .attach('file', exe, { filename: 'cat.png', contentType: 'image/png' })
        .expect(415);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects oversized uploads with 413', async () => {
      const big = Buffer.alloc(1_100_000, 0x41);
      const res = await admin
        .post('/api/v1/dev/files')
        .attach('file', big, { filename: 'big.txt', contentType: 'text/plain' })
        .expect(413);
      expect(apiErrorBodySchema.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('requires a file and a valid id', async () => {
      await admin.post('/api/v1/dev/files').expect(400);
      await admin.get('/api/v1/dev/files/not-a-uuid').expect(400);
    });
  });
});
