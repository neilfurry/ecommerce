import { Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { ProductCard } from '@marketplace/validation';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isActive } from '../pricing/price-engine';
import { productImageUrl } from '../products/product-mapping';

/** What shoppers may see: approved products of verified sellers, in open stores and active categories. */
export const shopperVisible: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  seller: { status: 'VERIFIED' },
  store: { status: 'ACTIVE' },
  category: { status: 'ACTIVE' },
};

const cardInclude = (now: Date) =>
  ({
    store: { select: { name: true, slug: true } },
    brand: { select: { name: true } },
    images: { orderBy: { position: 'asc' }, take: 1 },
    variants: {
      where: { status: 'ACTIVE' },
      include: {
        stockLevels: { where: { warehouse: { status: 'ACTIVE' } } },
        flashSaleItems: {
          where: {
            status: 'ACTIVE',
            flashSale: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
          },
          include: { flashSale: { select: { endsAt: true } } },
        },
      },
    },
  }) satisfies Prisma.ProductInclude;
type CardRow = Prisma.ProductGetPayload<{ include: ReturnType<typeof cardInclude> }>;

/** Builds product cards (list tiles) with current prices, stock, rating and flash sale badge. */
@Injectable()
export class ProductCardsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cards for the given products, in the given order; products shoppers cannot see are left out. */
  async cards(ids: string[], now = new Date()): Promise<ProductCard[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, ...shopperVisible },
      include: cardInclude(now),
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is CardRow => !!r && r.variants.length > 0)
      .map((r) => this.toCard(r, now));
  }

  /** Visible product ids matching a filter, in an order (for home page sections). */
  async idsWhere(
    where: Prisma.ProductWhereInput,
    orderBy: Prisma.ProductOrderByWithRelationInput[],
    take: number,
  ): Promise<string[]> {
    const rows = await this.prisma.product.findMany({
      where: { ...where, ...shopperVisible, variants: { some: { status: 'ACTIVE' } } },
      select: { id: true },
      orderBy,
      take,
    });
    return rows.map((r) => r.id);
  }

  private toCard(r: CardRow, now: Date): ProductCard {
    let fromPrice: Prisma.Decimal | null = null;
    let regularFrom: Prisma.Decimal | null = null;
    let flash: ProductCard['flashSale'] = null;
    let inStock = false;
    for (const v of r.variants) {
      let price =
        v.salePrice && isActive({ startsAt: v.saleStartsAt, endsAt: v.saleEndsAt }, now)
          ? v.salePrice
          : v.regularPrice;
      for (const f of v.flashSaleItems) {
        const remaining = f.quantityLimit - f.soldQuantity;
        if (remaining <= 0 || !f.flashPrice.lessThan(price)) continue;
        price = f.flashPrice;
        if (!flash || f.flashPrice.lessThan(flash.price)) {
          flash = {
            itemId: f.id,
            price: f.flashPrice.toFixed(2),
            endsAt: f.flashSale.endsAt.toISOString(),
            remaining,
            quantityLimit: f.quantityLimit,
          };
        }
      }
      if (!fromPrice || price.lessThan(fromPrice)) fromPrice = price;
      if (!regularFrom || v.regularPrice.lessThan(regularFrom)) regularFrom = v.regularPrice;
      const available = v.stockLevels.reduce(
        (sum, l) => sum + l.quantityOnHand - l.reservedQuantity,
        0,
      );
      if (!v.trackInventory || available >= r.minOrderQuantity) inStock = true;
    }
    const image = r.images[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      storeName: r.store.name,
      storeSlug: r.store.slug,
      brandName: r.brand?.name ?? null,
      thumbnailUrl: image ? productImageUrl(image.id, image.thumbnailFileId, 'thumbnail') : null,
      currency: r.currency,
      fromPrice: fromPrice!.toFixed(2),
      regularFromPrice: regularFrom!.toFixed(2),
      wholesaleAvailable: r.wholesaleEnabled,
      ratingAverage: r.ratingAverage.toNumber(),
      ratingCount: r.ratingCount,
      soldCount: r.soldCount,
      inStock,
      flashSale: flash,
    };
  }
}
