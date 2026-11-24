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
import { SmsOtpHandler } from './jobs/sms-otp.handler';
import { TRANSACTIONAL_EMAIL_HANDLERS } from './jobs/transactional-email.handlers';
import { MailerService } from './mail/mailer.service';
import { DeadLetterService } from './queues/dead-letter.service';
import { DOMAIN_PROCESSORS } from './queues/processors';
import { redisClientProvider, RedisShutdown } from './redis.provider';
import { smsProvider } from './sms/sms.module';

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
          redact: {
            paths: ['*.password', '*.token', '*.secret', '*.code', '*.apikey'],
            censor: '[REDACTED]',
          },
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
    ...TRANSACTIONAL_EMAIL_HANDLERS,
    smsProvider,
    SmsOtpHandler,
    HeartbeatScheduler,
    ...DOMAIN_PROCESSORS,
  ],
})
export class WorkerModule {}
