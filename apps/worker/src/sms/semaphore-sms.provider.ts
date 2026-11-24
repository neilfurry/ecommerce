import { PermanentSmsError, type SmsMessage, SmsProvider, type SmsResult } from './sms-provider';

export const SEMAPHORE_PRIORITY_URL = 'https://api.semaphore.co/api/v4/priority';

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Semaphore (semaphore.co), a Philippine SMS gateway. One-time codes go through the
 * priority endpoint, which skips Semaphore's normal queue (2 credits per message).
 * Request: form-encoded apikey, number, message and optional sendername.
 */
export class SemaphoreSmsProvider extends SmsProvider {
  readonly name = 'semaphore';

  constructor(
    private readonly apiKey: string,
    private readonly senderName: string | undefined,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 10_000,
  ) {
    super();
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    const form = new URLSearchParams({
      apikey: this.apiKey,
      // Semaphore expects local or 63-prefixed numbers without the plus sign.
      number: message.to.replace(/^\+/, ''),
      message: message.body,
    });
    if (this.senderName) form.set('sendername', this.senderName);

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(SEMAPHORE_PRIORITY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Semaphore request failed: ${(error as Error).message}`, { cause: error });
    }

    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new PermanentSmsError(`Semaphore rejected the API key (HTTP ${response.status})`);
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      // The body never contains the API key; it may echo the message, so it is not logged.
      throw new PermanentSmsError(`Semaphore rejected the message (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error(`Semaphore is unavailable (HTTP ${response.status})`);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('Semaphore returned an unreadable response');
    }
    const first = Array.isArray(body)
      ? (body[0] as { message_id?: unknown; status?: unknown } | undefined)
      : undefined;
    if (!first || first.message_id === undefined) {
      // Validation errors come back as an object of field messages with HTTP 200.
      throw new PermanentSmsError('Semaphore did not accept the message');
    }
    if (typeof first.status === 'string' && /fail|refund/i.test(first.status)) {
      throw new Error(`Semaphore reported status ${first.status}`);
    }
    return { provider: this.name, messageId: String(first.message_id) };
  }
}
