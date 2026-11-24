import { REDIS_KEYS } from '@marketplace/config';
import type { Redis } from 'ioredis';
import { type SmsMessage, SmsProvider, type SmsResult } from './sms-provider';

/** How many messages the development outbox keeps. */
export const MOCK_OUTBOX_SIZE = 50;

/**
 * DEVELOPMENT ONLY (refused in production by the worker configuration). Sends nothing:
 * stores each message in a capped Redis list that the Admin Console shows under
 * Developer tools > SMS outbox, so sign-up and sign-in codes can be read locally.
 */
export class MockSmsProvider extends SmsProvider {
  readonly name = 'mock';

  constructor(private readonly redis: Redis) {
    super();
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const entry = JSON.stringify({
      to: message.to,
      body: message.body,
      sentAt: new Date().toISOString(),
    });
    await this.redis
      .multi()
      .lpush(REDIS_KEYS.DEV_SMS_OUTBOX, entry)
      .ltrim(REDIS_KEYS.DEV_SMS_OUTBOX, 0, MOCK_OUTBOX_SIZE - 1)
      .exec();
    return { provider: this.name, messageId: null };
  }
}
