import { Prisma } from '@marketplace/database';

export type Decimal = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);
export const D = (value: string | number | Decimal) => new Prisma.Decimal(value);

/** Rounds to centavos, half up. */
export const cents = (value: Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const sum = (values: Decimal[]) => values.reduce((a, b) => a.plus(b), ZERO);
export const min = (a: Decimal, b: Decimal) => (a.lessThan(b) ? a : b);

/**
 * Splits an amount (in centavos) across weights so the parts add up exactly: each part is
 * rounded down, then the leftover centavos go to the largest remainders (ties: earliest).
 */
export function allocate(total: Decimal, weights: Decimal[]): Decimal[] {
  const totalCents = cents(total).times(100).toNumber();
  const weightSum = sum(weights);
  if (totalCents === 0 || weightSum.isZero()) return weights.map(() => ZERO);
  const exact = weights.map((w) => w.times(totalCents).dividedBy(weightSum));
  const floors = exact.map((e) => e.floor().toNumber());
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, index) => ({ index, remainder: e.minus(e.floor()).toNumber() }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors.map((f) => D(f).dividedBy(100));
}

/** VAT contained in a VAT-inclusive amount: amount × rate / (1 + rate). */
export const includedVat = (amount: Decimal, rate: Decimal) =>
  cents(amount.times(rate).dividedBy(rate.plus(1)));
