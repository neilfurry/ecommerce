import { describe, expect, it } from 'vitest';
import {
  defaultJobOptions,
  EMAIL_JOBS,
  QUEUE_DEFINITIONS,
  QUEUE_NAMES,
  SYSTEM_JOBS,
} from './queues';

describe('queue registry', () => {
  it('defines every queue required by the platform', () => {
    expect(Object.values(QUEUE_NAMES).sort()).toEqual(
      [
        'dead-letter',
        'email',
        'image-processing',
        'notifications',
        'order-processing',
        'payment-events',
        'reports',
        'system',
      ].sort(),
    );
  });

  it('keys each definition by its own name', () => {
    for (const [key, definition] of Object.entries(QUEUE_DEFINITIONS)) {
      expect(definition.name).toBe(key);
    }
  });

  it('gives processed queues exponential backoff with at least one retry', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      if (name === QUEUE_NAMES.DEAD_LETTER) continue;
      const options = defaultJobOptions(name);
      expect(options.attempts).toBeGreaterThan(1);
      expect(options).toMatchObject({ backoff: { type: 'exponential' } });
    }
  });

  it('retries payment events more than any other queue', () => {
    const max = Math.max(...Object.values(QUEUE_DEFINITIONS).map((d) => d.attempts));
    expect(QUEUE_DEFINITIONS['payment-events'].attempts).toBe(max);
  });

  it('never auto-removes dead letters', () => {
    expect(defaultJobOptions(QUEUE_NAMES.DEAD_LETTER)).toEqual({
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
  });

  it('namespaces job names by queue', () => {
    for (const job of Object.values(SYSTEM_JOBS)) expect(job.startsWith('system.')).toBe(true);
    for (const job of Object.values(EMAIL_JOBS)) expect(job.startsWith('email.')).toBe(true);
  });
});
