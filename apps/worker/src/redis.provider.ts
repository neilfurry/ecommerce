import { Inject, Injectable, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { WorkerConfig } from './config/worker-config';

/** DI token for the worker's general-purpose Redis client (not the BullMQ connections). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [WorkerConfig],
  useFactory: (config: WorkerConfig) =>
    new Redis(config.redisUrl, { connectionName: 'marketplace-worker', maxRetriesPerRequest: 2 }),
};

@Injectable()
export class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
