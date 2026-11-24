import { REDIS_KEYS } from '@marketplace/config';
import { type Job, UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import { WorkerConfig } from '../config/worker-config';
import type { MailerService } from '../mail/mailer.service';
import { DevSampleHandler } from './dev-sample.handler';
import { DevTestEmailHandler } from './dev-test-email.handler';
import { HeartbeatHandler } from './heartbeat.handler';

const configWith = (env: Record<string, string>) =>
  WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379', APP_VERSION: '1.2.3', ...env }, false);
const devConfig = configWith({ DEV_TOOLS_ENABLED: 'true' });
const prodLikeConfig = configWith({ DEV_TOOLS_ENABLED: 'false' });

function fakeJob(data: unknown, attemptsMade = 0) {
  return {
    id: '42',
    data,
    attemptsMade,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job & { updateProgress: jest.Mock };
}

describe('HeartbeatHandler', () => {
  it('stores a heartbeat with a TTL', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const result = await new HeartbeatHandler(devConfig, { set } as unknown as Redis).handle();
    expect(result.version).toBe('1.2.3');
    expect(set).toHaveBeenCalledWith(
      REDIS_KEYS.WORKER_HEARTBEAT,
      JSON.stringify(result),
      'EX',
      expect.any(Number),
    );
  });
});

describe('DevSampleHandler', () => {
  const handler = new DevSampleHandler(devConfig);

  it('fails on the first N attempts, then succeeds and reports progress', async () => {
    const data = { message: 'hello', simulateFailures: 2, durationMs: 0 };
    await expect(handler.handle(fakeJob(data, 0))).rejects.toThrow(/attempt 1 of 2/);
    await expect(handler.handle(fakeJob(data, 1))).rejects.toThrow(/attempt 2 of 2/);
    const job = fakeJob(data, 2);
    const result = await handler.handle(job);
    expect(result).toMatchObject({ message: 'hello', attempt: 3 });
    expect(job.updateProgress).toHaveBeenLastCalledWith(100);
  });

  it('rejects invalid payloads without retrying', async () => {
    await expect(handler.handle(fakeJob({ message: '' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('refuses to run when developer tools are disabled', async () => {
    await expect(
      new DevSampleHandler(prodLikeConfig).handle(fakeJob({ message: 'x' })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('DevTestEmailHandler', () => {
  it('sends the test email through the mailer', async () => {
    const send = jest.fn().mockResolvedValue({ messageId: '<m1>', accepted: ['a@example.ph'] });
    const handler = new DevTestEmailHandler(devConfig, { send } as unknown as MailerService);
    await expect(handler.handle(fakeJob({ to: 'a@example.ph' }))).resolves.toEqual({
      messageId: '<m1>',
      accepted: ['a@example.ph'],
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.ph', subject: expect.stringContaining('job 42') }),
    );
  });

  it('lets SMTP errors propagate so the email retry policy applies', async () => {
    const send = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const handler = new DevTestEmailHandler(devConfig, { send } as unknown as MailerService);
    const error = await handler.handle(fakeJob({ to: 'a@example.ph' })).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects invalid addresses without retrying', async () => {
    const handler = new DevTestEmailHandler(devConfig, {
      send: jest.fn(),
    } as unknown as MailerService);
    await expect(handler.handle(fakeJob({ to: 'nope' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
