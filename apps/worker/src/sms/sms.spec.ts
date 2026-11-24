import { REDIS_KEYS } from '@marketplace/config';
import type { Redis } from 'ioredis';
import { MockSmsProvider, MOCK_OUTBOX_SIZE } from './mock-sms.provider';
import { SEMAPHORE_PRIORITY_URL, SemaphoreSmsProvider } from './semaphore-sms.provider';
import { maskNumber, PermanentSmsError } from './sms-provider';

describe('maskNumber', () => {
  it('hides the middle digits', () => {
    expect(maskNumber('+639171234567')).toBe('+63 917 *** 4567');
  });
});

describe('MockSmsProvider', () => {
  it('pushes the message to the capped development outbox', async () => {
    const calls: unknown[][] = [];
    const chain = {
      lpush: (...args: unknown[]) => (calls.push(['lpush', ...args]), chain),
      ltrim: (...args: unknown[]) => (calls.push(['ltrim', ...args]), chain),
      exec: async () => [],
    };
    const provider = new MockSmsProvider({ multi: () => chain } as unknown as Redis);
    const result = await provider.send({ to: '+639171234567', body: 'hello' });
    expect(result).toEqual({ provider: 'mock', messageId: null });
    expect(calls[0]?.[1]).toBe(REDIS_KEYS.DEV_SMS_OUTBOX);
    expect(JSON.parse(calls[0]?.[2] as string)).toMatchObject({
      to: '+639171234567',
      body: 'hello',
    });
    expect(calls[1]).toEqual(['ltrim', REDIS_KEYS.DEV_SMS_OUTBOX, 0, MOCK_OUTBOX_SIZE - 1]);
  });
});

describe('SemaphoreSmsProvider', () => {
  const reply = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    });

  it('posts a form-encoded priority message without the plus sign', async () => {
    const fetchImpl = reply(200, [{ message_id: 123, status: 'Queued' }]);
    const provider = new SemaphoreSmsProvider('secret-key', 'MARKETPLACE', fetchImpl);
    await expect(
      provider.send({ to: '+639171234567', body: '123456 is your code' }),
    ).resolves.toEqual({
      provider: 'semaphore',
      messageId: '123',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toBe(SEMAPHORE_PRIORITY_URL);
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init.body);
    expect(Object.fromEntries(form)).toEqual({
      apikey: 'secret-key',
      number: '639171234567',
      message: '123456 is your code',
      sendername: 'MARKETPLACE',
    });
  });

  it('treats a rejected key or a validation reply as permanent', async () => {
    await expect(
      new SemaphoreSmsProvider('k', undefined, reply(401, {})).send({
        to: '+639171234567',
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(PermanentSmsError);
    await expect(
      new SemaphoreSmsProvider(
        'k',
        undefined,
        reply(200, { number: ['The number format is invalid.'] }),
      ).send({ to: '+639171234567', body: 'x' }),
    ).rejects.toBeInstanceOf(PermanentSmsError);
  });

  it('treats outages, throttling and network errors as transient (retried)', async () => {
    for (const fetchImpl of [
      reply(503, {}),
      reply(429, {}),
      jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    ]) {
      const error = await new SemaphoreSmsProvider('k', undefined, fetchImpl)
        .send({ to: '+639171234567', body: 'x' })
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PermanentSmsError);
    }
  });

  it('never puts the API key in error messages', async () => {
    const error = (await new SemaphoreSmsProvider('super-secret', undefined, reply(500, {}))
      .send({ to: '+639171234567', body: 'x' })
      .catch((e: Error) => e)) as Error;
    expect(error.message).not.toContain('super-secret');
  });
});
