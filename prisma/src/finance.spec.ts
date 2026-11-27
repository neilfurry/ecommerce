import { DEFAULT_FINANCE_SETTINGS } from '@marketplace/validation';
import { describe, expect, it } from 'vitest';
import { commissionAmount, type CommissionRuleLike, resolveCommission } from './commission';
import { Prisma } from './generated/prisma/client';
import { allocateCents, lastClosedPeriod, periodContaining, splitInclusive } from './ledger';

const D = (v: string | number) => new Prisma.Decimal(v);
const T0 = new Date('2026-01-01T00:00:00Z');
let n = 0;
const rule = (
  r: Partial<CommissionRuleLike> & Pick<CommissionRuleLike, 'scope'>,
): CommissionRuleLike => ({
  id: `r${++n}`,
  type: 'PERCENTAGE',
  categoryId: null,
  sellerId: null,
  productId: null,
  ratePercent: D(0),
  fixedAmount: null,
  effectiveFrom: T0,
  effectiveTo: null,
  ...r,
});

describe('commission precedence', () => {
  const target = { productId: 'p1', sellerId: 's1', categoryPath: ['leaf', 'parent', 'root'] };
  const at = new Date('2026-06-01T00:00:00Z');
  const base = [
    rule({ scope: 'DEFAULT', ratePercent: D(5) }),
    rule({ scope: 'CATEGORY', categoryId: 'root', ratePercent: D(6) }),
    rule({ scope: 'CATEGORY', categoryId: 'parent', ratePercent: D(7) }),
  ];

  it('uses the nearest category, else the default', () => {
    expect(resolveCommission(base, target, at).ratePercent.toString()).toBe('7');
    expect(
      resolveCommission(base, { ...target, categoryPath: ['other'] }, at).ratePercent.toString(),
    ).toBe('5');
  });

  it('orders product > seller+category > seller > category > default', () => {
    const seller = rule({ scope: 'SELLER', sellerId: 's1', ratePercent: D(4) });
    const sellerCat = rule({
      scope: 'SELLER_CATEGORY',
      sellerId: 's1',
      categoryId: 'root',
      ratePercent: D(3),
    });
    const product = rule({ scope: 'PRODUCT', productId: 'p1', type: 'FIXED', fixedAmount: D(25) });
    expect(resolveCommission([...base, seller], target, at).ruleId).toBe(seller.id);
    expect(resolveCommission([...base, seller, sellerCat], target, at).ruleId).toBe(sellerCat.id);
    expect(resolveCommission([...base, seller, sellerCat, product], target, at).ruleId).toBe(
      product.id,
    );
    // Other sellers' and products' rules never match.
    const other = { ...target, sellerId: 's2', productId: 'p2' };
    expect(resolveCommission([...base, seller, sellerCat, product], other, at).ruleId).toBe(
      base[2]!.id,
    );
  });

  it('lets a matching exemption win over every other rule', () => {
    const product = rule({ scope: 'PRODUCT', productId: 'p1', ratePercent: D(9) });
    const exempt = rule({ scope: 'CATEGORY', categoryId: 'root', type: 'EXEMPT' });
    const resolved = resolveCommission([...base, product, exempt], target, at);
    expect(resolved).toMatchObject({ ruleId: exempt.id, type: 'EXEMPT' });
    expect(commissionAmount(resolved, D(1000), 1).toString()).toBe('0');
  });

  it('only uses rules in force at the time (start inclusive, end exclusive)', () => {
    const old = rule({ scope: 'SELLER', sellerId: 's1', ratePercent: D(2), effectiveTo: at });
    const next = rule({ scope: 'SELLER', sellerId: 's1', ratePercent: D(8), effectiveFrom: at });
    expect(resolveCommission([...base, old, next], target, new Date(at.getTime() - 1)).ruleId).toBe(
      old.id,
    );
    expect(resolveCommission([...base, old, next], target, at).ruleId).toBe(next.id);
  });

  it('returns no rule (0%) when nothing matches', () => {
    expect(resolveCommission([], target, at)).toMatchObject({ ruleId: null, ratePercent: D(0) });
  });
});

