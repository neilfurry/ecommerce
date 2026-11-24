import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, REDIS_KEYS, SYSTEM_JOBS } from './index';

describe('@marketplace/config', () => {
  it('namespaces every Redis key under "marketplace:"', () => {
    for (const key of Object.values(REDIS_KEYS)) {
      expect(key.startsWith('marketplace:')).toBe(true);
    }
  });

  it('uses unique queue names', () => {
    const names = Object.values(QUEUE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });

  it('prefixes system job names with the queue domain', () => {
    for (const job of Object.values(SYSTEM_JOBS)) {
      expect(job.startsWith(`${QUEUE_NAMES.SYSTEM}.`)).toBe(true);
    }
  });
});
