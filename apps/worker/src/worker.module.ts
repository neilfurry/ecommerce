import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BULLMQ_PREFIX, defaultJobOptions, QUEUE_NAMES } from '@marketplace/config';
import { LoggerModule } from 'nestjs-pino';
import { WorkerConfig } from './config/worker-config';
import { WorkerConfigModule } from './config/worker-config.module';
import { DevSampleHandler } from './jobs/dev-sample.handler';
import { DevTestEmailHandler } from './jobs/dev-test-email.handler';
import { HeartbeatHandler } from './jobs/heartbeat.handler';
import { HeartbeatScheduler } from './jobs/heartbeat.scheduler';
import { MailerService } from './mail/mailer.service';
import { DeadLetterService } from './queues/dead-letter.service';
import { DOMAIN_PROCESSORS } from './queues/processors';
import { redisClientProvider, RedisShutdown } from './redis.provider';

/**
 * Root module of the worker process: one processor per domain queue, job handlers,
 * dead-letter handling and the heartbeat schedule.
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
          redact: { paths: ['*.password', '*.token', '*.secret'], censor: '[REDACTED]' },
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
    BullModule.registerQueue(
      ...Object.values(QUEUE_NAMES).map((name) => ({
        name,
        defaultJobOptions: defaultJobOptions(name),
      })),
    ),
  ],
  providers: [
    redisClientProvider,
    RedisShutdown,
    MailerService,
    DeadLetterService,
    HeartbeatHandler,
    DevSampleHandler,
    DevTestEmailHandler,
    HeartbeatScheduler,
    ...DOMAIN_PROCESSORS,
  ],
})
export class WorkerModule {}
