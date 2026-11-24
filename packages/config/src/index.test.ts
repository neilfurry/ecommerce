import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, REDIS_KEYS } from './index';

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
});
