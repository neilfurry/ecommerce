import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
} from '@marketplace/shared-types';
import type {
  CartDto,
  CartLine,
  CartLineInput,
  GuestCartRequest,
  UpdateCartLineRequest,
} from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PricingService, shopperOf } from '../pricing/pricing.service';
import { productImageUrl } from '../products/product-mapping';

interface RawLine {
  id: string;
  variantId: string;
  quantity: number;
  savedForLater: boolean;
  lastSeenPrice: Prisma.Decimal | null;
}

const lineInclude = {
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
type LineVariant = Prisma.ProductVariantGetPayload<{ include: typeof lineInclude }>;

export const availableOf = (v: {
  trackInventory: boolean;
  stockLevels: { quantityOnHand: number; reservedQuantity: number }[];
}) =>
  v.trackInventory
    ? Math.max(
        0,
        v.stockLevels.reduce((s, l) => s + l.quantityOnHand - l.reservedQuantity, 0),
      )
    : null;

export const optionsOf = (v: LineVariant | { optionValues: LineVariant['optionValues'] }) =>
  Object.fromEntries(
    [...v.optionValues]
      .sort((a, b) => a.optionValue.option.position - b.optionValue.option.position)
      .map((ov) => [ov.optionValue.option.name, ov.optionValue.value]),
  );

export const thumbnailOf = (v: LineVariant) => {
  const image = v.images[0] ?? v.product.images[0];
  return image ? productImageUrl(image.id, image.thumbnailFileId, 'thumbnail') : null;
};

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Cart item not found.');

/**
 * Shopping carts. Signed-in customers' carts live in the database; guests keep theirs in the
 * browser and send it to be priced. Every read re-prices every line and re-checks stock on
 * the server, so a cart never shows a price or availability the server would not honour.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async view(user: AuthenticatedUser): Promise<CartDto> {
    const rows = await this.prisma.cartItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    const cart = await this.build(user, rows);
    // Remember the prices shown, so the next view only flags changes made after this one.
    const updates = [...cart.groups.flatMap((g) => g.lines), ...cart.saved].filter(
      (l) => l.price && l.previousUnitPrice !== undefined,
    );
    await Promise.all(
      updates.map((l) => {
        const row = rows.find((r) => r.id === l.id);
        return row && (!row.lastSeenPrice || row.lastSeenPrice.toFixed(2) !== l.price!.unitPrice)
          ? this.prisma.cartItem.update({
              where: { id: row.id },
              data: { lastSeenPrice: new Prisma.Decimal(l.price!.unitPrice) },
            })
          : null;
      }),
    );
    return cart;
  }

  /** Prices a guest's browser cart (nothing is stored). */
  preview(user: AuthenticatedUser | undefined, input: GuestCartRequest): Promise<CartDto> {
    return this.build(
      user,
      input.items.map((i) => ({
        id: i.variantId,
        variantId: i.variantId,
        quantity: Number(i.quantity),
        savedForLater: i.savedForLater ?? false,
        lastSeenPrice: null,
      })),
    );
  }

  async add(user: AuthenticatedUser, input: CartLineInput): Promise<CartDto> {
    const quantity = Number(input.quantity);
    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_variantId: { userId: user.id, variantId: input.variantId } },
    });
    const total = Math.min(
      (existing && !existing.savedForLater ? existing.quantity : 0) + quantity,
      MAX_LINE_QUANTITY,
    );
    await this.assertCanBuy(input.variantId, total);
    if (!existing) {
      const count = await this.prisma.cartItem.count({ where: { userId: user.id } });
      if (count >= MAX_CART_LINES) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          `Your cart can hold up to ${MAX_CART_LINES} items.`,
        );
      }
    }
    await this.prisma.cartItem.upsert({
      where: { userId_variantId: { userId: user.id, variantId: input.variantId } },
      create: {
        userId: user.id,
        variantId: input.variantId,
        quantity: total,
        savedForLater: input.savedForLater ?? false,
      },
      update: { quantity: total, savedForLater: input.savedForLater ?? false },
    });
    return this.view(user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCartLineRequest,
  ): Promise<CartDto> {
    const row = await this.prisma.cartItem.findFirst({ where: { id, userId: user.id } });
    if (!row) throw notFound();
    const quantity = input.quantity !== undefined ? Number(input.quantity) : row.quantity;
    const saved = input.savedForLater ?? row.savedForLater;
    if (!saved && (input.quantity !== undefined || row.savedForLater)) {
      await this.assertCanBuy(row.variantId, quantity);
    }
    await this.prisma.cartItem.update({ where: { id }, data: { quantity, savedForLater: saved } });
    return this.view(user);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<CartDto> {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id, userId: user.id } });
    if (!count) throw notFound();
    return this.view(user);
  }

  /**
   * Adds a guest's browser cart after sign-in. Lines already in the account keep the larger
   * quantity; items that cannot be bought any more are skipped rather than failing.
   */
  async merge(user: AuthenticatedUser, input: GuestCartRequest): Promise<CartDto> {
    const existing = await this.prisma.cartItem.findMany({ where: { userId: user.id } });
    let room = MAX_CART_LINES - existing.length;
    const variants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: input.items.map((i) => i.variantId) },
        status: 'ACTIVE',
        product: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    const valid = new Set(variants.map((v) => v.id));
    for (const item of input.items) {
      if (!valid.has(item.variantId)) continue;
      const current = existing.find((e) => e.variantId === item.variantId);
      const quantity = Math.min(Number(item.quantity), MAX_LINE_QUANTITY);
      if (current) {
        if (quantity > current.quantity) {
          await this.prisma.cartItem.update({ where: { id: current.id }, data: { quantity } });
        }
      } else if (room > 0) {
        await this.prisma.cartItem.create({
          data: {
            userId: user.id,
            variantId: item.variantId,
            quantity,
            savedForLater: item.savedForLater ?? false,
          },
        });
        room -= 1;
      }
    }
    return this.view(user);
  }

  /** Refuses quantities above what can be bought right now (stock, order limits). */
  private async assertCanBuy(variantId: string, quantity: number) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        stockLevels: { where: { warehouse: { status: 'ACTIVE' } } },
        product: { include: { seller: true, store: true } },
      },
    });
    if (
      !variant ||
      variant.status !== 'ACTIVE' ||
      variant.product.status !== 'ACTIVE' ||
      variant.product.seller.status !== 'VERIFIED' ||
      variant.product.store.status !== 'ACTIVE'
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'This item is not available.',
        [{ path: 'variantId', message: 'Not available' }],
      );
    }
    const max = variant.product.maxOrderQuantity;
    if (max !== null && quantity > max) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        `At most ${max} per order.`,
        [{ path: 'quantity', message: `At most ${max} per order` }],
      );
    }
    const available = availableOf(variant);
    if (available !== null && quantity > available) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'INSUFFICIENT_STOCK',
        available === 0 ? 'This item is out of stock.' : `Only ${available} left in stock.`,
      );
    }
  }

  private async build(user: AuthenticatedUser | undefined, rows: RawLine[]): Promise<CartDto> {
    const { customerId, buyer } = shopperOf(user);
    const now = new Date();
    const variants = rows.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: rows.map((r) => r.variantId) } },
          include: lineInclude,
        })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));
    const evaluated = await this.pricing.evaluate(
      rows.map((r) => ({ variantId: r.variantId, quantity: r.quantity })),
      buyer,
      customerId,
      now,
    );
    const lines: (CartLine & { sellerId: string; store: CartDto['groups'][number]['store'] })[] =
      [];
    rows.forEach((row, index) => {
      const variant = byId.get(row.variantId);
      if (!variant) return; // Deleted variant: the cart_items row is removed with it.
      const priced = evaluated[index]!;
      const available = availableOf(variant);
      let problem = priced.problem;
      if (!problem && available !== null && row.quantity > available) {
        problem = available === 0 ? 'Out of stock' : `Only ${available} left in stock`;
      }
      const price = priced.line;
      lines.push({
        id: row.id,
        variantId: variant.id,
        productId: variant.productId,
        productName: variant.product.name,
        productSlug: variant.product.slug,
        variantTitle: variant.title,
        options: optionsOf(variant),
        imageUrl: thumbnailOf(variant),
        quantity: row.quantity,
        savedForLater: row.savedForLater,
        price,
        previousUnitPrice:
          price && row.lastSeenPrice && row.lastSeenPrice.toFixed(2) !== price.unitPrice
            ? row.lastSeenPrice.toFixed(2)
            : null,
        availableQuantity: available,
        problem,
        sellerId: variant.sellerId,
        store: variant.product.store,
      });
    });
    const active = lines.filter((l) => !l.savedForLater);
    const groups = new Map<string, CartDto['groups'][number]>();
    for (const { sellerId, store, ...line } of active) {
      const group = groups.get(sellerId) ?? { sellerId, store, lines: [], subtotal: '0.00' };
      group.lines.push(line);
      groups.set(sellerId, group);
    }
    const sum = (values: Prisma.Decimal[]) =>
      values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
    for (const group of groups.values()) {
      group.subtotal = sum(
        group.lines.flatMap((l) => (l.price ? [new Prisma.Decimal(l.price.lineTotal)] : [])),
      ).toFixed(2);
    }
    const priced = active.filter((l) => l.price);
    const savings = sum(
      priced
        .filter((l) => l.price!.source === 'WHOLESALE_TIER')
        .map((l) =>
          new Prisma.Decimal(l.price!.regularPrice).minus(l.price!.unitPrice).times(l.quantity),
        ),
    );
    return {
      groups: [...groups.values()],
      saved: lines.filter((l) => l.savedForLater).map(({ sellerId: _s, store: _st, ...l }) => l),
      itemCount: active.reduce((n, l) => n + l.quantity, 0),
      subtotal: sum(priced.map((l) => new Prisma.Decimal(l.price!.lineTotal))).toFixed(2),
      wholesaleSavings: savings.toFixed(2),
      currency: 'PHP',
      buyerIsWholesale: buyer.wholesale,
      ready: active.length > 0 && active.every((l) => !l.problem && l.price),
    };
  }
}
