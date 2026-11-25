import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type {
  PublicProduct,
  publicProductCardSchema,
  publicProductListQuerySchema,
} from '@marketplace/validation';
import type { z } from 'zod';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isActive } from '../pricing/price-engine';
import { PricingService } from '../pricing/pricing.service';
import { CategoriesService } from '../catalog/categories.service';
import { imageDto, productDetailInclude, productImageUrl, variantDto } from './product-mapping';

type Card = z.infer<typeof publicProductCardSchema>;
type Query = z.infer<typeof publicProductListQuerySchema>;

/** What shoppers may see: approved products of verified sellers, in open stores and active categories. */
export const shopperVisible: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  seller: { status: 'VERIFIED' },
  store: { status: 'ACTIVE' },
  category: { status: 'ACTIVE' },
};

@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly categories: CategoriesService,
  ) {}

  async list(query: Query): Promise<PaginatedResponse<Card>> {
    let categoryIds: string[] | undefined;
    if (query.categoryId) {
      // A category includes its subcategories.
      const all = await this.prisma.category.findMany({ select: { id: true, parentId: true } });
      categoryIds = [query.categoryId];
      for (let i = 0; i < categoryIds.length; i++) {
        categoryIds.push(...all.filter((c) => c.parentId === categoryIds![i]).map((c) => c.id));
      }
    }
    const where: Prisma.ProductWhereInput = {
      ...shopperVisible,
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          store: { select: { name: true, slug: true } },
          images: { orderBy: { position: 'asc' }, take: 1 },
          variants: { where: { status: 'ACTIVE' } },
        },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    const now = new Date();
    return {
      items: rows
        .filter((r) => r.variants.length > 0)
        .map((r) => {
          const current = r.variants.map((v) =>
            v.salePrice && isActive({ startsAt: v.saleStartsAt, endsAt: v.saleEndsAt }, now)
              ? v.salePrice
              : v.regularPrice,
          );
          const min = (values: Prisma.Decimal[]) =>
            values.reduce((a, b) => (b.lessThan(a) ? b : a));
          const image = r.images[0];
          return {
            id: r.id,
            name: r.name,
            slug: r.slug,
            storeName: r.store.name,
            storeSlug: r.store.slug,
            thumbnailUrl: image
              ? productImageUrl(image.id, image.thumbnailFileId, 'thumbnail')
              : null,
            currency: r.currency,
            fromPrice: min(current).toFixed(2),
            regularFromPrice: min(r.variants.map((v) => v.regularPrice)).toFixed(2),
            wholesaleAvailable: r.wholesaleEnabled,
          };
        }),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** One product as a shopper sees it, priced for that shopper (retail, wholesale, agreed). */
  async get(user: AuthenticatedUser | undefined, id: string): Promise<PublicProduct> {
    const row = await this.prisma.product.findFirst({
      where: { id, ...shopperVisible },
      include: productDetailInclude,
    });
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product not found.');
    const attributes = (await this.categories.effectiveAttributes(row.categoryId)).attributes;
    const chain = await this.categories.ancestry(row.categoryId);
    const values = (row.attributeValues ?? {}) as Record<string, string | number | boolean>;
    const active = row.variants.filter((v) => v.status === 'ACTIVE');
    const prices = await this.pricing.pricesFor(
      user,
      active.map((v) => v.id),
      row.minOrderQuantity,
    );
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      store: { id: row.store.id, name: row.store.name, slug: row.store.slug },
      category: { id: row.category.id, name: row.category.name, path: chain.map((c) => c.name) },
      brand: row.brand ? { id: row.brand.id, name: row.brand.name } : null,
      specifications: Array.isArray(row.specifications)
        ? (row.specifications as { name: string; value: string }[])
        : [],
      attributes: attributes
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
      variants: active.map((v) => {
        const dto = variantDto(v);
        return {
          id: dto.id,
          sku: dto.sku,
          title: dto.title,
          options: dto.options,
          available: !v.trackInventory || dto.stock.available >= row.minOrderQuantity,
        };
      }),
      prices,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
    };
  }
}
