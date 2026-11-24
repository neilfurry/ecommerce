import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { envBoolean, envInteger, envOriginList, formatEnvIssues, redisUrlSchema } from './env';

describe('envBoolean', () => {
  const schema = envBoolean(false);

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['off', false],
  ])('parses %s', (input, expected) => {
    expect(schema.parse(input)).toBe(expected);
  });

  it('uses the default when unset', () => {
    expect(schema.parse(undefined)).toBe(false);
    expect(envBoolean(true).parse(undefined)).toBe(true);
  });

  it('rejects other strings', () => {
    expect(schema.safeParse('maybe').success).toBe(false);
  });
});

describe('envInteger', () => {
  it('coerces and bounds values', () => {
    const schema = envInteger(3000, 1, 65535);
    expect(schema.parse('8080')).toBe(8080);
    expect(schema.parse(undefined)).toBe(3000);
    expect(schema.safeParse('70000').success).toBe(false);
    expect(schema.safeParse('3.5').success).toBe(false);
  });
});

describe('envOriginList', () => {
  it('splits and trims a comma-separated list', () => {
    expect(envOriginList.parse('http://localhost:5173, https://shop.example.ph')).toEqual([
      'http://localhost:5173',
      'https://shop.example.ph',
    ]);
  });

  it('rejects origins with paths or non-http schemes', () => {
    expect(envOriginList.safeParse('http://localhost:5173/app').success).toBe(false);
    expect(envOriginList.safeParse('ftp://example.com').success).toBe(false);
  });
});

describe('redisUrlSchema', () => {
  it('accepts redis and rediss URLs only', () => {
    expect(redisUrlSchema.safeParse('redis://localhost:6379').success).toBe(true);
    expect(redisUrlSchema.safeParse('rediss://cache.example:6380').success).toBe(true);
    expect(redisUrlSchema.safeParse('http://localhost:6379').success).toBe(false);
  });
});

describe('formatEnvIssues', () => {
  it('lists each failing variable without echoing its value', () => {
    const result = z.object({ SECRET: z.string().min(32) }).safeParse({ SECRET: 'hunter2' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatEnvIssues(result.error);
      expect(message).toContain('SECRET');
      expect(message).not.toContain('hunter2');
    }
  });
});
