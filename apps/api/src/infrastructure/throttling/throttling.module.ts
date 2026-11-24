import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Global per-IP rate limit backed by Redis. Individual routes can tighten it with
 * @Throttle({ default: { limit, ttl } }) (e.g. login in Phase 2) or opt out with @SkipThrottle().
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfig, REDIS_CLIENT],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimit.windowSeconds * 1000,
            limit: config.rateLimit.maxRequests,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottlingModule {}
