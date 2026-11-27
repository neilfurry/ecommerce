import { Injectable } from '@nestjs/common';
import {
  affiliateSettingsInTx,
  commissionAmount,
  loyaltySettingsInTx,
  maxRedeemablePoints,
  pointsForAmount,
  type Prisma,
  type ResolvedCommission,
  type TaxRuleSnapshot,
} from '@marketplace/database';
import {
  type AuthenticatedUser,
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  SHIPPING_METHOD_LABELS,
  type ShippingMethod,
} from '@marketplace/shared-types';
import type {
  AppliedPromotion,
  CheckoutLine,
  CheckoutQuote,
  CheckoutRequestParsed,
  CheckoutSettings,
  CouponResult,
  OrderSettings,
  PriceQuoteLine,
} from '@marketplace/validation';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatAddress } from '../addresses/addresses.service';
import { availableOf, optionsOf, thumbnailOf } from '../cart/cart.service';
import { PaymentsService } from '../orders/payments/payments.service';
import { PricingService, shopperOf } from '../pricing/pricing.service';
import { CommissionRulesService } from '../settings/commission-rules.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { TaxRulesService } from '../settings/tax-rules.service';
import type { ShippingPlace, ShippingRate } from '../shipping/shipping-provider';
import { type ShippingOrigin, ShippingService } from '../shipping/shipping.service';
import { allocate, cents, D, type Decimal, includedVat, min, sum, ZERO } from './money';
import {
  chooseItemPromotions,
  chooseShippingPromotion,
  type EngineCampaign,
  type EngineLine,
  targets,
} from './promotion-engine';

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
  /** The campaign on this line and its discount (part of seller or platform discount). */
  campaign: EngineCampaign | null;
  promotionDiscount: Decimal;
  /** Loyalty points value on this line (part of platform discount). */
  pointsDiscount: Decimal;
  /** The engine's view of the line (category path for category targets). */
  engine: EngineLine;
  lineTotal: Decimal;
  vatAmount: Decimal;
  commission: ResolvedCommission & { base: Decimal; amount: Decimal };
  /** Goods tax rule snapshot (by the seller's registration at the time of the order). */
  tax: TaxRuleSnapshot;
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
  promotionDiscount: Decimal;
  pointsDiscount: Decimal;
  pointsRedeemed: number;
  promotions: PlannedPromotion[];
  /** Free shipping from a campaign (no free-shipping coupon on top). */
  campaignFreeShipping: boolean;
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

export interface PlannedPromotion {
  campaign: EngineCampaign;
  amount: Decimal;
  shippingAmount: Decimal;
}

