import { describe, expect, it } from 'vitest';
import { createPgAdapter } from './pg-adapter';

describe('createPgAdapter', () => {
  it('creates an adapter for a URL with a schema parameter', () => {
    const adapter = createPgAdapter('postgresql://u:p@localhost:5432/db?schema=public');
    expect(adapter.provider).toBe('postgres');
  });

  it('creates an adapter for a URL without a schema parameter', () => {
    const adapter = createPgAdapter('postgresql://u:p@localhost:5432/db');
    expect(adapter.provider).toBe('postgres');
  });
});
