import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema } from './api-error';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  const valid = {
    status: 'degraded',
    version: '0.1.0',
    uptimeSeconds: 12.5,
    timestamp: '2026-11-24T09:00:00.000Z',
    components: [
      { name: 'database', status: 'up', critical: true, latencyMs: 3 },
      { name: 'worker', status: 'down', critical: false, latencyMs: null, message: 'No heartbeat' },
    ],
  };

  it('accepts a well-formed payload', () => {
    expect(healthResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown component name', () => {
    const bad = { ...valid, components: [{ ...valid.components[0], name: 'mainframe' }] };
    expect(healthResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    expect(healthResponseSchema.safeParse({ ...valid, timestamp: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('apiErrorBodySchema', () => {
  it('accepts the standard error envelope', () => {
    const body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        statusCode: 400,
        requestId: 'abc',
        fieldErrors: [{ path: 'email', message: 'Invalid email' }],
      },
    };
    expect(apiErrorBodySchema.safeParse(body).success).toBe(true);
  });

  it('rejects unknown error codes', () => {
    const body = { error: { code: 'OOPS', message: 'x', statusCode: 500 } };
    expect(apiErrorBodySchema.safeParse(body).success).toBe(false);
  });
});
