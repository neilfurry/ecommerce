import { describe, expect, it } from 'vitest';
import {
  devSampleJobRequestSchema,
  devTestEmailRequestSchema,
  paginatedSchema,
  storedFileSchema,
} from './dev-tools';
import { z } from 'zod';

describe('devSampleJobRequestSchema', () => {
  it('applies defaults and trims the message', () => {
    expect(devSampleJobRequestSchema.parse({ message: '  hello  ' })).toEqual({
      message: 'hello',
      simulateFailures: 0,
      durationMs: 500,
    });
  });

  it('coerces form strings', () => {
    expect(
      devSampleJobRequestSchema.parse({ message: 'x', simulateFailures: '2', durationMs: '100' }),
    ).toMatchObject({ simulateFailures: 2, durationMs: 100 });
  });

  it.each([
    [{ message: '' }],
    [{ message: 'x'.repeat(201) }],
    [{ message: 'x', simulateFailures: 6 }],
    [{ message: 'x', durationMs: 10_001 }],
    [{ message: 'x', simulateFailures: 1.5 }],
  ])('rejects %j', (input) => {
    expect(devSampleJobRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe('devTestEmailRequestSchema', () => {
  it('requires a valid email', () => {
    expect(devTestEmailRequestSchema.safeParse({ to: 'buyer@example.ph' }).success).toBe(true);
    expect(devTestEmailRequestSchema.safeParse({ to: 'not-an-email' }).success).toBe(false);
  });
});

describe('paginatedSchema', () => {
  it('wraps an item schema in the list envelope', () => {
    const schema = paginatedSchema(z.object({ id: z.string() }));
    expect(
      schema.safeParse({
        items: [{ id: 'a' }],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ items: [], page: 0, pageSize: 20, totalItems: 0, totalPages: 0 }).success,
    ).toBe(false);
  });
});

describe('storedFileSchema', () => {
  it('requires a hex SHA-256 checksum', () => {
    const file = {
      id: '0192f0a4-7b7c-7cc4-9a51-1f3a2b4c5d6e',
      originalName: 'receipt.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      checksumSha256: 'a'.repeat(64),
      purpose: 'DEV_TEST',
      status: 'AVAILABLE',
      createdAt: '2026-11-24T09:00:00.000Z',
      updatedAt: '2026-11-24T09:00:00.000Z',
    };
    expect(storedFileSchema.safeParse(file).success).toBe(true);
    expect(storedFileSchema.safeParse({ ...file, checksumSha256: 'xyz' }).success).toBe(false);
  });
});
