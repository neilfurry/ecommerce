import { Prisma } from './generated/prisma/client';

/**
 * Commission rule resolution (ADR 0026). Pure functions: the checkout, the admin preview and
 * the tests use the same code.
 *
 * Precedence, for the rules effective at the time of the sale:
 *  1. an EXEMPT rule matching the item (the most specific one, as below) — exemptions win;
 *  2. PRODUCT — the product itself;
 *  3. SELLER_CATEGORY — this seller in the item's category or its nearest ancestor;
 *  4. SELLER — every product of the seller;
 *  5. CATEGORY — the item's category or its nearest ancestor;
 *  6. DEFAULT — the marketplace default.
 * A rule is effective when effective_from <= at < effective_to (or no end).
 */

export type CommissionScopeName = 'DEFAULT' | 'CATEGORY' | 'SELLER' | 'SELLER_CATEGORY' | 'PRODUCT';
export type CommissionTypeName = 'PERCENTAGE' | 'FIXED' | 'EXEMPT';

export interface CommissionRuleLike {
  id: string;
  scope: CommissionScopeName;
  type: CommissionTypeName;
  categoryId: string | null;
  sellerId: string | null;
  productId: string | null;
  ratePercent: Prisma.Decimal;
  fixedAmount: Prisma.Decimal | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface CommissionTarget {
  productId: string;
  sellerId: string;
  /** The product's category first, then its ancestors up to the root. */
  categoryPath: string[];
}

export interface ResolvedCommission {
  ruleId: string | null;
  scope: CommissionScopeName;
  type: CommissionTypeName;
  ratePercent: Prisma.Decimal;
  fixedAmount: Prisma.Decimal | null;
}

export const SCOPE_PRECEDENCE: CommissionScopeName[] = [
  'PRODUCT',
  'SELLER_CATEGORY',
  'SELLER',
  'CATEGORY',
  'DEFAULT',
];

export const isEffective = (
  rule: { effectiveFrom: Date; effectiveTo: Date | null },
  at: Date,
): boolean =>
  rule.effectiveFrom.getTime() <= at.getTime() &&
  (rule.effectiveTo === null || at.getTime() < rule.effectiveTo.getTime());

/** How close a rule is to the item (lower is more specific); null when it does not match. */
function specificity(rule: CommissionRuleLike, target: CommissionTarget): number | null {
  const depth = (categoryId: string | null) => {
    const i = categoryId ? target.categoryPath.indexOf(categoryId) : -1;
    return i < 0 ? null : i;
  };
  const base = SCOPE_PRECEDENCE.indexOf(rule.scope) * 1000;
  switch (rule.scope) {
    case 'PRODUCT':
      return rule.productId === target.productId ? base : null;
    case 'SELLER_CATEGORY': {
      const d = rule.sellerId === target.sellerId ? depth(rule.categoryId) : null;
      return d === null ? null : base + d;
    }
    case 'SELLER':
      return rule.sellerId === target.sellerId ? base : null;
    case 'CATEGORY': {
      const d = depth(rule.categoryId);
      return d === null ? null : base + d;
    }
    case 'DEFAULT':
      return base;
  }
}

const NONE: ResolvedCommission = {
  ruleId: null,
  scope: 'DEFAULT',
  type: 'PERCENTAGE',
  ratePercent: new Prisma.Decimal(0),
  fixedAmount: null,
};

export function resolveCommission(
  rules: readonly CommissionRuleLike[],
  target: CommissionTarget,
  at: Date,
): ResolvedCommission {
  let best: { rule: CommissionRuleLike; rank: number } | null = null;
  for (const rule of rules) {
    if (!isEffective(rule, at)) continue;
    const s = specificity(rule, target);
    if (s === null) continue;
    // Exemptions rank before every other rule.
    const rank = (rule.type === 'EXEMPT' ? 0 : 100_000) + s;
    if (!best || rank < best.rank) best = { rule, rank };
  }
  if (!best) return NONE;
  const r = best.rule;
  return {
    ruleId: r.id,
    scope: r.scope,
    type: r.type,
    ratePercent: r.ratePercent,
    fixedAmount: r.fixedAmount,
  };
}

const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * The commission on a line: a percentage of the base, a fixed amount per unit (never more than
 * the base), or nothing for an exemption. Rounded to the centavo.
 */
export function commissionAmount(
  resolved: Pick<ResolvedCommission, 'type' | 'ratePercent' | 'fixedAmount'>,
  base: Prisma.Decimal,
  quantity: number,
): Prisma.Decimal {
  if (base.lte(0)) return new Prisma.Decimal(0);
  switch (resolved.type) {
    case 'EXEMPT':
      return new Prisma.Decimal(0);
    case 'FIXED': {
      const fixed = cents((resolved.fixedAmount ?? new Prisma.Decimal(0)).times(quantity));
      return Prisma.Decimal.min(fixed, base);
    }
    case 'PERCENTAGE':
      return cents(base.times(resolved.ratePercent).dividedBy(100));
  }
}
