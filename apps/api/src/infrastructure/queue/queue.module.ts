import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Global, Injectable, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BULLMQ_PREFIX, defaultJobOptions, QUEUE_NAMES, type QueueName } from '@marketplace/config';
import type { Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config';

const QUEUE_REGISTRATIONS = Object.values(QUEUE_NAMES).map((name) => ({
  name,
  // Every producer enqueues with the queue's shared retry/backoff policy.
  defaultJobOptions: defaultJobOptions(name),
}));

/** Looks up any registered queue by name (for code that works across queues). */
@Injectable()
export class QueueRegistry {
  constructor(private readonly moduleRef: ModuleRef) {}

  get(name: QueueName): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
  }

  all(): Queue[] {
    return Object.values(QUEUE_NAMES).map((name) => this.get(name));
  }
}

/**
 * BullMQ producers for every domain queue. Domain services inject a queue with
 * @InjectQueue(QUEUE_NAMES.X) and add jobs; the worker app consumes them.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.redis.url, maxRetriesPerRequest: null },
        prefix: BULLMQ_PREFIX,
      }),
    }),
    BullModule.registerQueue(...QUEUE_REGISTRATIONS),
  ],
  providers: [QueueRegistry],
  exports: [BullModule, QueueRegistry],
})
export class QueueModule {}