describe('commission amounts', () => {
  it('rounds percentages to the centavo (half up)', () => {
    expect(
      commissionAmount(
        { type: 'PERCENTAGE', ratePercent: D('7.5'), fixedAmount: null },
        D('333.33'),
        1,
      ).toFixed(2),
    ).toBe('25.00');
    expect(
      commissionAmount(
        { type: 'PERCENTAGE', ratePercent: D('5'), fixedAmount: null },
        D('0.10'),
        1,
      ).toFixed(2),
    ).toBe('0.01');
  });

  it('charges fixed amounts per unit, never more than the base', () => {
    const fixed = { type: 'FIXED' as const, ratePercent: D(0), fixedAmount: D('25') };
    expect(commissionAmount(fixed, D(1000), 3).toFixed(2)).toBe('75.00');
    expect(commissionAmount(fixed, D(40), 3).toFixed(2)).toBe('40.00');
    expect(commissionAmount(fixed, D(0), 3).toFixed(2)).toBe('0.00');
  });
});

describe('money helpers', () => {
  it('splits a tax-inclusive amount into net and tax that add up', () => {
    const { net, tax } = splitInclusive(D('120.00'), '12');
    expect(tax.toFixed(2)).toBe('12.86');
    expect(net.add(tax).toFixed(2)).toBe('120.00');
    expect(splitInclusive(D('99.99'), '0').tax.toFixed(2)).toBe('0.00');
  });

  it('allocates centavos by weight without losing any', () => {
    const parts = allocateCents(D('10.00'), [D(1), D(1), D(1)]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['3.34', '3.33', '3.33']);
    expect(allocateCents(D('0.05'), [D(0), D(0)]).map((p) => p.toFixed(2))).toEqual([
      '0.00',
      '0.00',
    ]);
  });
});

describe('settlement periods (Philippine time)', () => {
  const weekly = DEFAULT_FINANCE_SETTINGS.settlement; // Monday start

  it('finds the Monday–Sunday week of an instant', () => {
    // Sunday 2026-11-29 23:30 in Manila is still in the week starting Monday 2026-11-23.
    const p = periodContaining(new Date('2026-11-29T15:30:00Z'), weekly);
    expect(p.start.toISOString()).toBe('2026-11-22T16:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-29T16:00:00.000Z');
    // Monday 00:00 Manila starts the next week.
    expect(periodContaining(new Date('2026-11-29T16:00:00Z'), weekly).start.toISOString()).toBe(
      '2026-11-29T16:00:00.000Z',
    );
  });

  it('gives the last closed period', () => {
    const p = lastClosedPeriod(new Date('2026-11-26T04:00:00Z'), weekly);
    expect(p.start.toISOString()).toBe('2026-11-15T16:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-22T16:00:00.000Z');
  });

  it('supports biweekly and monthly schedules', () => {
    const bi = periodContaining(new Date('2026-01-14T04:00:00Z'), {
      ...weekly,
      frequency: 'BIWEEKLY',
    });
    expect(bi.start.toISOString()).toBe('2026-01-04T16:00:00.000Z');
    expect(bi.end.getTime() - bi.start.getTime()).toBe(14 * 86400_000);
    const next = periodContaining(new Date('2026-01-19T04:00:00Z'), {
      ...weekly,
      frequency: 'BIWEEKLY',
    });
    expect(next.start.toISOString()).toBe('2026-01-18T16:00:00.000Z');
    const month = periodContaining(new Date('2026-02-28T20:00:00Z'), {
      ...weekly,
      frequency: 'MONTHLY',
    });
    // 04:00 on 1 March in Manila belongs to March.
    expect(month.start.toISOString()).toBe('2026-02-28T16:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-03-31T16:00:00.000Z');
  });
});
