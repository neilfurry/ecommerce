import { DEFAULT_LOYALTY_SETTINGS } from '@marketplace/validation';
import { describe, expect, it } from 'vitest';
import { addMonths, maxRedeemablePoints, pointsForAmount } from './engagement';
import { Prisma } from './generated/prisma/client';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('loyalty rules', () => {
  it('earns whole points per ₱100 of merchandise paid', () => {
    expect(pointsForAmount(D('999.99'), DEFAULT_LOYALTY_SETTINGS)).toBe(9);
    expect(pointsForAmount(D('100'), DEFAULT_LOYALTY_SETTINGS)).toBe(1);
    expect(pointsForAmount(D('-5'), DEFAULT_LOYALTY_SETTINGS)).toBe(0);
    expect(pointsForAmount(D('1000'), { ...DEFAULT_LOYALTY_SETTINGS, pesosPerPoint: '50' })).toBe(
      20,
    );
  });

  it('caps redemption at the balance and the share of the items', () => {
    expect(maxRedeemablePoints(500, D('1000'), DEFAULT_LOYALTY_SETTINGS)).toBe(200);
    expect(maxRedeemablePoints(50, D('1000'), DEFAULT_LOYALTY_SETTINGS)).toBe(50);
    // Points worth ₱0.50: twice as many fit under the 20% cap.
    expect(
      maxRedeemablePoints(1000, D('1000'), { ...DEFAULT_LOYALTY_SETTINGS, pointValue: '0.5' }),
    ).toBe(400);
    expect(
      maxRedeemablePoints(500, D('1000'), { ...DEFAULT_LOYALTY_SETTINGS, enabled: false }),
    ).toBe(0);
  });

  it('expires points in calendar months (end of month clamped)', () => {
    expect(addMonths(new Date('2026-01-31T03:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T03:00:00.000Z',
    );
    expect(addMonths(new Date('2026-12-15T00:00:00Z'), 12).toISOString()).toBe(
      '2027-12-15T00:00:00.000Z',
    );
  });
});
