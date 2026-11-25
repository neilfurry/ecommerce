import { HttpStatus, Injectable } from '@nestjs/common';
import { API_DEFAULT_VERSION } from '@marketplace/config';
import { Prisma } from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  ProductSearchQuery,
  ProductSearchResult,
  SearchSuggestions,
  StorefrontProduct,
} from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CategoriesService } from '../catalog/categories.service';
import { shopperOf } from '../pricing/pricing.service';
import { PricingService } from '../pricing/pricing.service';
import { imageDto } from '../products/product-mapping';
import { ProductCardsService, shopperVisible } from './product-cards.service';
import { SearchProvider } from './search/search-provider';

const base = `/api/v${API_DEFAULT_VERSION}`;
export const storeImageUrl = (storeId: string, kind: 'logo' | 'banner', fileId: string | null) =>
  fileId ? `${base}/stores/${storeId}/${kind}?v=${fileId}` : null;

const productPageInclude = {
  store: true,
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true } },
  options: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
  variants: {
    where: { status: 'ACTIVE' },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      optionValues: { include: { optionValue: { include: { option: true } } } },
      stockLevels: { where: { warehouse: { status: 'ACTIVE' } } },
    },
  },
  images: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  priceTiers: { orderBy: [{ minQuantity: 'asc' }] },
} satisfies Prisma.ProductInclude;

