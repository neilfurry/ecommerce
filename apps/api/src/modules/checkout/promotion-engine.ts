import { allocate, cents, D, type Decimal, min, sum, ZERO } from './money';

/**
 * The promotion engine (ADR 0030): which automatic promotion each item gets, worked out on the
 * server from the database. Pure functions over the checkout lines so the rules are unit tested.
 *
 * Stacking, in order:
 * 1. Each item gets at most ONE item promotion: its flash sale price or one campaign
 *    (percent off, amount off, bundle, buy X get Y), whichever saves the customer more. A
 *    campaign that beats a flash sale is applied on the regular price (the flash unit is not
 *    taken). Ties keep the flash sale; between campaigns, higher priority, then the older one.
 * 2. Free shipping campaigns per store parcel (the best one).
 * 3. Coupons: one seller coupon per store and one marketplace coupon, on what is left; a free
 *    shipping coupon does not apply to a parcel that already ships free from a campaign.
 * 4. Loyalty points last, on what is left of the items.
 */

export type CampaignKind =
  'PERCENTAGE_OFF' | 'FIXED_OFF' | 'BUNDLE' | 'BUY_X_GET_Y' | 'FREE_SHIPPING';

export interface EngineCampaign {
  id: string;
  name: string;
  season: string | null;
  scope: 'PLATFORM' | 'SELLER';
  sellerId: string | null;
  type: CampaignKind;
  value: Decimal;
  maxDiscount: Decimal | null;
  minQuantity: number;
  buyQuantity: number | null;
  getQuantity: number | null;
  minSpend: Decimal;
  appliesTo: 'ALL' | 'PRODUCTS' | 'CATEGORIES';
  productIds: string[];
  categoryIds: string[];
  priority: number;
  createdAt: Date;
}

/** What the engine needs of a checkout line. */
export interface EngineLine {
  productId: string;
  /** The product's category and all its ancestors (for category targets). */
  categoryPath: string[];
  sellerId: string;
  quantity: number;
  /** Unit price the price engine chose (flash, sale, wholesale tier...). */
  unitPrice: Decimal;
  /** Regular retail unit price. */
  regularPrice: Decimal;
  isFlashSale: boolean;
}

export interface LineChoice {
  campaign: EngineCampaign | null;
  /** Item discount from the campaign. */
  discount: Decimal;
  /** True when the campaign replaced a flash sale price (the line is repriced at regular). */
  dropsFlashSale: boolean;
}

export interface ShippingChoice {
  campaign: EngineCampaign;
  discount: Decimal;
}

/** Whether a promotion's product / category targets cover a line. */
export function targets(
  promotion: Pick<EngineCampaign, 'appliesTo' | 'productIds' | 'categoryIds'>,
  line: Pick<EngineLine, 'productId' | 'categoryPath'>,
): boolean {
  if (promotion.appliesTo === 'PRODUCTS') return promotion.productIds.includes(line.productId);
  if (promotion.appliesTo === 'CATEGORIES')
    return line.categoryPath.some((c) => promotion.categoryIds.includes(c));
  return true;
}

const covers = (c: EngineCampaign, line: EngineLine) =>
  (c.scope === 'PLATFORM' || c.sellerId === line.sellerId) && targets(c, line);

/** Saving of an item campaign on a line at a unit price (bundle qualification aside). */
export function campaignSaving(c: EngineCampaign, line: EngineLine, unit: Decimal): Decimal {
  const gross = unit.times(line.quantity);
  switch (c.type) {
    case 'PERCENTAGE_OFF': {
      const off = cents(gross.times(c.value).dividedBy(100));
      return c.maxDiscount ? min(off, c.maxDiscount) : off;
    }
    case 'FIXED_OFF':
      return cents(min(c.value, unit).times(line.quantity));
    case 'BUNDLE':
      return cents(gross.times(c.value).dividedBy(100));
    case 'BUY_X_GET_Y': {
      const buy = c.buyQuantity ?? 1;
      const get = c.getQuantity ?? 1;
      const free = Math.floor(line.quantity / (buy + get)) * get;
      return cents(unit.times(free).times(c.value).dividedBy(100));
    }
    default:
      return ZERO;
  }
}

const flashSaving = (line: EngineLine) =>
  line.isFlashSale ? cents(line.regularPrice.minus(line.unitPrice).times(line.quantity)) : ZERO;

const better = (
  a: { saving: Decimal; c: EngineCampaign },
  b: { saving: Decimal; c: EngineCampaign },
) =>
  a.saving.comparedTo(b.saving) ||
  a.c.priority - b.c.priority ||
  b.c.createdAt.getTime() - a.c.createdAt.getTime() ||
  (a.c.id < b.c.id ? 1 : -1);

/**
 * Chooses the item promotion of every line. Bundles need min_quantity eligible units within one
 * store's part of the order counting only lines that actually take the bundle, so the choice
 * is repeated until no bundle loses its minimum.
 */
