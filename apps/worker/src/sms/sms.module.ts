import type { Provider } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { WorkerConfig } from '../config/worker-config';
import { REDIS_CLIENT } from '../redis.provider';
import { MockSmsProvider } from './mock-sms.provider';
import { SemaphoreSmsProvider } from './semaphore-sms.provider';
import { SmsProvider } from './sms-provider';

/** Chooses the SMS gateway from SMS_PROVIDER. */
export const smsProvider: Provider = {
  provide: SmsProvider,
  inject: [WorkerConfig, REDIS_CLIENT],
  useFactory: (config: WorkerConfig, redis: Redis): SmsProvider =>
    config.sms.provider === 'semaphore'
      ? new SemaphoreSmsProvider(config.sms.semaphoreApiKey!, config.sms.semaphoreSenderName)
      : new MockSmsProvider(redis),
};
