import { Logger } from '@nestjs/common';
import { REDIS_KEYS, SYSTEM_JOBS } from '@marketplace/config';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { WorkerConfig } from '../config/worker-config';
import { SystemProcessor } from './system.processor';

describe('SystemProcessor', () => {
  const config = WorkerConfig.load(
    { REDIS_URL: 'redis://localhost:6379', APP_VERSION: '1.2.3' },
    false,
  );
  const set = jest.fn().mockResolvedValue('OK');
  const processor = new SystemProcessor(config, { set } as unknown as Redis);

  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => set.mockClear());

  it('records a heartbeat with a TTL for heartbeat jobs', async () => {
    const result = await processor.process({ name: SYSTEM_JOBS.HEARTBEAT } as Job);
    expect(result.version).toBe('1.2.3');
    expect(Date.parse(result.at)).not.toBeNaN();
    expect(set).toHaveBeenCalledWith(
      REDIS_KEYS.WORKER_HEARTBEAT,
      JSON.stringify(result),
      'EX',
      expect.any(Number),
    );
  });

  it('fails unknown jobs instead of silently dropping them', async () => {
    await expect(processor.process({ name: 'system.unknown' } as Job)).rejects.toThrow(
      /Unknown job "system.unknown"/,
    );
    expect(set).not.toHaveBeenCalled();
  });
});
