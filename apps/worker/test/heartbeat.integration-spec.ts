import type { INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { QUEUE_NAMES, REDIS_KEYS, WORKER_HEARTBEAT_SCHEDULER_ID } from '@marketplace/config';
import type { Queue } from 'bullmq';
import type { WorkerHeartbeat } from '@marketplace/types';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../src/redis.provider';
import { WorkerModule } from '../src/worker.module';

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs} ms`);
}

describe('Worker heartbeat (integration, real Redis + BullMQ)', () => {
  let app: INestApplicationContext;
  let redis: Redis;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    app = moduleRef;
    redis = app.get<Redis>(REDIS_CLIENT);
    await redis.del(REDIS_KEYS.WORKER_HEARTBEAT);
    await app.init();
  });

  afterAll(async () => {
    // Remove the 1-second test schedule so a later real worker starts from a clean slate.
    await app
      ?.get<Queue>(getQueueToken(QUEUE_NAMES.SYSTEM))
      .removeJobScheduler(WORKER_HEARTBEAT_SCHEDULER_ID);
    await app?.close();
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
});
