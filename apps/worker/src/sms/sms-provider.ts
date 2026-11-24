/** One outgoing text message. `to` is E.164 (+639XXXXXXXXX). */
export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsResult {
  provider: string;
  /** The provider's message id, when it returns one. */
  messageId: string | null;
}

/**
 * Port for SMS gateways. Implementations throw a normal Error for transient failures (the
 * job is retried) and a PermanentSmsError for failures retrying cannot fix.
 */
export abstract class SmsProvider {
  abstract readonly name: string;
  abstract send(message: SmsMessage): Promise<SmsResult>;
}

export class PermanentSmsError extends Error {
  override readonly name = 'PermanentSmsError';
}

/** +639171234567 -> +63 917 *** 4567, for logs. */
export function maskNumber(e164: string): string {
  const local = e164.replace(/^\+63/, '');
  return `+63 ${local.slice(0, 3)} *** ${local.slice(-4)}`;
}
