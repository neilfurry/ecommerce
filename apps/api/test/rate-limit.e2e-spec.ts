import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '../src/infrastructure/throttling/redis-throttler.storage';

/** Exercises the Lua rate-limit script against the real Redis from .env. */
describe('RedisThrottlerStorage (e2e, real Redis)', () => {
  let redis: Redis;
  let storage: RedisThrottlerStorage;
  const prefix = `marketplace:test:throttle:${randomUUID()}:`;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    storage = new RedisThrottlerStorage(redis, prefix);
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('counts hits and blocks once the limit is exceeded', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await storage.increment('ip-a', 60_000, 3, 0, 'default'));
    }
    expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
    expect(results[0]?.timeToExpire).toBeGreaterThan(55);
    expect(results[0]?.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('tracks clients independently', async () => {
    const other = await storage.increment('ip-b', 60_000, 3, 0, 'default');
    expect(other).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps a client blocked for the block duration', async () => {
    await storage.increment('ip-c', 60_000, 1, 0, 'strict');
    const blocked = await storage.increment('ip-c', 60_000, 1, 5_000, 'strict');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBe(5);
    const stillBlocked = await storage.increment('ip-c', 60_000, 1, 5_000, 'strict');
    expect(stillBlocked.isBlocked).toBe(true);
  });

  it('resets after the window expires', async () => {
    await storage.increment('ip-d', 200, 1, 0, 'default');
    await storage.increment('ip-d', 200, 1, 0, 'default');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const fresh = await storage.increment('ip-d', 200, 1, 0, 'default');
    expect(fresh).toMatchObject({ totalHits: 1, isBlocked: false });
  });
});
