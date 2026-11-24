import { WorkerConfig } from './worker-config';

describe('WorkerConfig.load', () => {
  it('applies defaults', () => {
    const config = WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379' }, false);
    expect(config.concurrency).toBe(5);
    expect(config.heartbeatIntervalSeconds).toBe(15);
    expect(config.nodeEnv).toBe('development');
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects an invalid Redis URL and out-of-range concurrency', () => {
    const attempt = () =>
      WorkerConfig.load({ REDIS_URL: 'localhost', WORKER_CONCURRENCY: '0' }, false);
    expect(attempt).toThrow(/REDIS_URL/);
    expect(attempt).toThrow(/WORKER_CONCURRENCY/);
  });
});