/** The full calculation: what the quote shows and what placing the order stores. */
export interface CheckoutPlan {
  quote: CheckoutQuote;
  groups: PlannedGroup[];
  coupons: PlannedCoupon[];
  address: AddressRow | null;
  settings: CheckoutSettings;
  orderSettings: OrderSettings;
  buyerType: 'RETAIL' | 'WHOLESALE';
  paymentMethod: PaymentMethod;
  grandTotal: Decimal;
  /** Cart lines being bought (removed from the cart when the order is placed). */
  cartItemIds: string[];
  points: { redeemed: number; discount: Decimal; pointValue: string };
  affiliate: { accountId: string; code: string; rate: Decimal } | null;
  totals: { promotionDiscount: Decimal; couponDiscount: Decimal; pointsDiscount: Decimal };
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
    private readonly commissionRules: CommissionRulesService,
    private readonly taxRules: TaxRulesService,
    private readonly payments: PaymentsService,
  ) {}

  async plan(
    user: AuthenticatedUser,
    input: CheckoutRequestParsed,
    db: Db = this.prisma,
  ): Promise<CheckoutPlan> {
    const now = new Date();
    const { customerId, buyer } = shopperOf(user);
    const settings = await this.settingsService.checkout(db);
    const orderSettings = await this.settingsService.orders(db);
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
    const commissionOf = await this.commissionRules.resolverAt(now, db);
    const goodsTax = await this.taxRules.goodsTaxFor(
      [...new Set(variants.map((v) => v.sellerId))],
      now,
      db,
    );
    const categoryPathOf = await this.categoryPaths(db);
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
        campaign: null,
        promotionDiscount: ZERO,
        pointsDiscount: ZERO,
        engine: {
          productId: variant.productId,
          categoryPath: categoryPathOf(variant.product.categoryId),
          sellerId: variant.sellerId,
          quantity: item.quantity,
          unitPrice: D(priced.line.unitPrice),
          regularPrice: D(priced.line.regularPrice),
          isFlashSale: priced.line.source === 'FLASH_SALE' && priced.line.flashSale !== null,
        },
        lineTotal: lineSubtotal,
        vatAmount: ZERO,
        commission: {
          ...commissionOf({
            productId: variant.productId,
            sellerId: variant.sellerId,
            categoryId: variant.product.categoryId,
          }),
          base: ZERO,
          amount: ZERO,
        },
        tax: goodsTax.get(variant.sellerId)!,
      });
    });
    const groups = [...groupsBySeller.values()];

    // 3b. Automatic promotions (campaigns) on items: one per item, the best of flash sale or
    // campaign (ADR 0030). Must run before the subtotals.
    const campaigns = await this.activeCampaigns(
      groups.map((g) => g.sellerId),
      now,
      db,
    );
    this.applyItemPromotions(groups, campaigns);

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
      group.options = await this.shipping.rates(group.origin.place, destination, pkg, db);
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

    // 4b. Free-shipping campaigns per parcel.
    for (const group of groups) {
      const choice = chooseShippingPromotion(
        group.sellerId,
        group.lines.map((l) => ({
          line: l.engine,
          itemsAfterPromotions: l.lineSubtotal.minus(l.promotionDiscount),
        })),
        group.shippingFee,
        campaigns,
      );
      if (!choice) continue;
      if (choice.campaign.scope === 'SELLER')
        group.sellerShippingDiscount = group.sellerShippingDiscount.plus(choice.discount);
      else group.platformShippingDiscount = group.platformShippingDiscount.plus(choice.discount);
      group.campaignFreeShipping = true;
      const existing = group.promotions.find((p) => p.campaign.id === choice.campaign.id);
      if (existing) existing.shippingAmount = existing.shippingAmount.plus(choice.discount);
      else
        group.promotions.push({
          campaign: choice.campaign,
          amount: ZERO,
          shippingAmount: choice.discount,
        });
    }

    // 5. Coupons (one marketplace coupon, one per seller).
    const { results: couponResults, planned: coupons } = await this.applyCoupons(
      user.id,
      input.couponCodes,
      groups,
      now,
      db,
    );

    // 5b. Loyalty points last (marketplace-funded, at most maxRedeemPercent of the items).
    const loyalty = await this.applyPoints(user.id, input.pointsToRedeem ?? 0, groups, db);
    if (loyalty.problem) problems.push({ path: 'pointsToRedeem', message: loyalty.problem });

    // 5c. Affiliate attribution (an approved affiliate's code; never the customer's own).
    const affiliate = await this.affiliateFor(user.id, input.affiliateCode ?? null, db);

    // 6. Charges, taxes and commission per seller order. The goods tax follows the seller's
    // registration (tax rules); a tax-exclusive rule adds the tax on top of the price.
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
      let taxOnTop = ZERO;
      for (const line of group.lines) {
        line.lineTotal = line.lineSubtotal.minus(line.sellerDiscount).minus(line.platformDiscount);
        const rate = D(line.tax.ratePercent).dividedBy(100);
        if (line.tax.inclusive) {
          line.vatAmount = includedVat(line.lineTotal, rate);
        } else {
          line.vatAmount = cents(line.lineTotal.times(rate));
          taxOnTop = taxOnTop.plus(line.vatAmount);
        }
        // Commission on what the item sold for after the seller's own discount (marketplace-paid
        // discounts do not lower the seller's sale).
        const base = line.lineSubtotal.minus(line.sellerDiscount);
        line.commission = {
          ...line.commission,
          base,
          amount: commissionAmount(line.commission, base, line.quantity),
        };
      }
      group.total = discountedItems
        .plus(taxOnTop)
        .plus(group.shippingFee)
        .minus(group.sellerShippingDiscount)
        .minus(group.platformShippingDiscount)
        .plus(group.chargesTotal);
      group.vatAmount = sum(group.lines.map((l) => l.vatAmount));
      group.commissionAmount = sum(group.lines.map((l) => l.commission.amount));
    }
    const lineTaxes = groups.flatMap((g) => g.lines.map((l) => l.tax));
    const rates = [...new Set(lineTaxes.map((t) => D(t.ratePercent).dividedBy(100).toString()))];

    const promotionDiscount = sum(groups.map((g) => g.promotionDiscount));
    const pointsDiscount = sum(groups.map((g) => g.pointsDiscount));
    const totals = {
      itemsSubtotal: sum(groups.map((g) => g.itemsSubtotal)),
      wholesaleSavings: sum(groups.map((g) => g.wholesaleSavings)),
      promotionDiscount,
      pointsDiscount,
      couponDiscount: sum(groups.map((g) => g.sellerDiscount.plus(g.platformDiscount)))
        .minus(promotionDiscount)
        .minus(pointsDiscount),
      shippingFee: sum(groups.map((g) => g.shippingFee)),
      shippingDiscount: sum(
        groups.map((g) => g.sellerShippingDiscount.plus(g.platformShippingDiscount)),
      ),
      chargesTotal: sum(groups.map((g) => g.chargesTotal)),
      vatAmount: sum(groups.map((g) => g.vatAmount)),
      grandTotal: sum(groups.map((g) => g.total)),
    };

    const unavailable = await this.unavailableMethods(
      customerId,
      totals.grandTotal,
      orderSettings,
      db,
    );
    const reason = unavailable.get(paymentMethod);
    if (reason && settings.paymentMethods.includes(paymentMethod)) {
      problems.push({ path: 'paymentMethod', message: reason });
    }

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
        promotionDiscount: money(g.promotionDiscount),
        pointsDiscount: money(g.pointsDiscount),
        promotions: g.promotions.map((p) => promotionDto(p)),
        charges: g.charges.map((c) => ({ code: c.code, label: c.label, amount: money(c.amount) })),
        vatAmount: money(g.vatAmount),
        total: money(g.total),
        note: g.note,
      })),
      coupons: couponResults,
      loyalty: loyalty.quote,
      affiliate: affiliate.quote,
      paymentMethod,
      paymentMethods: settings.paymentMethods.map((method) => ({
        method,
        label: PAYMENT_METHOD_LABELS[method],
        paymentWindowMinutes:
          method === 'BANK_TRANSFER'
            ? orderSettings.bankTransfer.windowHours * 60
            : ONLINE_PAYMENT_METHODS.includes(method)
              ? settings.paymentWindowMinutes
              : null,
        unavailableReason: unavailable.get(method) ?? null,
      })),
      totals: {
        itemsSubtotal: money(totals.itemsSubtotal),
        wholesaleSavings: money(totals.wholesaleSavings),
        promotionDiscount: money(totals.promotionDiscount),
        couponDiscount: money(totals.couponDiscount),
        pointsDiscount: money(totals.pointsDiscount),
        shippingFee: money(totals.shippingFee),
        shippingDiscount: money(totals.shippingDiscount),
        chargesTotal: money(totals.chargesTotal),
        vatAmount: money(totals.vatAmount),
        grandTotal: money(totals.grandTotal),
      },
      vat: {
        rate: rates.length === 1 ? rates[0]! : null,
        included: lineTaxes.every((t) => t.inclusive),
      },
      problems,
      evaluatedAt: now.toISOString(),
    };
    return {
      quote,
      groups,
      coupons,
      address,
      settings,
      orderSettings,
      buyerType: quote.buyerType,
      paymentMethod,
      grandTotal: totals.grandTotal,
      cartItemIds: requested.flatMap((r) => (r.cartItemId ? [r.cartItemId] : [])),
      points: {
        redeemed: loyalty.quote?.pointsApplied ?? 0,
        discount: pointsDiscount,
        pointValue: loyalty.quote?.pointValue ?? '1',
      },
      affiliate: affiliate.planned,
      totals: { promotionDiscount, couponDiscount: totals.couponDiscount, pointsDiscount },
    };
  }

  /**
   * Methods this order cannot use, with the reason shown to the customer: cash on delivery
   * above the COD limit or for customers with too many failed COD deliveries, and bank
   * transfer while finance has not configured a receiving account.
   */
  private async unavailableMethods(
    customerId: string | null,
    grandTotal: Decimal,
    orderSettings: OrderSettings,
    db: Db,
  ): Promise<Map<PaymentMethod, string>> {
    const result = new Map<PaymentMethod, string>();
    const limit = D(orderSettings.cod.maxOrderAmount);
    if (grandTotal.greaterThan(limit)) {
      result.set(
        'COD',
        `Cash on delivery is available for orders up to ₱${limit.toFixed(2)}. Please choose another payment method.`,
      );
    } else if (customerId && orderSettings.cod.maxFailedDeliveries > 0) {
      // Parcels sent back to the seller without ever being delivered.
      const failed = await db.sellerOrder.count({
        where: {
          status: { in: ['RETURNING_TO_SELLER', 'RETURNED_TO_SELLER'] },
          deliveredAt: null,
          order: { customerId, paymentMethod: 'COD' },
        },
      });
      if (failed >= orderSettings.cod.maxFailedDeliveries) {
        result.set(
          'COD',
          'Cash on delivery is not available on your account because of earlier undelivered orders. Please pay online or by bank transfer.',
        );
      }
    }
    for (const method of ONLINE_PAYMENT_METHODS) {
      if (method !== 'BANK_TRANSFER' && !this.payments.onlineAvailable(method)) {
        result.set(method, `${PAYMENT_METHOD_LABELS[method]} is not available right now.`);
      }
    }
    if (orderSettings.bankTransfer.accounts.length === 0) {
      result.set('BANK_TRANSFER', 'Bank transfer is not available right now.');
    }
    return result;
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
      promotionDiscount: ZERO,
      pointsDiscount: ZERO,
      pointsRedeemed: 0,
      promotions: [],
      campaignFreeShipping: false,
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
      promotionDiscount: money(l.promotionDiscount),
      promotion: l.campaign
        ? { campaignId: l.campaign.id, name: l.campaign.name, type: l.campaign.type }
        : null,
      pointsDiscount: money(l.pointsDiscount),
      lineTotal: money(l.lineSubtotal.minus(l.sellerDiscount).minus(l.platformDiscount)),
      vatAmount: money(l.vatAmount),
    };
  }

  /** Category id → that category and its ancestors (category targets include subcategories). */
  private async categoryPaths(db: Db): Promise<(categoryId: string) => string[]> {
    const rows = await db.category.findMany({ select: { id: true, parentId: true } });
    const parent = new Map(rows.map((r) => [r.id, r.parentId]));
    return (categoryId: string) => {
      const path: string[] = [];
      let current: string | null | undefined = categoryId;
      while (current && path.length < 20 && !path.includes(current)) {
        path.push(current);
        current = parent.get(current);
      }
      return path;
    };
  }

  /** Running campaigns for the sellers in the order (and marketplace-wide ones). */
  private async activeCampaigns(sellerIds: string[], now: Date, db: Db): Promise<EngineCampaign[]> {
    if (sellerIds.length === 0) return [];
    const rows = await db.campaign.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [{ scope: 'PLATFORM' }, { scope: 'SELLER', sellerId: { in: sellerIds } }],
      },
      include: {
        products: { select: { productId: true } },
        categories: { select: { categoryId: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      season: c.season,
      scope: c.scope,
      sellerId: c.sellerId,
      type: c.type,
      value: c.value,
      maxDiscount: c.maxDiscount,
      minQuantity: c.minQuantity,
      buyQuantity: c.buyQuantity,
      getQuantity: c.getQuantity,
      minSpend: c.minSpend,
      appliesTo: c.appliesTo,
      productIds: c.products.map((p) => p.productId),
      categoryIds: c.categories.map((p) => p.categoryId),
      priority: c.priority,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Writes the chosen item promotions onto the lines. A campaign that beats a flash sale is
   * priced from the regular price, and the flash sale unit is not taken.
   */
  private applyItemPromotions(groups: PlannedGroup[], campaigns: EngineCampaign[]) {
    if (campaigns.length === 0) return;
    const lines = groups.flatMap((g) => g.lines);
    const choices = chooseItemPromotions(
      lines.map((l) => l.engine),
      campaigns,
    );
    lines.forEach((line, index) => {
      const choice = choices[index]!;
      if (!choice.campaign) return;
      if (choice.dropsFlashSale) {
        const regular = D(line.price.regularPrice);
        line.price = {
          ...line.price,
          unitPrice: money(regular),
          lineTotal: money(regular.times(line.quantity)),
          source: 'REGULAR',
          rule: null,
          flashSale: null,
        };
        line.lineSubtotal = cents(regular.times(line.quantity));
        line.engine = { ...line.engine, unitPrice: regular, isFlashSale: false };
      }
      const discount = min(choice.discount, line.lineSubtotal);
      line.campaign = choice.campaign;
      line.promotionDiscount = discount;
      if (choice.campaign.scope === 'SELLER')
        line.sellerDiscount = line.sellerDiscount.plus(discount);
      else line.platformDiscount = line.platformDiscount.plus(discount);
    });
    for (const group of groups) {
      for (const line of group.lines) {
        if (!line.campaign || line.promotionDiscount.isZero()) continue;
        group.promotionDiscount = group.promotionDiscount.plus(line.promotionDiscount);
        if (line.campaign.scope === 'SELLER')
          group.sellerDiscount = group.sellerDiscount.plus(line.promotionDiscount);
        else group.platformDiscount = group.platformDiscount.plus(line.promotionDiscount);
        const existing = group.promotions.find((p) => p.campaign.id === line.campaign!.id);
        if (existing) existing.amount = existing.amount.plus(line.promotionDiscount);
        else
          group.promotions.push({
            campaign: line.campaign,
            amount: line.promotionDiscount,
            shippingAmount: ZERO,
          });
      }
    }
  }

  /** Loyalty points: capped by the balance and by maxRedeemPercent of what is left of the items. */
  private async applyPoints(
    userId: string,
    requested: number,
    groups: PlannedGroup[],
    db: Db,
  ): Promise<{ quote: CheckoutQuote['loyalty']; problem: string | null }> {
    const settings = await loyaltySettingsInTx(db);
    const account = await db.loyaltyAccount.findUnique({
      where: { userId },
      select: { balance: true },
    });
    const balance = account?.balance ?? 0;
    const lines = groups.flatMap((g) => g.lines);
    const left = (l: PlannedLine) =>
      l.lineSubtotal.minus(l.sellerDiscount).minus(l.platformDiscount);
    const itemsLeft = sum(lines.map(left));
    const max = maxRedeemablePoints(balance, itemsLeft, settings);
    let message: string | null = null;
    let problem: string | null = null;
    if (requested > 0 && !settings.enabled) problem = 'Loyalty points cannot be used right now.';
    else if (requested > balance) problem = `You have ${balance} points.`;
    else if (requested > max)
      message = `At most ${max} points can be used on this order (${settings.maxRedeemPercent}% of the items).`;
    const points = problem ? 0 : Math.min(requested, max);
    const discount = cents(D(settings.pointValue).times(points));
    if (discount.greaterThan(0)) {
      const parts = allocate(discount, lines.map(left));
      lines.forEach((line, i) => {
        line.pointsDiscount = parts[i]!;
        line.platformDiscount = line.platformDiscount.plus(parts[i]!);
      });
      // Points per seller order, in proportion to their share of the discount.
      const groupDiscounts = groups.map((g) => sum(g.lines.map((l) => l.pointsDiscount)));
      const groupPoints = allocate(D(points).dividedBy(100), groupDiscounts).map((p) =>
        p.times(100).toNumber(),
      );
      groups.forEach((g, i) => {
        g.pointsDiscount = groupDiscounts[i]!;
        g.platformDiscount = g.platformDiscount.plus(groupDiscounts[i]!);
        g.pointsRedeemed = groupPoints[i]!;
      });
    }
    // Points this order would earn when completed (per seller order, whole points).
    const earnEstimate = settings.enabled
      ? groups.reduce((n, g) => n + pointsForAmount(sum(g.lines.map((l) => left(l))), settings), 0)
      : 0;
    return {
      problem,
      quote: {
        balance,
        pointValue: settings.pointValue,
        maxRedeemablePoints: max,
        pointsApplied: points,
        discount: money(discount),
        earnEstimate,
        message,
      },
    };
  }

  private async affiliateFor(
    userId: string,
    code: string | null,
    db: Db,
  ): Promise<{
    quote: CheckoutQuote['affiliate'];
    planned: CheckoutPlan['affiliate'];
  }> {
    if (!code) return { quote: null, planned: null };
    const normalized = code.toUpperCase();
    const settings = await affiliateSettingsInTx(db);
    const account = await db.affiliateAccount.findUnique({ where: { code: normalized } });
    const reject = (message: string) => ({
      quote: { code: normalized, applied: false, message },
      planned: null,
    });
    if (!settings.enabled) return reject('Affiliate links are not active right now.');
    if (!account || account.status !== 'APPROVED')
      return reject('This affiliate link is not active.');
    if (account.userId === userId)
      return reject('Your own affiliate link does not apply to your orders.');
    return {
      quote: { code: normalized, applied: true, message: null },
      planned: {
        accountId: account.id,
        code: normalized,
        rate: account.commissionRate ?? D(settings.defaultCommissionRate),
      },
    };
  }

  /**
   * Validates the codes and works out each coupon's discount, writing the amounts onto the
   * groups and lines. Seller coupons first (they lower what the marketplace coupon applies to).
   * Restricted coupons discount (and count towards the minimum spend) only the items they
   * cover; first-order coupons need a customer with no earlier order that was not cancelled.
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
    const rows = await db.coupon.findMany({
      where: { code: { in: unique } },
      include: {
        products: { select: { productId: true } },
        categories: { select: { categoryId: true } },
      },
    });
    const used = await db.couponRedemption.groupBy({
      by: ['couponId'],
      where: { userId, releasedAt: null, couponId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const earlierOrders = rows.some((r) => r.firstOrderOnly)
      ? await db.order.count({ where: { customerId: userId, status: { not: 'CANCELLED' } } })
      : 0;
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
      if (row.firstOrderOnly && earlierOrders > 0) {
        reject(code, 'This coupon is for your first order only.', row);
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
    const left = (l: PlannedLine) =>
      l.lineSubtotal.minus(l.sellerDiscount).minus(l.platformDiscount);
    for (const row of ordered) {
      const target = {
        appliesTo: row.appliesTo,
        productIds: row.products.map((p) => p.productId),
        categoryIds: row.categories.map((c) => c.categoryId),
      };
      const scoped =
        row.scope === 'SELLER' ? groups.filter((g) => g.sellerId === row.sellerId) : groups;
      const eligible = scoped.flatMap((g) =>
        g.lines.filter((l) => targets(target, l.engine)).map((line) => ({ group: g, line })),
      );
      if (eligible.length === 0) {
        reject(row.code, 'None of the items in your order are covered by this coupon.', row);
        continue;
      }
      // Minimum spend on the covered items, after automatic promotions.
      const spend = sum(eligible.map((e) => e.line.lineSubtotal.minus(e.line.promotionDiscount)));
      if (spend.lessThan(row.minSpend)) {
        reject(row.code, `Spend at least ₱${row.minSpend.toFixed(2)} to use this coupon.`, row);
        continue;
      }
      const bySeller = new Map<string, Decimal>();
      if (row.type === 'FREE_SHIPPING') {
        const parcels = [...new Set(eligible.map((e) => e.group))].filter(
          (g) => !g.campaignFreeShipping,
        );
        if (parcels.length === 0) {
          reject(row.code, 'Shipping is already free with a promotion.', row);
          continue;
        }
        const remaining = parcels.map((g) =>
          g.shippingFee.minus(g.sellerShippingDiscount).minus(g.platformShippingDiscount),
        );
        let total = sum(remaining);
        if (row.maxDiscount) total = min(total, row.maxDiscount);
        const parts = allocate(total, remaining);
        parcels.forEach((g, i) => {
          if (row.scope === 'SELLER')
            g.sellerShippingDiscount = g.sellerShippingDiscount.plus(parts[i]!);
          else g.platformShippingDiscount = g.platformShippingDiscount.plus(parts[i]!);
          bySeller.set(g.sellerId, parts[i]!);
        });
      } else {
        const bases = eligible.map((e) => left(e.line));
        const base = sum(bases);
        let total =
          row.type === 'PERCENTAGE'
            ? cents(base.times(row.value).dividedBy(100))
            : min(row.value, base);
        if (row.type === 'PERCENTAGE' && row.maxDiscount) total = min(total, row.maxDiscount);
        const parts = allocate(total, bases);
        eligible.forEach(({ group, line }, i) => {
          const part = parts[i]!;
          if (row.scope === 'SELLER') {
            line.sellerDiscount = line.sellerDiscount.plus(part);
            group.sellerDiscount = group.sellerDiscount.plus(part);
          } else {
            line.platformDiscount = line.platformDiscount.plus(part);
            group.platformDiscount = group.platformDiscount.plus(part);
          }
          bySeller.set(group.sellerId, (bySeller.get(group.sellerId) ?? ZERO).plus(part));
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

export const promotionDto = (p: PlannedPromotion): AppliedPromotion => ({
  campaignId: p.campaign.id,
  name: p.campaign.name,
  type: p.campaign.type,
  scope: p.campaign.scope,
  season: p.campaign.season,
  amount: money(p.amount),
  shippingAmount: money(p.shippingAmount),
});

export type { ShippingMethod };