export function chooseItemPromotions(
  lines: EngineLine[],
  campaigns: EngineCampaign[],
): LineChoice[] {
  const itemCampaigns = campaigns.filter((c) => c.type !== 'FREE_SHIPPING');
  // Bundles switched off per store (seller id) after losing their minimum.
  const off = new Set<string>();
  const key = (c: EngineCampaign, sellerId: string) => `${c.id}:${sellerId}`;
  let choices: LineChoice[] = [];
  for (let round = 0; round < 10; round++) {
    choices = lines.map((line) => {
      const unit = line.isFlashSale ? line.regularPrice : line.unitPrice;
      let best: { saving: Decimal; c: EngineCampaign } | null = null;
      for (const c of itemCampaigns) {
        if (!covers(c, line)) continue;
        if (c.type === 'BUNDLE' && off.has(key(c, line.sellerId))) continue;
        const saving = campaignSaving(c, line, unit);
        if (saving.lte(0)) continue;
        const candidate = { saving, c };
        if (!best || better(candidate, best) > 0) best = candidate;
      }
      if (!best || best.saving.lte(flashSaving(line))) {
        return { campaign: null, discount: ZERO, dropsFlashSale: false };
      }
      return { campaign: best.c, discount: best.saving, dropsFlashSale: line.isFlashSale };
    });
    let changed = false;
    const units = new Map<string, number>();
    choices.forEach((choice, i) => {
      if (choice.campaign?.type !== 'BUNDLE') return;
      const k = key(choice.campaign, lines[i]!.sellerId);
      units.set(k, (units.get(k) ?? 0) + lines[i]!.quantity);
    });
    choices.forEach((choice, i) => {
      if (choice.campaign?.type !== 'BUNDLE') return;
      const k = key(choice.campaign, lines[i]!.sellerId);
      if ((units.get(k) ?? 0) < choice.campaign.minQuantity && !off.has(k)) {
        off.add(k);
        changed = true;
      }
    });
    if (!changed) break;
  }
  // A bundle's max_discount caps the bundle per store: scale its lines down to the cap.
  const groups = new Map<string, number[]>();
  choices.forEach((choice, i) => {
    if (choice.campaign?.type !== 'BUNDLE' || !choice.campaign.maxDiscount) return;
    const k = key(choice.campaign, lines[i]!.sellerId);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const indexes of groups.values()) {
    const cap = choices[indexes[0]!]!.campaign!.maxDiscount!;
    const total = sum(indexes.map((i) => choices[i]!.discount));
    if (total.lte(cap)) continue;
    const parts = allocate(
      cap,
      indexes.map((i) => choices[i]!.discount),
    );
    indexes.forEach((i, j) => (choices[i]!.discount = parts[j]!));
  }
  return choices;
}

/**
 * The best free-shipping campaign for one store's parcel: eligible items (after item
 * promotions) must reach min_spend; the discount is the fee left, capped by max_discount.
 */
export function chooseShippingPromotion(
  sellerId: string,
  lines: { line: EngineLine; itemsAfterPromotions: Decimal }[],
  shippingLeft: Decimal,
  campaigns: EngineCampaign[],
): ShippingChoice | null {
  if (shippingLeft.lte(0)) return null;
  let best: ShippingChoice | null = null;
  for (const c of campaigns) {
    if (c.type !== 'FREE_SHIPPING') continue;
    if (c.scope === 'SELLER' && c.sellerId !== sellerId) continue;
    const eligible = lines.filter((l) => targets(c, l.line));
    if (eligible.length === 0) continue;
    const spend = sum(eligible.map((l) => l.itemsAfterPromotions));
    if (spend.lessThan(c.minSpend)) continue;
    const discount = c.maxDiscount ? min(shippingLeft, c.maxDiscount) : shippingLeft;
    if (
      !best ||
      discount.greaterThan(best.discount) ||
      (discount.equals(best.discount) && c.priority > best.campaign.priority)
    ) {
      best = { campaign: c, discount };
    }
  }
  return best;
}

/** Short customer-facing text for a campaign. */
export function campaignHeadline(c: {
  type: CampaignKind;
  value: Decimal | string;
  minQuantity: number;
  buyQuantity: number | null;
  getQuantity: number | null;
  minSpend: Decimal | string;
}): string {
  const value = D(c.value);
  const pct = `${value.toDecimalPlaces(2).toString()}%`;
  switch (c.type) {
    case 'PERCENTAGE_OFF':
      return `${pct} off`;
    case 'FIXED_OFF':
      return `₱${value.toFixed(2)} off each`;
    case 'BUNDLE':
      return `Buy ${c.minQuantity}+, get ${pct} off`;
    case 'BUY_X_GET_Y': {
      const deal = value.equals(100) ? 'free' : `${pct} off`;
      if (c.buyQuantity === 1 && c.getQuantity === 1 && value.equals(100)) return 'Buy 1, take 1';
      return `Buy ${c.buyQuantity ?? 1}, get ${c.getQuantity ?? 1} ${deal}`;
    }
    case 'FREE_SHIPPING':
      return D(c.minSpend).greaterThan(0)
        ? `Free shipping over ₱${D(c.minSpend).toFixed(2)}`
        : 'Free shipping';
  }
}
