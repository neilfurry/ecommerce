import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import { type AuthenticatedUser, CUSTOMER_ROLES, MAX_PRICE_TIERS } from '@marketplace/shared-types';
import type {
  CustomerPriceDto,
  CustomerPriceInput,
  PricePreviewRequest,
  PriceQuote,
  PriceQuoteLine,
  PriceQuoteRequest,
  ProductDetail,
  ProductPricingRequest,
  PutPriceTiersRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductsService } from '../products/products.service';
import {
  type Buyer,
  calculatePrice,
  QuantityOutOfRangeError,
  type VariantPricing,
} from './price-engine';

const invalid = (message: string, path: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

const overlaps = (
  a: { startsAt: Date | null; endsAt: Date | null },
  b: { startsAt: Date | null; endsAt: Date | null },
) =>
  (a.startsAt === null || b.endsAt === null || a.startsAt < b.endsAt) &&
  (b.startsAt === null || a.endsAt === null || b.startsAt < a.endsAt);

const date = (value: string | null | undefined) => (value ? new Date(value) : null);

const NO_CUSTOMER = '00000000-0000-0000-0000-000000000000';

const variantPricingInclude = (customerId: string | null, now: Date = new Date()) =>
  ({
    product: {
      include: {
        seller: { select: { status: true } },
        store: { select: { status: true } },
        priceTiers: true,
        customerPrices: { where: { customerId: customerId ?? NO_CUSTOMER } },
      },
    },
    // The running flash sale offer, if any (one per variant at a time).
    flashSaleItems: {
      where: {
        status: 'ACTIVE',
        flashSale: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
      },
      include: { flashSale: { select: { startsAt: true, endsAt: true } } },
      orderBy: { createdAt: 'asc' },
      take: 1,
    },
  }) satisfies Prisma.ProductVariantInclude;
export type VariantPricingRow = Prisma.ProductVariantGetPayload<{
  include: ReturnType<typeof variantPricingInclude>;
}>;

export function toPricing(row: VariantPricingRow): VariantPricing {
  const p = row.product;
  const flash = row.flashSaleItems[0];
  return {
    variantId: row.id,
    productId: p.id,
    sellerId: p.sellerId,
    sku: row.sku,
    currency: p.currency,
    regularPrice: row.regularPrice,
    salePrice: row.salePrice,
    saleStartsAt: row.saleStartsAt,
    saleEndsAt: row.saleEndsAt,
    minOrderQuantity: p.minOrderQuantity,
    maxOrderQuantity: p.maxOrderQuantity,
    wholesaleEnabled: p.wholesaleEnabled,
    wholesaleMinOrderQuantity: p.wholesaleMinOrderQuantity,
    tiers: p.priceTiers,
    customerPrices: p.customerPrices,
    flash: flash
      ? {
          itemId: flash.id,
          flashPrice: flash.flashPrice,
          startsAt: flash.flashSale.startsAt,
          endsAt: flash.flashSale.endsAt,
          remaining: flash.quantityLimit - flash.soldQuantity,
          perOrderLimit: flash.perOrderLimit,
        }
      : null,
  };
}

/** Whether shoppers can buy the variant now (approved product of a verified, open seller). */
export const isSellable = (row: VariantPricingRow) =>
  row.status === 'ACTIVE' &&
  row.product.status === 'ACTIVE' &&
  row.product.seller.status === 'VERIFIED' &&
  row.product.store.status === 'ACTIVE';

/** The pricing buyer for a request: wholesale only for approved wholesale customers. */
export function shopperOf(user: AuthenticatedUser | undefined) {
  const shopper = user?.app === 'storefront' ? user : undefined;
  return {
    customerId: shopper?.id ?? null,
    buyer: { wholesale: !!shopper?.roles.includes('WHOLESALE_CUSTOMER') } satisfies Buyer,
  };
}

export interface EvaluatedLine {
  variantId: string;
  quantity: number;
  row: VariantPricingRow | null;
  line: PriceQuoteLine | null;
  /** Why the line cannot be priced (not sellable, quantity outside the limits). */
  problem: string | null;
}

/**
 * Price rules (product configuration, wholesale tiers, customer prices) and the server-side
 * price calculation. Clients only ever send variant ids and quantities.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  // ---- Calculation ------------------------------------------------------------------------

  /**
   * POST /pricing/quote: the price the signed-in customer (or a guest) pays now, per line.
   * Only products shoppers can see are quoted.
   */
  async quote(user: AuthenticatedUser | undefined, input: PriceQuoteRequest): Promise<PriceQuote> {
    const { customerId, buyer } = shopperOf(user);
    const now = new Date();
    const evaluated = await this.evaluate(
      input.items.map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) })),
      buyer,
      customerId,
      now,
    );
    const lines = evaluated.map((e, index) => {
      if (!e.row || !isSellable(e.row))
        throw invalid('This item is not available.', `items.${index}.variantId`);
      if (!e.line) throw invalid(e.problem ?? 'Not available', `items.${index}.quantity`);
      return e.line;
    });
    return { lines, evaluatedAt: now.toISOString() };
  }

  /**
   * Prices several lines at once for one buyer, reporting a problem per line instead of
   * failing: the cart and checkout show every problem together. `db` lets checkout price
   * inside its transaction.
   */
  async evaluate(
    items: { variantId: string; quantity: number }[],
    buyer: Buyer,
    customerId: string | null,
    now: Date,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<EvaluatedLine[]> {
    const ids = [...new Set(items.map((i) => i.variantId))];
    const rows = ids.length
      ? await db.productVariant.findMany({
          where: { id: { in: ids } },
          include: variantPricingInclude(customerId, now),
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return items.map((item) => {
      const row = byId.get(item.variantId) ?? null;
      if (!row || !isSellable(row)) {
        return { ...item, row, line: null, problem: 'This item is no longer available.' };
      }
      try {
        return {
          ...item,
          row,
          line: calculatePrice(toPricing(row), item.quantity, buyer, now),
          problem: null,
        };
      } catch (error) {
        if (error instanceof QuantityOutOfRangeError) {
          return { ...item, row, line: null, problem: error.message };
        }
        throw error;
      }
    });
  }

  /** Prices for one product at quantity 1 for a shopper (public product page). */
  async pricesFor(user: AuthenticatedUser | undefined, variantIds: string[], minQuantity: number) {
    if (variantIds.length === 0) return [];
    const quote = await this.quote(user, {
      items: variantIds.map((variantId) => ({ variantId, quantity: minQuantity })),
    });
    return quote.lines;
  }

  /** Seller Center simulator: what a retail or wholesale buyer (or a named customer) would pay. */
  async preview(
    user: AuthenticatedUser,
    productId: string,
    input: PricePreviewRequest,
  ): Promise<PriceQuoteLine> {
    const { sellerId } = sellerScope(user);
    await this.products.findOwn(sellerId, productId);
    let customerId: string | null = null;
    if (input.customerEmail)
      customerId = (await this.findCustomer(input.customerEmail, 'customerEmail')).id;
    const row = await this.prisma.productVariant.findFirst({
      where: { id: input.variantId, productId },
      include: variantPricingInclude(customerId),
    });
    if (!row) throw invalid('Choose a variant of this product.', 'variantId');
    return this.calculate(
      toPricing(row),
      Number(input.quantity),
      { wholesale: input.buyer === 'WHOLESALE' },
      new Date(),
      'quantity',
    );
  }

  private calculate(data: VariantPricing, quantity: number, buyer: Buyer, now: Date, path: string) {
    try {
      return calculatePrice(data, quantity, buyer, now);
    } catch (error) {
      if (error instanceof QuantityOutOfRangeError) throw invalid(error.message, path);
      throw error;
    }
  }

  // ---- Product configuration ------------------------------------------------------------------

  async setProductPricing(
    user: AuthenticatedUser,
    productId: string,
    input: ProductPricingRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.assertCanPrice(user);
    const product = await this.products.findOwn(sellerId, productId);
    const currency = input.currency ?? 'PHP';
    const active = await this.prisma.currency.findFirst({
      where: { code: currency, isActive: true },
    });
    if (!active) throw invalid('This currency is not supported.', 'currency');
    const data = {
      currency,
      minOrderQuantity: Number(input.minOrderQuantity),
      maxOrderQuantity:
        input.maxOrderQuantity === null || input.maxOrderQuantity === undefined
          ? null
          : Number(input.maxOrderQuantity),
      wholesaleEnabled: input.wholesaleEnabled,
      wholesaleMinOrderQuantity: Number(input.wholesaleMinOrderQuantity),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data });
      await this.audit.record(
        {
          action: 'product.pricing_updated',
          actorId: user.id,
          entityType: 'product',
          entityId: productId,
          metadata: {
            from: {
              currency: product.currency,
              minOrderQuantity: product.minOrderQuantity,
              maxOrderQuantity: product.maxOrderQuantity,
              wholesaleEnabled: product.wholesaleEnabled,
              wholesaleMinOrderQuantity: product.wholesaleMinOrderQuantity,
            },
            to: data,
          },
        },
        context,
        tx,
      );
    });
    return this.products.get(user, productId);
  }

  /**
   * Replaces the product's wholesale tiers. Within one variant (or product-wide), tiers that
   * apply at the same time need different quantities, and more units never cost more each.
   */
  async putTiers(
    user: AuthenticatedUser,
    productId: string,
    input: PutPriceTiersRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.assertCanPrice(user);
    await this.products.findOwn(sellerId, productId);
    const variantIds = new Set(
      (
        await this.prisma.productVariant.findMany({ where: { productId }, select: { id: true } })
      ).map((v) => v.id),
    );
    const tiers = input.tiers.map((t, index) => ({
      index,
      variantId: t.variantId ?? null,
      minQuantity: Number(t.minQuantity),
      unitPrice: new Prisma.Decimal(t.unitPrice),
      startsAt: date(t.startsAt),
      endsAt: date(t.endsAt),
    }));
    const groups = new Map<string, typeof tiers>();
    for (const tier of tiers) {
      if (tier.variantId && !variantIds.has(tier.variantId)) {
        throw invalid('Choose a variant of this product.', `tiers.${tier.index}.variantId`);
      }
      const key = tier.variantId ?? 'product';
      groups.set(key, [...(groups.get(key) ?? []), tier]);
    }
    for (const group of groups.values()) {
      if (group.length > MAX_PRICE_TIERS) {
        throw invalid(`At most ${MAX_PRICE_TIERS} tiers per variant.`, 'tiers');
      }
      for (const a of group) {
        for (const b of group) {
          if (a.index >= b.index || !overlaps(a, b)) continue;
          if (a.minQuantity === b.minQuantity) {
            throw invalid(
              `Two tiers start at ${a.minQuantity} units at the same time.`,
              `tiers.${b.index}.minQuantity`,
            );
          }
          const [small, large] = a.minQuantity < b.minQuantity ? [a, b] : [b, a];
          if (large.unitPrice.greaterThan(small.unitPrice)) {
            throw invalid(
              `Buying ${large.minQuantity}+ units cannot cost more each than ${small.minQuantity}+.`,
              `tiers.${large.index}.unitPrice`,
            );
          }
        }
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.priceTier.deleteMany({ where: { productId } });
      if (tiers.length > 0) {
        await tx.priceTier.createMany({
          data: tiers.map(({ index: _index, ...t }) => ({ productId, ...t })),
        });
      }
      await this.audit.record(
        {
          action: 'product.price_tiers_updated',
          actorId: user.id,
          entityType: 'product',
          entityId: productId,
          metadata: {
            tiers: tiers.map((t) => ({
              variantId: t.variantId,
              minQuantity: t.minQuantity,
              unitPrice: t.unitPrice.toFixed(2),
            })),
          },
        },
        context,
        tx,
      );
    });
    return this.products.get(user, productId);
  }

  // ---- Customer prices -----------------------------------------------------------------------

  async listCustomerPrices(
    user: AuthenticatedUser,
    productId: string,
  ): Promise<{ items: CustomerPriceDto[] }> {
    const { sellerId } = sellerScope(user);
    await this.products.findOwn(sellerId, productId);
    const rows = await this.prisma.customerPrice.findMany({
      where: { productId },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        variant: { select: { title: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        customer: {
          id: r.customer.id,
          name: `${r.customer.firstName} ${r.customer.lastName}`,
          email: r.customer.email,
        },
        variantId: r.variantId,
        variantTitle: r.variant?.title ?? null,
        minQuantity: r.minQuantity,
        unitPrice: r.unitPrice.toFixed(2),
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async addCustomerPrice(
    user: AuthenticatedUser,
    productId: string,
    input: CustomerPriceInput,
    context: RequestContext,
  ): Promise<{ items: CustomerPriceDto[] }> {
    const { sellerId } = this.assertCanPrice(user);
    await this.products.findOwn(sellerId, productId);
    const customer = await this.findCustomer(input.customerEmail, 'customerEmail');
    const variantId = input.variantId ?? null;
    if (variantId) {
      const exists = await this.prisma.productVariant.count({
        where: { id: variantId, productId },
      });
      if (!exists) throw invalid('Choose a variant of this product.', 'variantId');
    }
    const rule = {
      minQuantity: Number(input.minQuantity ?? 1),
      startsAt: date(input.startsAt),
      endsAt: date(input.endsAt),
    };
    const clash = (
      await this.prisma.customerPrice.findMany({
        where: { productId, customerId: customer.id, variantId, minQuantity: rule.minQuantity },
      })
    ).find((existing) => overlaps(existing, rule));
    if (clash) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'This customer already has a price for the same item, quantity and dates.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerPrice.create({
        data: {
          productId,
          variantId,
          customerId: customer.id,
          ...rule,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          note: input.note ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'product.customer_price_added',
          actorId: user.id,
          entityType: 'product',
          entityId: productId,
          metadata: {
            customerPriceId: created.id,
            customerId: customer.id,
            unitPrice: input.unitPrice,
          },
        },
        context,
        tx,
      );
    });
    return this.listCustomerPrices(user, productId);
  }

  async removeCustomerPrice(
    user: AuthenticatedUser,
    productId: string,
    id: string,
    context: RequestContext,
  ): Promise<{ items: CustomerPriceDto[] }> {
    const { sellerId } = this.assertCanPrice(user);
    await this.products.findOwn(sellerId, productId);
    const { count } = await this.prisma.customerPrice.deleteMany({ where: { id, productId } });
    if (count === 0)
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Customer price not found.');
    await this.audit.record(
      {
        action: 'product.customer_price_removed',
        actorId: user.id,
        entityType: 'product',
        entityId: productId,
        metadata: { customerPriceId: id },
      },
      context,
    );
    return this.listCustomerPrices(user, productId);
  }

  private assertCanPrice(user: AuthenticatedUser) {
    const scope = sellerScope(user);
    this.products.assertPermission(user, 'seller.pricing.manage');
    this.products.assertVerified(user);
    return scope;
  }

  private async findCustomer(email: string, path: string) {
    const customer = await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        status: 'ACTIVE',
        roles: { some: { roleCode: { in: [...CUSTOMER_ROLES] } } },
      },
      select: { id: true },
    });
    if (!customer) throw invalid('No customer account uses this email.', path);
    return customer;
  }
}
