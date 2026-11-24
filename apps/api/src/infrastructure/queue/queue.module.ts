import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { BULLMQ_PREFIX } from '@marketplace/config';
import { AppConfig } from '../../config/app-config';

/**
 * BullMQ connection for producers. Domain modules register their own queues with
 * BullModule.registerQueue({ name: QUEUE_NAMES.X }); the worker app consumes them.
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
  ],
  exports: [BullModule],
})
export class QueueModule {}
