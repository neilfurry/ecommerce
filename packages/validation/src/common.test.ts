import { describe, expect, it } from 'vitest';
import {
  currencyCodeSchema,
  decimalStringSchema,
  moneySchema,
  paginationQuerySchema,
} from './common';

describe('decimalStringSchema', () => {
  const amount = decimalStringSchema();

  it.each(['0', '1', '10', '1499.5', '1499.50', '999999999999999.99'])('accepts %s', (value) => {
    expect(amount.safeParse(value).success).toBe(true);
  });

  it.each([
    ['too many decimals', '1.999'],
    ['negative when not allowed', '-1.00'],
    ['leading zeros', '007'],
    ['exponent notation', '1e5'],
    ['empty string', ''],
    ['trailing dot', '1.'],
    ['whitespace', ' 1.00'],
    ['too many integer digits', '1234567890123456'],
  ])('rejects %s', (_label, value) => {
    expect(amount.safeParse(value).success).toBe(false);
  });

  it('rejects JavaScript numbers to prevent floating-point money', () => {
    expect(amount.safeParse(1499.5).success).toBe(false);
  });

  it('honours allowNegative and scale options', () => {
    const adjustment = decimalStringSchema({ allowNegative: true, scale: 4 });
    expect(adjustment.safeParse('-12.3456').success).toBe(true);
    expect(adjustment.safeParse('-12.34567').success).toBe(false);
    const whole = decimalStringSchema({ scale: 0 });
    expect(whole.safeParse('12').success).toBe(true);
    expect(whole.safeParse('12.0').success).toBe(false);
  });
});

describe('currencyCodeSchema', () => {
  it('accepts upper-case ISO codes', () => {
    expect(currencyCodeSchema.safeParse('PHP').success).toBe(true);
  });

  it.each(['php', 'PH', 'PESO', '123'])('rejects %s', (value) => {
    expect(currencyCodeSchema.safeParse(value).success).toBe(false);
  });
});

describe('moneySchema', () => {
  it('parses a valid money object', () => {
    expect(moneySchema.parse({ amount: '250.00', currency: 'PHP' })).toEqual({
      amount: '250.00',
      currency: 'PHP',
    });
  });
});

describe('paginationQuerySchema', () => {
  it('applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces query-string values', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('caps the page size', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('rejects page 0', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});
