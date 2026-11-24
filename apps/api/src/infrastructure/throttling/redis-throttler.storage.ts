import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { REDIS_KEYS } from '@marketplace/config';
import type { Redis } from 'ioredis';

/**
 * Fixed-window counter with optional blocking, executed atomically in Redis so every API
 * instance shares the same limits (the default in-memory storage is per-process).
 *
 * KEYS[1] = hit counter, KEYS[2] = block marker
 * ARGV[1] = window ms, ARGV[2] = limit, ARGV[3] = block duration ms
 * Returns { totalHits, hitsTtlMs, isBlocked (0/1), blockTtlMs }
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local hitsTtl = redis.call('PTTL', KEYS[1])
if hitsTtl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  hitsTtl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  local blockMs = tonumber(ARGV[3])
  if blockMs > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockMs)
    return { hits, hitsTtl, 1, blockMs }
  end
  return { hits, hitsTtl, 1, hitsTtl }
end
return { hits, hitsTtl, 0, 0 }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string = REDIS_KEYS.THROTTLE_PREFIX,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    const result = (await this.redis.eval(
      INCREMENT_SCRIPT,
      2,
      `${base}:hits`,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    const [totalHits, hitsTtlMs, blocked, blockTtlMs] = result;
    // @nestjs/throttler expects seconds for both expiry fields.
    return {
      totalHits,
      timeToExpire: Math.max(0, Math.ceil(hitsTtlMs / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockTtlMs / 1000)),
    };
  }
}