/** Search, suggestions and product pages for shoppers. */
@Injectable()
export class StorefrontCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchProvider,
    private readonly cards: ProductCardsService,
    private readonly categories: CategoriesService,
    private readonly pricing: PricingService,
  ) {}

  /** A category and all its subcategories, by id or link name (null: unknown/inactive). */
  async categoryTree(idOrSlug: { id?: string; slug?: string }): Promise<string[] | null> {
    const all = await this.prisma.category.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, parentId: true },
    });
    const root = all.find((c) => c.id === idOrSlug.id || c.slug === idOrSlug.slug);
    if (!root) return null;
    const ids = [root.id];
    for (let i = 0; i < ids.length; i++)
      ids.push(...all.filter((c) => c.parentId === ids[i]).map((c) => c.id));
    return ids;
  }

  async searchProducts(query: ProductSearchQuery): Promise<ProductSearchResult> {
    let categoryIds: string[] | undefined;
    if (query.categoryId || query.category) {
      const tree = await this.categoryTree({ id: query.categoryId, slug: query.category });
      if (!tree) return this.empty(query);
      categoryIds = tree;
    }
    const result = await this.search.search({
      q: query.q,
      categoryIds,
      storeId: query.storeId,
      sellerId: query.sellerId,
      brandIds: query.brandIds,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      minRating: query.minRating,
      inStock: query.inStock,
      wholesale: query.wholesale,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });
    const [items, brands, categories, stores] = await Promise.all([
      this.cards.cards(result.ids),
      this.prisma.brand.findMany({
        where: { id: { in: result.facets.brands.map((f) => f.id) } },
        select: { id: true, name: true },
      }),
      this.prisma.category.findMany({
        where: { id: { in: result.facets.categories.map((f) => f.id) } },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.store.findMany({
        where: { id: { in: result.facets.stores.map((f) => f.id) } },
        select: { id: true, name: true, slug: true },
      }),
    ]);
    const named = <T extends { id: string }>(counts: { id: string; count: number }[], rows: T[]) =>
      counts.flatMap((c) => {
        const row = rows.find((r) => r.id === c.id);
        return row ? [{ ...row, count: c.count }] : [];
      });
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      totalItems: result.total,
      totalPages: Math.ceil(result.total / query.pageSize),
      facets: {
        brands: named(result.facets.brands, brands),
        categories: named(result.facets.categories, categories),
        stores: named(result.facets.stores, stores),
        priceRange: result.facets.priceRange,
      },
      engine: this.search.name,
    };
  }

  private empty(query: ProductSearchQuery): ProductSearchResult {
    return {
      items: [],
      page: query.page,
      pageSize: query.pageSize,
      totalItems: 0,
      totalPages: 0,
      facets: { brands: [], categories: [], stores: [], priceRange: null },
      engine: this.search.name,
    };
  }

  async suggest(q: string): Promise<SearchSuggestions> {
    const term = q.trim();
    if (term.length < 2) return { products: [], categories: [], stores: [] };
    const [found, categories, stores] = await Promise.all([
      this.search.search({ q: term, sort: 'relevance', page: 1, pageSize: 6 }),
      this.prisma.category.findMany({
        where: { status: 'ACTIVE', name: { contains: term, mode: 'insensitive' } },
        select: { id: true, name: true, slug: true },
        take: 4,
      }),
      this.prisma.store.findMany({
        where: {
          status: 'ACTIVE',
          seller: { status: 'VERIFIED' },
          name: { contains: term, mode: 'insensitive' },
        },
        select: { id: true, name: true, slug: true },
        take: 4,
      }),
    ]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: found.ids } },
      select: { id: true, name: true, slug: true },
    });
    return {
      products: found.ids.flatMap((id) => products.filter((p) => p.id === id)),
      categories,
      stores,
    };
  }

  /** One product as a shopper sees it, priced for that shopper (retail, flash, wholesale, agreed). */
  async product(user: AuthenticatedUser | undefined, id: string): Promise<StorefrontProduct> {
    const row = await this.prisma.product.findFirst({
      where: { id, ...shopperVisible },
      include: productPageInclude,
    });
    if (!row || row.variants.length === 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product not found.');
    }
    const { customerId, buyer } = shopperOf(user);
    const now = new Date();
    const [attributes, chain, evaluated, breakdown, wishlisted] = await Promise.all([
      this.categories.effectiveAttributes(row.categoryId),
      this.categories.ancestry(row.categoryId),
      this.pricing.evaluate(
        row.variants.map((v) => ({ variantId: v.id, quantity: row.minOrderQuantity })),
        buyer,
        customerId,
        now,
      ),
      this.prisma.productReview.groupBy({
        by: ['rating'],
        where: { productId: id, status: 'PUBLISHED' },
        _count: { _all: true },
      }),
      customerId
        ? this.prisma.wishlistItem.count({ where: { userId: customerId, productId: id } })
        : Promise.resolve(0),
    ]);
    const values = (row.attributeValues ?? {}) as Record<string, string | number | boolean>;
    const chainIds = new Set(chain.map((c) => c.id));
    const slugs = await this.prisma.category.findMany({
      where: { id: { in: [...chainIds] } },
      select: { id: true, slug: true },
    });
    const activeTiers = row.priceTiers.filter(
      (t) => (!t.startsAt || t.startsAt <= now) && (!t.endsAt || now < t.endsAt),
    );
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      store: {
        id: row.store.id,
        name: row.store.name,
        slug: row.store.slug,
        logoUrl: storeImageUrl(row.store.id, 'logo', row.store.logoFileId),
        city: row.store.city,
        province: row.store.province,
      },
      category: {
        id: row.category.id,
        name: row.category.name,
        slug: row.category.slug,
        path: chain.map((c) => ({
          id: c.id,
          name: c.name,
          slug: slugs.find((s) => s.id === c.id)?.slug ?? '',
        })),
      },
      brand: row.brand,
      specifications: Array.isArray(row.specifications)
        ? (row.specifications as { name: string; value: string }[])
        : [],
      attributes: attributes.attributes
        .filter((a) => values[a.code] !== undefined)
        .map((a) => {
          const v = values[a.code]!;
          const text = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
          return { name: a.name, value: a.unit ? `${text} ${a.unit}` : text };
        }),
      images: row.images.map(imageDto),
      options: row.options.map((o) => ({
        id: o.id,
        name: o.name,
        position: o.position,
        values: o.values.map((v) => ({ id: v.id, value: v.value, position: v.position })),
      })),
      variants: row.variants.map((v) => {
        const available = v.stockLevels.reduce(
          (sum, l) => sum + l.quantityOnHand - l.reservedQuantity,
          0,
        );
        return {
          id: v.id,
          sku: v.sku,
          title: v.title,
          options: Object.fromEntries(
            [...v.optionValues]
              .sort((a, b) => a.optionValue.option.position - b.optionValue.option.position)
              .map((ov) => [ov.optionValue.option.name, ov.optionValue.value]),
          ),
          availableQuantity: v.trackInventory ? Math.max(available, 0) : null,
          available: !v.trackInventory || available >= row.minOrderQuantity,
          weightGrams: v.weightGrams,
        };
      }),
      prices: evaluated.flatMap((e) => (e.line ? [e.line] : [])),
      minOrderQuantity: row.minOrderQuantity,
      maxOrderQuantity: row.maxOrderQuantity,
      wholesale:
        row.wholesaleEnabled && activeTiers.length > 0
          ? {
              minOrderQuantity: row.wholesaleMinOrderQuantity,
              tiers: activeTiers.map((t) => ({
                variantId: t.variantId,
                minQuantity: t.minQuantity,
                unitPrice: t.unitPrice.toFixed(2),
              })),
            }
          : null,
      buyerIsWholesale: buyer.wholesale,
      ratingAverage: row.ratingAverage.toNumber(),
      ratingCount: row.ratingCount,
      ratingBreakdown: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: breakdown.find((b) => b.rating === rating)?._count._all ?? 0,
      })),
      soldCount: row.soldCount,
      wishlisted: wishlisted > 0,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
    };
  }
}
