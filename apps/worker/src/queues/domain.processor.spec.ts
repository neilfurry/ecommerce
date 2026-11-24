import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { WorkerConfig } from '../config/worker-config';
import type { DeadLetterService } from './dead-letter.service';
import { isFinalFailure } from './dead-letter.service';
import { DomainProcessor } from './domain.processor';
import type { JobHandler } from './job-handler';

class TestProcessor extends DomainProcessor {
  constructor(handlers: JobHandler[]) {
    super(
      'reports',
      handlers,
      WorkerConfig.load({ REDIS_URL: 'redis://localhost:6379' }, false),
      {} as DeadLetterService,
    );
  }
}

const job = (overrides: Partial<Job>) =>
  ({ name: 'x', attemptsMade: 0, opts: {}, ...overrides }) as Job;

describe('DomainProcessor', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('routes jobs to the handler registered for their name', async () => {
    const handle = jest.fn().mockResolvedValue('done');
    const processor = new TestProcessor([{ jobName: 'reports.build', handle }]);
    await expect(processor.process(job({ name: 'reports.build' }))).resolves.toBe('done');
    expect(handle).toHaveBeenCalledTimes(1);
    expect(processor.handledJobNames).toEqual(['reports.build']);
  });

  it('fails unknown jobs with an unrecoverable error (no pointless retries)', async () => {
    const processor = new TestProcessor([]);
    await expect(processor.process(job({ name: 'reports.unknown' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});

describe('isFinalFailure', () => {
  it('is false while attempts remain', () => {
    expect(isFinalFailure(job({ attemptsMade: 1, opts: { attempts: 3 } }), new Error('x'))).toBe(
      false,
    );
  });

  it('is true once all attempts are used', () => {
    expect(isFinalFailure(job({ attemptsMade: 3, opts: { attempts: 3 } }), new Error('x'))).toBe(
      true,
    );
  });

  it('is true immediately for unrecoverable errors', () => {
    expect(
      isFinalFailure(job({ attemptsMade: 1, opts: { attempts: 5 } }), new UnrecoverableError('x')),
    ).toBe(true);
  });

  it('treats jobs without an attempts option as single-attempt', () => {
    expect(isFinalFailure(job({ attemptsMade: 1 }), new Error('x'))).toBe(true);
  });
});
