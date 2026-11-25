import { Injectable } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  SHIPPING_METHOD_LABELS,
  type ShippingMethod,
} from '@marketplace/shared-types';
import type {
  CheckoutLine,
  CheckoutQuote,
  CheckoutRequestParsed,
  CheckoutSettings,
  CouponResult,
  PriceQuoteLine,
} from '@marketplace/validation';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatAddress } from '../addresses/addresses.service';
import { availableOf, optionsOf, thumbnailOf } from '../cart/cart.service';
import { PricingService, shopperOf } from '../pricing/pricing.service';
import {
  PlatformSettingsService,
  type ResolvedCommission,
} from '../settings/platform-settings.service';
import type { ShippingPlace, ShippingRate } from '../shipping/shipping-provider';
import { type ShippingOrigin, ShippingService } from '../shipping/shipping.service';
import { allocate, cents, D, type Decimal, includedVat, min, sum, ZERO } from './money';

type Db = Prisma.TransactionClient | PrismaService;

const variantInclude = {
  stockLevels: { where: { warehouse: { status: 'ACTIVE' } } },
  optionValues: { include: { optionValue: { include: { option: true } } } },
  images: { orderBy: { position: 'asc' }, take: 1 },
  product: {
    include: {
      store: { select: { id: true, name: true, slug: true } },
      images: { orderBy: { position: 'asc' }, take: 1 },
    },
  },
} satisfies Prisma.ProductVariantInclude;
type VariantRow = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>;

const addressInclude = { region: true, province: true, city: true, barangay: true } as const;
type AddressRow = Prisma.CustomerAddressGetPayload<{ include: typeof addressInclude }>;

/** One priced line with everything an order item stores. */
export interface PlannedLine {
  cartItemId: string | null;
  variant: VariantRow;
  quantity: number;
  price: PriceQuoteLine;
  lineSubtotal: Decimal;
  sellerDiscount: Decimal;
  platformDiscount: Decimal;
  lineTotal: Decimal;
  vatAmount: Decimal;
  commission: ResolvedCommission & { base: Decimal; amount: Decimal };
}

export interface PlannedCoupon {
  couponId: string;
  code: string;
  scope: 'PLATFORM' | 'SELLER';
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
  sellerId: string | null;
  /** Items + shipping discount given by the coupon, per seller. */
  bySeller: Map<string, Decimal>;
  amount: Decimal;
}

export interface PlannedGroup {
  sellerId: string;
  store: { id: string; name: string; slug: string };
  lines: PlannedLine[];
  origin: ShippingOrigin | null;
  options: ShippingRate[];
  shipping: ShippingRate | null;
  weightGrams: number;
  volumeCm3: number;
  itemsSubtotal: Decimal;
  wholesaleSavings: Decimal;
  sellerDiscount: Decimal;
  platformDiscount: Decimal;
  shippingFee: Decimal;
  sellerShippingDiscount: Decimal;
  platformShippingDiscount: Decimal;
  charges: { code: string; label: string; amount: Decimal }[];
  chargesTotal: Decimal;
  vatAmount: Decimal;
  total: Decimal;
  commissionAmount: Decimal;
  note: string | null;
}

/** The full calculation: what the quote shows and what placing the order stores. */
export interface CheckoutPlan {
  quote: CheckoutQuote;
  groups: PlannedGroup[];
  coupons: PlannedCoupon[];
  address: AddressRow | null;
  settings: CheckoutSettings;
  buyerType: 'RETAIL' | 'WHOLESALE';
  paymentMethod: PaymentMethod;
  grandTotal: Decimal;
  /** Cart lines being bought (removed from the cart when the order is placed). */
  cartItemIds: string[];
}

interface Problem {
  path: string;
  message: string;
}

const money = (d: Decimal) => d.toFixed(2);

/**
 * The checkout pricing service: every amount of an order, calculated on the server from the
 * database (never from the client). Used for the quote shown before ordering and, inside the
 * order transaction, for the order itself, so both always agree.
 */
