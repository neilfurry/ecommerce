import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BULLMQ_PREFIX, QUEUE_NAMES } from '@marketplace/config';
import { LoggerModule } from 'nestjs-pino';
import { WorkerConfig } from './config/worker-config';
import { WorkerConfigModule } from './config/worker-config.module';
import { HeartbeatScheduler } from './heartbeat/heartbeat.scheduler';
import { SystemProcessor } from './heartbeat/system.processor';
import { redisClientProvider, RedisShutdown } from './redis.provider';

/**
 * Root module of the worker process. Each business domain adds its processor here as
 * later phases introduce queues (notifications, settlements, reports...).
 */
@Module({
  imports: [
    WorkerConfigModule,
    LoggerModule.forRootAsync({
      imports: [WorkerConfigModule],
      inject: [WorkerConfig],
      useFactory: (config: WorkerConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          base: { service: 'worker' },
          transport:
            config.nodeEnv === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:standard' },
                }
              : undefined,
        },
      }),
    }),
    BullModule.forRootAsync({
      imports: [WorkerConfigModule],
      inject: [WorkerConfig],
      useFactory: (config: WorkerConfig) => ({
        connection: { url: config.redisUrl, maxRetriesPerRequest: null },
        prefix: BULLMQ_PREFIX,
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SYSTEM }),
  ],
  providers: [redisClientProvider, RedisShutdown, SystemProcessor, HeartbeatScheduler],
})
export class WorkerModule {}
