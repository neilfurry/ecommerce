import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  EMAIL_JOBS,
  QUEUE_NAMES,
  REDIS_KEYS,
  SYSTEM_JOBS,
  WORKER_HEARTBEAT_SCHEDULER_ID,
} from '@marketplace/config';
import type { WorkerHeartbeat } from '@marketplace/shared-types';
import type { DeadLetterData } from '@marketplace/validation';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { SMTPServer } from 'smtp-server';
import { deadLetterJobId } from '../src/queues/dead-letter.service';
import { REDIS_CLIENT } from '../src/redis.provider';
import { WorkerModule } from '../src/worker.module';

async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null && value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs} ms`);
}

async function waitForState(job: Job, states: string[], timeoutMs = 15_000): Promise<string> {
  return waitFor(async () => {
    const state = await job.getState();
    return states.includes(state) ? state : null;
  }, timeoutMs);
}

/**
 * Boots the real worker against the Redis from .env and an in-process SMTP server.
 * Proves queue processing, retries with backoff, dead-lettering and email delivery.
 */
describe('Worker (integration, real Redis + BullMQ)', () => {
  let app: INestApplicationContext;
  let redis: Redis;
  let systemQueue: Queue;
  let emailQueue: Queue;
  let reportsQueue: Queue;
  let deadLetterQueue: Queue;
  const received: { to: string[]; raw: string }[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      stream.on('end', () => {
        received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        callback();
      });
    },
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => smtp.listen(2525, '127.0.0.1', resolve));
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    app = moduleRef;
    redis = app.get<Redis>(REDIS_CLIENT);
    systemQueue = app.get<Queue>(getQueueToken(QUEUE_NAMES.SYSTEM));
    emailQueue = app.get<Queue>(getQueueToken(QUEUE_NAMES.EMAIL));
    reportsQueue = app.get<Queue>(getQueueToken(QUEUE_NAMES.REPORTS));
    deadLetterQueue = app.get<Queue>(getQueueToken(QUEUE_NAMES.DEAD_LETTER));
    await redis.del(REDIS_KEYS.WORKER_HEARTBEAT);
    await app.init();
  });

  afterAll(async () => {
    // Remove the 1-second test schedule so a later real worker starts from a clean slate.
    await systemQueue?.removeJobScheduler(WORKER_HEARTBEAT_SCHEDULER_ID);
    await app?.close();
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  });

  it('writes a heartbeat through the BullMQ pipeline shortly after start-up', async () => {
    const raw = await waitFor(() => redis.get(REDIS_KEYS.WORKER_HEARTBEAT), 10_000);
    const heartbeat = JSON.parse(raw) as WorkerHeartbeat;
    expect(Date.now() - Date.parse(heartbeat.at)).toBeLessThan(10_000);
    expect(heartbeat.pid).toBe(process.pid);
  });

  it('keeps refreshing the heartbeat on the configured schedule', async () => {
    const first = JSON.parse(
      (await redis.get(REDIS_KEYS.WORKER_HEARTBEAT)) ?? '{}',
    ) as WorkerHeartbeat;
    const next = await waitFor(async () => {
      const raw = await redis.get(REDIS_KEYS.WORKER_HEARTBEAT);
      const parsed = raw ? (JSON.parse(raw) as WorkerHeartbeat) : null;
      return parsed && parsed.at !== first.at ? parsed : null;
    }, 5_000);
    expect(Date.parse(next.at)).toBeGreaterThan(Date.parse(first.at));
  });

  it('processes the development sample job', async () => {
    const job = await systemQueue.add(SYSTEM_JOBS.DEV_SAMPLE, {
      message: 'hello worker',
      simulateFailures: 0,
      durationMs: 50,
    });
    expect(await waitForState(job, ['completed', 'failed'])).toBe('completed');
    const finished = await systemQueue.getJob(job.id!);
    expect(finished?.returnvalue).toMatchObject({ message: 'hello worker', attempt: 1 });
    expect(finished?.progress).toBe(100);
  });

  it('retries with exponential backoff and then succeeds', async () => {
    const started = Date.now();
    const job = await systemQueue.add(
      SYSTEM_JOBS.DEV_SAMPLE,
      { message: 'flaky', simulateFailures: 2, durationMs: 0 },
      { attempts: 3, backoff: { type: 'exponential', delay: 200 } },
    );
    expect(await waitForState(job, ['completed', 'failed'])).toBe('completed');
    const finished = await systemQueue.getJob(job.id!);
    expect(finished?.attemptsMade).toBe(3);
    expect(finished?.returnvalue).toMatchObject({ attempt: 3 });
    // Backoff delays of 200 ms then 400 ms must have elapsed.
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  });

  it('dead-letters a job that exhausts its retries', async () => {
    const job = await systemQueue.add(
      SYSTEM_JOBS.DEV_SAMPLE,
      { message: 'always fails', simulateFailures: 5, durationMs: 0 },
      { attempts: 2, backoff: { type: 'exponential', delay: 100 } },
    );
    expect(await waitForState(job, ['completed', 'failed'])).toBe('failed');
    const deadLetter = await waitFor(
      () => deadLetterQueue.getJob(deadLetterJobId(QUEUE_NAMES.SYSTEM, job.id!)),
      5_000,
    );
    const data = deadLetter.data as DeadLetterData;
    expect(data).toMatchObject({
      sourceQueue: 'system',
      sourceJobId: job.id,
      jobName: SYSTEM_JOBS.DEV_SAMPLE,
      attemptsMade: 2,
      data: { message: 'always fails' },
    });
    expect(data.failedReason).toMatch(/Simulated failure on attempt 2/);
    await deadLetter.remove();
  });

  it('dead-letters a job without a handler immediately, without retries', async () => {
    const job = await reportsQueue.add('reports.not-implemented', { any: 'thing' });
    expect(await waitForState(job, ['completed', 'failed'])).toBe('failed');
    const failed = await reportsQueue.getJob(job.id!);
    expect(failed?.attemptsMade).toBe(1);
    const deadLetter = await waitFor(
      () => deadLetterQueue.getJob(deadLetterJobId(QUEUE_NAMES.REPORTS, job.id!)),
      5_000,
    );
    expect((deadLetter.data as DeadLetterData).failedReason).toMatch(/No handler/);
    await deadLetter.remove();
  });

  it('sends the development test email over SMTP', async () => {
    const job = await emailQueue.add(EMAIL_JOBS.DEV_TEST, { to: 'buyer@example.ph' });
    expect(await waitForState(job, ['completed', 'failed'])).toBe('completed');
    const message = await waitFor(
      async () => received.find((m) => m.to.includes('buyer@example.ph')),
      5_000,
    );
    expect(message.raw).toContain(`job ${job.id}`);
  });
});
