import { Prisma } from '@marketplace/database';
import type { PriceQuoteLine } from '@marketplace/validation';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

/** A rule with an optional effective window (open-ended when a bound is null). */
interface Windowed {
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface TierRule extends Windowed {
  id: string;
  /** Null: product-level tier for every variant. */
  variantId: string | null;
  minQuantity: number;
  unitPrice: Decimal;
}

export type CustomerPriceRule = TierRule;

/** A flash sale offer for the variant (a running flash sale only). */
export interface FlashRule {
  itemId: string;
  flashPrice: Decimal;
  startsAt: Date;
  endsAt: Date;
  /** Units still available at the flash price. */
  remaining: number;
  perOrderLimit: number | null;
}

/** Everything the engine needs about one variant, loaded by the server, never from a client. */
export interface VariantPricing {
  variantId: string;
  productId: string;
  sellerId: string;
  sku: string;
  currency: string;
  regularPrice: Decimal;
  salePrice: Decimal | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  wholesaleEnabled: boolean;
  wholesaleMinOrderQuantity: number;
  /** The product's tiers (product-level and for any variant). */
  tiers: TierRule[];
  /** The buyer's own agreed prices for this product (empty for anonymous buyers). */
  customerPrices: CustomerPriceRule[];
  /** The running flash sale offer for this variant, if any. */
  flash?: FlashRule | null;
}

export interface Buyer {
  /** Approved wholesale customer (holds WHOLESALE_CUSTOMER). */
  wholesale: boolean;
}

export class QuantityOutOfRangeError extends Error {
  constructor(
    readonly sku: string,
    readonly min: number,
    readonly max: number | null,
  ) {
    super(
      max === null
        ? `Order at least ${min} of ${sku}.`
        : `Order between ${min} and ${max} of ${sku}.`,
    );
  }
}

export const isActive = (rule: Windowed, now: Date) =>
  (!rule.startsAt || rule.startsAt <= now) && (!rule.endsAt || now < rule.endsAt);

const money = (value: Decimal) => value.toFixed(2);

/**
 * The tiers that apply to a variant at `now`: its own active tiers when it has any,
 * otherwise the product-level ones. Sorted by quantity.
 */
export function applicableTiers(data: VariantPricing, now: Date): TierRule[] {
  const active = data.tiers.filter((t) => isActive(t, now));
  const own = active.filter((t) => t.variantId === data.variantId);
  const chosen = own.length > 0 ? own : active.filter((t) => t.variantId === null);
  return [...chosen].sort((a, b) => a.minQuantity - b.minQuantity);
}

/**
 * Works out the unit price for `quantity` units of a variant:
 *
 *  1. A price the seller agreed with this customer wins (variant-specific before
 *     product-wide, then the highest quantity break reached).
 *  2. Otherwise the retail price: the sale price while a sale runs, else the regular price;
 *     a running flash sale price when it is lower, as long as the line stays within the
 *     units left at that price and the flash sale's per-order limit.
 *  3. Approved wholesale customers, on products with wholesale enabled and at or above the
 *     wholesale minimum, get the tier for the highest quantity break reached, when it is
 *     lower than the retail price (a wholesale buyer never pays more than a retail one).
 *
 * The result carries the rule that produced the price, which orders store as a snapshot.
 */
export function calculatePrice(
  data: VariantPricing,
  quantity: number,
  buyer: Buyer,
  now: Date,
): PriceQuoteLine {
  if (
    quantity < data.minOrderQuantity ||
    (data.maxOrderQuantity !== null && quantity > data.maxOrderQuantity)
  ) {
    throw new QuantityOutOfRangeError(data.sku, data.minOrderQuantity, data.maxOrderQuantity);
  }

  const wholesaleEligible = buyer.wholesale && data.wholesaleEnabled;
  const tiers = wholesaleEligible ? applicableTiers(data, now) : [];

  let unitPrice: Decimal = data.regularPrice;
  let source: PriceQuoteLine['source'] = 'REGULAR';
  let rule: PriceQuoteLine['rule'] = null;

  const saleRunning =
    data.salePrice !== null &&
    isActive({ startsAt: data.saleStartsAt, endsAt: data.saleEndsAt }, now);
  if (saleRunning) {
    unitPrice = data.salePrice!;
    source = 'SALE';
    rule = {
      type: 'SALE',
      id: data.variantId,
      minQuantity: null,
      startsAt: data.saleStartsAt?.toISOString() ?? null,
      endsAt: data.saleEndsAt?.toISOString() ?? null,
    };
  }

  let flashApplied: PriceQuoteLine['flashSale'] = null;
  const flash = data.flash;
  if (
    flash &&
    isActive({ startsAt: flash.startsAt, endsAt: flash.endsAt }, now) &&
    quantity <= flash.remaining &&
    (flash.perOrderLimit === null || quantity <= flash.perOrderLimit) &&
    flash.flashPrice.lessThan(unitPrice)
  ) {
    unitPrice = flash.flashPrice;
    source = 'FLASH_SALE';
    rule = {
      type: 'FLASH_SALE',
      id: flash.itemId,
      minQuantity: null,
      startsAt: flash.startsAt.toISOString(),
      endsAt: flash.endsAt.toISOString(),
    };
    flashApplied = {
      itemId: flash.itemId,
      endsAt: flash.endsAt.toISOString(),
      remaining: flash.remaining,
      perOrderLimit: flash.perOrderLimit,
    };
  }

  if (wholesaleEligible && quantity >= data.wholesaleMinOrderQuantity) {
    const tier = [...tiers].reverse().find((t) => t.minQuantity <= quantity);
    if (tier && tier.unitPrice.lessThan(unitPrice)) {
      unitPrice = tier.unitPrice;
      source = 'WHOLESALE_TIER';
      flashApplied = null;
      rule = {
        type: 'PRICE_TIER',
        id: tier.id,
        minQuantity: tier.minQuantity,
        startsAt: tier.startsAt?.toISOString() ?? null,
        endsAt: tier.endsAt?.toISOString() ?? null,
      };
    }
  }

  const agreed = data.customerPrices
    .filter(
      (c) =>
        isActive(c, now) &&
        c.minQuantity <= quantity &&
        (c.variantId === null || c.variantId === data.variantId),
    )
    .sort(
      (a, b) =>
        Number(b.variantId !== null) - Number(a.variantId !== null) ||
        b.minQuantity - a.minQuantity,
    )[0];
  if (agreed) {
    unitPrice = agreed.unitPrice;
    source = 'CUSTOMER_PRICE';
    flashApplied = null;
    rule = {
      type: 'CUSTOMER_PRICE',
      id: agreed.id,
      minQuantity: agreed.minQuantity,
      startsAt: agreed.startsAt?.toISOString() ?? null,
      endsAt: agreed.endsAt?.toISOString() ?? null,
    };
  }

  return {
    variantId: data.variantId,
    productId: data.productId,
    sellerId: data.sellerId,
    sku: data.sku,
    quantity,
    currency: data.currency,
    unitPrice: money(unitPrice),
    lineTotal: money(unitPrice.times(quantity)),
    regularPrice: money(data.regularPrice),
    source,
    rule,
    tiers: tiers.map((t) => ({ minQuantity: t.minQuantity, unitPrice: money(t.unitPrice) })),
    minOrderQuantity: data.minOrderQuantity,
    maxOrderQuantity: data.maxOrderQuantity,
    wholesaleEligible,
    flashSale: flashApplied,
  };
}

export { Decimal };
