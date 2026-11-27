import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BULLMQ_PREFIX, defaultJobOptions, QUEUE_NAMES } from '@marketplace/config';
import { LoggerModule } from 'nestjs-pino';
import { WorkerConfig } from './config/worker-config';
import { WorkerConfigModule } from './config/worker-config.module';
import { DevSampleHandler } from './jobs/dev-sample.handler';
import { DevTestEmailHandler } from './jobs/dev-test-email.handler';
import { HeartbeatHandler } from './jobs/heartbeat.handler';
import { WorkerDatabase } from './database/database.provider';
import { HeartbeatScheduler } from './jobs/heartbeat.scheduler';
import {
  ReleaseExpiredReservationsHandler,
  ReservationSweepScheduler,
} from './jobs/reservation-sweep';
import {
  CompleteDeliveredHandler,
  EscalateOverdueReturnsHandler,
  FulfilmentSweepScheduler,
} from './jobs/fulfilment-sweep';
import { SettlementScheduler, SettleSellersHandler } from './jobs/settlement';
import {
  PaymentReconciler,
  PaymentReconciliationScheduler,
  ReconcileOpenPaymentsHandler,
} from './jobs/payment-reconciliation';
import { SmsOtpHandler } from './jobs/sms-otp.handler';
import { ExpireLoyaltyPointsHandler, LoyaltyExpiryScheduler } from './jobs/loyalty-expiry';
import {
  NotificationDispatcher,
  NotificationDispatchHandler,
  NotificationSweepHandler,
  NotificationSweepScheduler,
} from './notifications/notification-dispatcher';
import { MockPushProvider, PushProvider } from './notifications/push-provider';
import { ExpireUnpaidOrdersHandler, UnpaidOrderSweepScheduler } from './jobs/unpaid-order-sweep';
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
    WorkerDatabase,
    ReleaseExpiredReservationsHandler,
    ReservationSweepScheduler,
    ExpireUnpaidOrdersHandler,
    UnpaidOrderSweepScheduler,
    PaymentReconciler,
    ReconcileOpenPaymentsHandler,
    PaymentReconciliationScheduler,
    CompleteDeliveredHandler,
    EscalateOverdueReturnsHandler,
    FulfilmentSweepScheduler,
    SettleSellersHandler,
    SettlementScheduler,
    ExpireLoyaltyPointsHandler,
    LoyaltyExpiryScheduler,
    { provide: PushProvider, useClass: MockPushProvider },
    NotificationDispatcher,
    NotificationDispatchHandler,
    NotificationSweepHandler,
    NotificationSweepScheduler,
    ...DOMAIN_PROCESSORS,
  ],
})
export class WorkerModule {}
