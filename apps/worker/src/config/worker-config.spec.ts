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
});
