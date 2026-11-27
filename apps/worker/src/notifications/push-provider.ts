import { Injectable, Logger } from '@nestjs/common';

export interface PushMessage {
  endpoint: string;
  title: string;
  body: string;
  link: string | null;
}

/**
 * Web Push port. The mock provider logs instead of sending; a VAPID-signed provider replaces
 * it once keys are configured (ADR 0033). Endpoints are never logged in full.
 */
export abstract class PushProvider {
  abstract readonly name: string;
  abstract send(message: PushMessage): Promise<void>;
}

export const maskEndpoint = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    return `${url.host}/…${endpoint.slice(-6)}`;
  } catch {
    return '…';
  }
};

@Injectable()
export class MockPushProvider extends PushProvider {
  readonly name = 'mock-push';
  private readonly logger = new Logger(MockPushProvider.name);
  /** Kept in memory for tests. */
  readonly sent: PushMessage[] = [];

  async send(message: PushMessage): Promise<void> {
    this.sent.push(message);
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`[mock push] ${maskEndpoint(message.endpoint)}: ${message.title}`);
  }
}
