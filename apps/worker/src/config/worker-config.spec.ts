import { WorkerConfig } from './worker-config';

describe('WorkerConfig.load', () => {
  it('applies defaults', () => {
    const config = WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379' }, false);
    expect(config.concurrencyOverride).toBeUndefined();
    expect(config.heartbeatIntervalSeconds).toBe(15);
    expect(config.nodeEnv).toBe('development');
    expect(config.devToolsEnabled).toBe(false);
    expect(config.smtp).toMatchObject({ host: 'localhost', port: 1025, secure: false });
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('treats empty SMTP credentials as unset', () => {
    const config = WorkerConfig.load(
      { REDIS_URL: 'redis://localhost:6379', SMTP_USER: '', SMTP_PASSWORD: '' },
      false,
    );
    expect(config.smtp.user).toBeUndefined();
    expect(config.smtp.password).toBeUndefined();
  });

  it('rejects an invalid Redis URL and out-of-range concurrency', () => {
    const attempt = () =>
      WorkerConfig.load({ REDIS_URL: 'localhost', WORKER_CONCURRENCY: '0' }, false);
    expect(attempt).toThrow(/REDIS_URL/);
    expect(attempt).toThrow(/WORKER_CONCURRENCY/);
  });

  it('refuses developer tools in production', () => {
    expect(() =>
      WorkerConfig.load(
        { REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'production', DEV_TOOLS_ENABLED: 'true' },
        false,
      ),
    ).toThrow(/DEV_TOOLS_ENABLED/);
  });

  it('defaults to the mock SMS provider outside production', () => {
    expect(WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379' }, false).sms.provider).toBe(
      'mock',
    );
  });

  it('refuses the mock SMS provider in production', () => {
    expect(() =>
      WorkerConfig.load(
        { REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'production', SMS_PROVIDER: 'mock' },
        false,
      ),
    ).toThrow(/SMS_PROVIDER/);
  });

  it('requires an API key for Semaphore', () => {
    expect(() =>
      WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379', SMS_PROVIDER: 'semaphore' }, false),
    ).toThrow(/SEMAPHORE_API_KEY/);
    const config = WorkerConfig.load(
      {
        REDIS_URL: 'redis://localhost:6379',
        SMS_PROVIDER: 'semaphore',
        SEMAPHORE_API_KEY: 'k',
        SEMAPHORE_SENDER_NAME: 'MARKETPLACE',
      },
      false,
    );
    expect(config.sms).toEqual({
      provider: 'semaphore',
      semaphoreApiKey: 'k',
      semaphoreSenderName: 'MARKETPLACE',
    });
  });

  it('requires the database in production (reservations expire through the worker)', () => {
    expect(() =>
      WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'production' }, false),
    ).toThrow(/DATABASE_URL/);
    const config = WorkerConfig.load(
      {
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      },
      false,
    );
    expect(config.databaseUrl).toBe('postgresql://u:p@localhost:5432/db');
  });

  it('refuses development mail settings and PayMongo test keys in production', () => {
    const production = {
      REDIS_URL: 'redis://redis:6379',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db:5432/db',
      SMS_PROVIDER: 'semaphore',
      SEMAPHORE_API_KEY: 'k',
      SMTP_HOST: 'smtp.example.ph',
      MAIL_FROM: 'Marketplace <no-reply@example.ph>',
      PAYMONGO_SECRET_KEY: 'sk_live_abc',
      PAYMONGO_WEBHOOK_SECRET: 'whsk_abc',
    };
    expect(WorkerConfig.load(production, false).nodeEnv).toBe('production');
    expect(() => WorkerConfig.load({ ...production, SMTP_HOST: 'localhost' }, false)).toThrow(
      /SMTP_HOST/,
    );
    const testKey = { ...production, PAYMONGO_SECRET_KEY: 'sk_test_abc' };
    expect(() => WorkerConfig.load(testKey, false)).toThrow(/PAYMONGO_SECRET_KEY/);
    expect(WorkerConfig.load({ ...testKey, ALLOW_TEST_PAYMENTS: 'true' }, false).nodeEnv).toBe(
      'production',
    );
  });
});