@Injectable()
export class CheckoutPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly shipping: ShippingService,
    private readonly settingsService: PlatformSettingsService,
  ) {}

  async plan(
    user: AuthenticatedUser,
    input: CheckoutRequestParsed,
    db: Db = this.prisma,
  ): Promise<CheckoutPlan> {
    const now = new Date();
    const { customerId, buyer } = shopperOf(user);
    const settings = await this.settingsService.checkout(db);
    const problems: Problem[] = [];

    // 1. What is being bought: "buy now", chosen cart lines, or the whole cart.
    let requested: { cartItemId: string | null; variantId: string; quantity: number }[];
    if (input.buyNow) {
      requested = [
        {
          cartItemId: null,
          variantId: input.buyNow.variantId,
          quantity: Number(input.buyNow.quantity),
        },
      ];
    } else {
      const rows = await db.cartItem.findMany({
        where: {
          userId: user.id,
          savedForLater: false,
          ...(input.cartItemIds ? { id: { in: input.cartItemIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
      });
      if (input.cartItemIds && rows.length !== new Set(input.cartItemIds).size) {
        problems.push({
          path: 'cartItemIds',
          message: 'Some cart items are no longer in your cart.',
        });
      }
      requested = rows.map((r) => ({
        cartItemId: r.id,
        variantId: r.variantId,
        quantity: r.quantity,
      }));
    }
    if (requested.length === 0) problems.push({ path: 'items', message: 'Your cart is empty.' });

    // 2. Delivery address (the default one when none is chosen, for the quote).
    const address = input.addressId
      ? await db.customerAddress.findFirst({
          where: { id: input.addressId, userId: user.id },
          include: addressInclude,
        })
      : await db.customerAddress.findFirst({
          where: { userId: user.id, isDefault: true },
          include: addressInclude,
        });
    if (input.addressId && !address)
      problems.push({ path: 'addressId', message: 'Choose one of your addresses.' });
    if (!address) problems.push({ path: 'addressId', message: 'Add a delivery address.' });

    // 3. Prices (retail, flash, wholesale, agreed) and stock, per line.
    const evaluated = await this.pricing.evaluate(
      requested.map((r) => ({ variantId: r.variantId, quantity: r.quantity })),
      buyer,
      customerId,
      now,
      db,
    );
    const variants = await db.productVariant.findMany({
      where: { id: { in: requested.map((r) => r.variantId) } },
      include: variantInclude,
    });
    const commissions = await this.settingsService.commissionFor(
      [...new Set(variants.map((v) => v.product.categoryId))],
      db,
    );
    const groupsBySeller = new Map<string, PlannedGroup>();
    requested.forEach((item, index) => {
      const variant = variants.find((v) => v.id === item.variantId);
      const priced = evaluated[index]!;
      const path = `items.${index}`;
      if (!variant || !priced.line) {
        problems.push({
          path,
          message: `${variant?.product.name ?? 'An item'}: ${priced.problem ?? 'not available'}`,
        });
        return;
      }
      const available = availableOf(variant);
      if (available !== null && available < item.quantity) {
        problems.push({
          path,
          message:
            available === 0
              ? `${variant.product.name} is out of stock.`
              : `Only ${available} of ${variant.product.name} (${variant.title}) left.`,
        });
      }
      const group =
        groupsBySeller.get(variant.sellerId) ??
        this.emptyGroup(
          variant.sellerId,
          variant.product.store,
          input.notes.find((n) => n.sellerId === variant.sellerId)?.note ?? null,
        );
      groupsBySeller.set(variant.sellerId, group);
      const lineSubtotal = D(priced.line.lineTotal);
      group.lines.push({
        cartItemId: item.cartItemId,
        variant,
        quantity: item.quantity,
        price: priced.line,
        lineSubtotal,
        sellerDiscount: ZERO,
        platformDiscount: ZERO,
        lineTotal: lineSubtotal,
        vatAmount: ZERO,
        commission: { ...commissions.get(variant.product.categoryId)!, base: ZERO, amount: ZERO },
      });
    });
    const groups = [...groupsBySeller.values()];

    // 4. Shipping per seller: origin warehouse → delivery address.
    const origins = await this.shipping.origins(
      groups.map((g) => g.sellerId),
      db,
    );
    const destination: ShippingPlace | null = address
      ? {
          regionCode: address.regionCode,
          provinceCode: address.provinceCode,
          cityCode: address.cityCode,
          label: `${address.barangay.name}, ${address.city.name}`,
        }
      : null;
    for (const [index, group] of groups.entries()) {
      group.itemsSubtotal = sum(group.lines.map((l) => l.lineSubtotal));
      group.wholesaleSavings = sum(
        group.lines
          .filter((l) => l.price.source === 'WHOLESALE_TIER')
          .map((l) => D(l.price.regularPrice).minus(l.price.unitPrice).times(l.quantity)),
      );
      const pkg = this.shipping.packageOf(
        group.lines.map((l) => ({
          quantity: l.quantity,
          weightGrams: l.variant.weightGrams,
          lengthCm: l.variant.lengthCm,
          widthCm: l.variant.widthCm,
          heightCm: l.variant.heightCm,
        })),
      );
      group.weightGrams = pkg.weightGrams;
      group.volumeCm3 = pkg.volumeCm3;
      group.origin = origins.get(group.sellerId) ?? null;
      if (!group.origin) {
        problems.push({
          path: `shipping.${index}`,
          message: `${group.store.name} cannot ship orders yet.`,
        });
        continue;
      }
      if (!destination) continue;
      group.options = await this.shipping.rates(group.origin.place, destination, pkg);
      const wanted = input.shipping.find((s) => s.sellerId === group.sellerId)?.method;
      group.shipping =
        group.options.find((o) => o.method === wanted) ??
        [...group.options].sort((a, b) => a.fee.comparedTo(b.fee))[0] ??
        null;
      if (wanted && group.shipping?.method !== wanted) {
        problems.push({
          path: `shipping.${index}`,
          message: `${SHIPPING_METHOD_LABELS[wanted]} is not available from ${group.store.name}.`,
        });
      }
      group.shippingFee = group.shipping?.fee ?? ZERO;
    }

    // 5. Coupons (one marketplace coupon, one per seller).
    const { results: couponResults, planned: coupons } = await this.applyCoupons(
      user.id,
      input.couponCodes,
      groups,
      now,
      db,
    );

    // 6. Charges, VAT and commission per seller order.
    const vatRate = D(settings.vat.rate);
    const paymentMethod = input.paymentMethod;
    if (!settings.paymentMethods.includes(paymentMethod)) {
      problems.push({
        path: 'paymentMethod',
        message: `${PAYMENT_METHOD_LABELS[paymentMethod]} is not offered.`,
      });
    }
    for (const group of groups) {
      const discountedItems = group.itemsSubtotal
        .minus(group.sellerDiscount)
        .minus(group.platformDiscount);
      group.charges = settings.charges
        .filter((c) => c.paymentMethods.length === 0 || c.paymentMethods.includes(paymentMethod))
        .map((c) => ({
          code: c.code,
          label: c.label,
          amount:
            c.type === 'FIXED'
              ? cents(D(c.amount))
              : cents(discountedItems.times(c.amount).dividedBy(100)),
        }))
        .filter((c) => c.amount.greaterThan(0));
      group.chargesTotal = sum(group.charges.map((c) => c.amount));
      group.total = discountedItems
        .plus(group.shippingFee)
        .minus(group.sellerShippingDiscount)
        .minus(group.platformShippingDiscount)
        .plus(group.chargesTotal);
      group.vatAmount = includedVat(group.total, vatRate);
      for (const line of group.lines) {
        line.lineTotal = line.lineSubtotal.minus(line.sellerDiscount).minus(line.platformDiscount);
        line.vatAmount = includedVat(line.lineTotal, vatRate);
        // Commission on what the item sold for after the seller's own discount (marketplace-paid
        // discounts do not lower the seller's sale).
        const base = line.lineSubtotal.minus(line.sellerDiscount);
        line.commission = {
          ...line.commission,
          base,
          amount: cents(base.times(line.commission.ratePercent).dividedBy(100)),
        };
      }
      group.commissionAmount = sum(group.lines.map((l) => l.commission.amount));
    }

    const totals = {
      itemsSubtotal: sum(groups.map((g) => g.itemsSubtotal)),
      wholesaleSavings: sum(groups.map((g) => g.wholesaleSavings)),
      couponDiscount: sum(groups.map((g) => g.sellerDiscount.plus(g.platformDiscount))),
      shippingFee: sum(groups.map((g) => g.shippingFee)),
      shippingDiscount: sum(
        groups.map((g) => g.sellerShippingDiscount.plus(g.platformShippingDiscount)),
      ),
      chargesTotal: sum(groups.map((g) => g.chargesTotal)),
      vatAmount: sum(groups.map((g) => g.vatAmount)),
      grandTotal: sum(groups.map((g) => g.total)),
    };

    const quote: CheckoutQuote = {
      currency: 'PHP',
      buyerType: buyer.wholesale ? 'WHOLESALE' : 'RETAIL',
      address: address
        ? {
            id: address.id,
            recipientName: address.recipientName,
            formatted: formatAddress({ ...address, place: address }),
          }
        : null,
      groups: groups.map((g) => ({
        sellerId: g.sellerId,
        store: g.store,
        lines: g.lines.map((l) => this.lineDto(l)),
        shipping: {
          options: g.options.map((o) => ({
            method: o.method,
            label: o.serviceName,
            carrier: o.carrier,
            fee: money(o.fee),
            etaMinDays: o.etaMinDays,
            etaMaxDays: o.etaMaxDays,
          })),
          selected: g.shipping
            ? {
                method: g.shipping.method,
                label: g.shipping.serviceName,
                carrier: g.shipping.carrier,
                fee: money(g.shipping.fee),
                etaMinDays: g.shipping.etaMinDays,
                etaMaxDays: g.shipping.etaMaxDays,
              }
            : null,
          origin: g.origin?.place.label ?? '',
          weightGrams: g.weightGrams,
          chargeableWeightGrams: g.shipping?.chargeableWeightGrams ?? g.weightGrams,
          fee: money(g.shippingFee),
          sellerDiscount: money(g.sellerShippingDiscount),
          platformDiscount: money(g.platformShippingDiscount),
        },
        itemsSubtotal: money(g.itemsSubtotal),
        wholesaleSavings: money(g.wholesaleSavings),
        sellerDiscount: money(g.sellerDiscount),
        platformDiscount: money(g.platformDiscount),
        charges: g.charges.map((c) => ({ code: c.code, label: c.label, amount: money(c.amount) })),
        vatAmount: money(g.vatAmount),
        total: money(g.total),
        note: g.note,
      })),
      coupons: couponResults,
      paymentMethod,
      paymentMethods: settings.paymentMethods.map((method) => ({
        method,
        label: PAYMENT_METHOD_LABELS[method],
        paymentWindowMinutes: ONLINE_PAYMENT_METHODS.includes(method)
          ? settings.paymentWindowMinutes
          : null,
      })),
      totals: {
        itemsSubtotal: money(totals.itemsSubtotal),
        wholesaleSavings: money(totals.wholesaleSavings),
        couponDiscount: money(totals.couponDiscount),
        shippingFee: money(totals.shippingFee),
        shippingDiscount: money(totals.shippingDiscount),
        chargesTotal: money(totals.chargesTotal),
        vatAmount: money(totals.vatAmount),
        grandTotal: money(totals.grandTotal),
      },
      vat: { rate: settings.vat.rate, included: true },
      problems,
      evaluatedAt: now.toISOString(),
    };
    return {
      quote,
      groups,
      coupons,
      address,
      settings,
      buyerType: quote.buyerType,
      paymentMethod,
      grandTotal: totals.grandTotal,
      cartItemIds: requested.flatMap((r) => (r.cartItemId ? [r.cartItemId] : [])),
    };
  }

  private emptyGroup(
    sellerId: string,
    store: PlannedGroup['store'],
    note: string | null,
  ): PlannedGroup {
    return {
      sellerId,
      store,
      lines: [],
      origin: null,
      options: [],
      shipping: null,
      weightGrams: 0,
      volumeCm3: 0,
      itemsSubtotal: ZERO,
      wholesaleSavings: ZERO,
      sellerDiscount: ZERO,
      platformDiscount: ZERO,
      shippingFee: ZERO,
      sellerShippingDiscount: ZERO,
      platformShippingDiscount: ZERO,
      charges: [],
      chargesTotal: ZERO,
      vatAmount: ZERO,
      total: ZERO,
      commissionAmount: ZERO,
      note,
    };
  }

  private lineDto(l: PlannedLine): CheckoutLine {
    return {
      variantId: l.variant.id,
      productId: l.variant.productId,
      productName: l.variant.product.name,
      productSlug: l.variant.product.slug,
      variantTitle: l.variant.title,
      options: optionsOf(l.variant),
      imageUrl: thumbnailOf(l.variant),
      quantity: l.quantity,
      price: l.price,
      sellerDiscount: money(l.sellerDiscount),
      platformDiscount: money(l.platformDiscount),
      lineTotal: money(l.lineSubtotal.minus(l.sellerDiscount).minus(l.platformDiscount)),
      vatAmount: money(l.vatAmount),
    };
  }

  /**
   * Validates the codes and works out each coupon's discount, writing the amounts onto the
   * groups and lines. Seller coupons first (they lower what the marketplace coupon applies to).
   */
  private async applyCoupons(
    userId: string,
    codes: string[],
    groups: PlannedGroup[],
    now: Date,
    db: Db,
  ): Promise<{ results: CouponResult[]; planned: PlannedCoupon[] }> {
    const unique = [...new Set(codes.map((c) => c.toUpperCase()))];
    if (unique.length === 0) return { results: [], planned: [] };
    const rows = await db.coupon.findMany({ where: { code: { in: unique } } });
    const used = await db.couponRedemption.groupBy({
      by: ['couponId'],
      where: { userId, releasedAt: null, couponId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const results: CouponResult[] = [];
    const planned: PlannedCoupon[] = [];
    const reject = (code: string, message: string, row?: (typeof rows)[number]) =>
      results.push({
        code,
        status: 'NOT_APPLIED',
        scope: row?.scope ?? null,
        type: row?.type ?? null,
        name: row?.name ?? null,
        sellerId: row?.sellerId ?? null,
        amount: '0.00',
        message,
      });
    const accepted: (typeof rows)[number][] = [];
    for (const code of unique) {
      const row = rows.find((r) => r.code === code);
      if (!row) {
        reject(code, 'This code is not valid.');
        continue;
      }
      if (row.status !== 'ACTIVE' || now < row.startsAt) {
        reject(code, 'This coupon is not active.', row);
        continue;
      }
      if (now >= row.endsAt) {
        reject(code, 'This coupon has expired.', row);
        continue;
      }
      if (row.usageLimit !== null && row.usedCount >= row.usageLimit) {
        reject(code, 'This coupon has been fully used.', row);
        continue;
      }
      const mine = used.find((u) => u.couponId === row.id)?._count._all ?? 0;
      if (mine >= row.perCustomerLimit) {
        reject(code, 'You have already used this coupon.', row);
        continue;
      }
      if (row.scope === 'SELLER' && !groups.some((g) => g.sellerId === row.sellerId)) {
        reject(code, 'This coupon is for a store that is not in your order.', row);
        continue;
      }
      if (accepted.some((a) => a.scope === row.scope && a.sellerId === row.sellerId)) {
        reject(
          code,
          row.scope === 'PLATFORM'
            ? 'Only one marketplace coupon can be used per order.'
            : 'Only one coupon per store can be used per order.',
          row,
        );
        continue;
      }
      accepted.push(row);
    }

    const ordered = [...accepted].sort(
      (a, b) => Number(a.scope === 'PLATFORM') - Number(b.scope === 'PLATFORM'),
    );
    for (const row of ordered) {
      const targets =
        row.scope === 'SELLER' ? groups.filter((g) => g.sellerId === row.sellerId) : groups;
      const spend = sum(targets.map((g) => g.itemsSubtotal));
      if (spend.lessThan(row.minSpend)) {
        reject(row.code, `Spend at least ₱${row.minSpend.toFixed(2)} to use this coupon.`, row);
        continue;
      }
      const bySeller = new Map<string, Decimal>();
      if (row.type === 'FREE_SHIPPING') {
        const remaining = targets.map((g) =>
          g.shippingFee.minus(g.sellerShippingDiscount).minus(g.platformShippingDiscount),
        );
        let total = sum(remaining);
        if (row.maxDiscount) total = min(total, row.maxDiscount);
        const parts = allocate(total, remaining);
        targets.forEach((g, i) => {
          if (row.scope === 'SELLER')
            g.sellerShippingDiscount = g.sellerShippingDiscount.plus(parts[i]!);
          else g.platformShippingDiscount = g.platformShippingDiscount.plus(parts[i]!);
          bySeller.set(g.sellerId, parts[i]!);
        });
      } else {
        const bases = targets.map((g) =>
          g.itemsSubtotal.minus(g.sellerDiscount).minus(g.platformDiscount),
        );
        const base = sum(bases);
        let total =
          row.type === 'PERCENTAGE'
            ? cents(base.times(row.value).dividedBy(100))
            : min(row.value, base);
        if (row.type === 'PERCENTAGE' && row.maxDiscount) total = min(total, row.maxDiscount);
        const parts = allocate(total, bases);
        targets.forEach((g, i) => {
          const part = parts[i]!;
          const lineParts = allocate(
            part,
            g.lines.map((l) => l.lineSubtotal.minus(l.sellerDiscount).minus(l.platformDiscount)),
          );
          g.lines.forEach((l, j) => {
            if (row.scope === 'SELLER') l.sellerDiscount = l.sellerDiscount.plus(lineParts[j]!);
            else l.platformDiscount = l.platformDiscount.plus(lineParts[j]!);
          });
          if (row.scope === 'SELLER') g.sellerDiscount = g.sellerDiscount.plus(part);
          else g.platformDiscount = g.platformDiscount.plus(part);
          bySeller.set(g.sellerId, part);
        });
      }
      const amount = sum([...bySeller.values()]);
      if (amount.isZero()) {
        reject(
          row.code,
          row.type === 'FREE_SHIPPING'
            ? 'There is no shipping fee to take off yet.'
            : 'Nothing to discount.',
          row,
        );
        continue;
      }
      planned.push({
        couponId: row.id,
        code: row.code,
        scope: row.scope,
        type: row.type,
        sellerId: row.sellerId,
        bySeller,
        amount,
      });
      results.push({
        code: row.code,
        status: 'APPLIED',
        scope: row.scope,
        type: row.type,
        name: row.name,
        sellerId: row.sellerId,
        amount: money(amount),
        message: null,
      });
    }
    // Report in the order the customer entered the codes.
    results.sort((a, b) => unique.indexOf(a.code) - unique.indexOf(b.code));
    return { results, planned };
  }
}

export type { ShippingMethod };
