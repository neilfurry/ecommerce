import { HttpStatus, Injectable } from '@nestjs/common';
import { API_DEFAULT_VERSION } from '@marketplace/config';
import { FilePurpose, type Prisma } from '@marketplace/database';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import type {
  BannerAdminDto,
  BannerDto,
  BannerInput,
  FeaturedItems,
  HomePage,
  StoreCard,
  UpdateBannerRequest,
} from '@marketplace/validation';
import type { Readable } from 'node:stream';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { processImage } from '../files/image-processor';
import { storeImageUrl } from './catalog.service';
import { ProductCardsService, shopperVisible } from './product-cards.service';

const base = `/api/v${API_DEFAULT_VERSION}`;
const bannerImageUrl = (id: string, fileId: string) =>
  `${base}/storefront/banners/${id}/image?v=${fileId}`;
const SECTION_SIZE = 12;

type BannerRow = Prisma.HomeBannerGetPayload<object>;
const bannerDto = (b: BannerRow): BannerDto => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle,
  imageUrl: bannerImageUrl(b.id, b.imageFileId),
  linkUrl: b.linkUrl,
  placement: b.placement,
});
const bannerAdminDto = (b: BannerRow): BannerAdminDto => ({
  ...bannerDto(b),
  position: b.position,
  status: b.status,
  startsAt: b.startsAt?.toISOString() ?? null,
  endsAt: b.endsAt?.toISOString() ?? null,
  createdAt: b.createdAt.toISOString(),
});

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Banner not found.');
const windowOpen = (now: Date) => ({
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  ],
});

/** The home page (all sections from the database) and its administration. */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: ProductCardsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async home(user: AuthenticatedUser | undefined): Promise<HomePage> {
    const now = new Date();
    const customerId = user?.app === 'storefront' ? user.id : null;
    const [banners, categories, flashSale, featured, bestSellerIds, recommendedIds, stores] =
      await Promise.all([
        this.prisma.homeBanner.findMany({
          where: { status: 'ACTIVE', ...windowOpen(now) },
          orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        }),
        this.prisma.category.findMany({
          where: { status: 'ACTIVE', parentId: null },
          include: {
            children: {
              where: { status: 'ACTIVE' },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
        this.flashSale(now),
        this.prisma.featuredProduct.findMany({
          where: { ...windowOpen(now), product: shopperVisible },
          orderBy: { position: 'asc' },
          take: SECTION_SIZE,
        }),
        this.cards.idsWhere(
          {},
          [{ soldCount: 'desc' }, { ratingAverage: 'desc' }, { approvedAt: 'desc' }],
          SECTION_SIZE,
        ),
        this.recommendedIds(customerId),
        this.featuredStores(),
      ]);
    const [featuredProducts, bestSellers, recommended] = await Promise.all([
      this.cards.cards(
        featured.map((f) => f.productId),
        now,
      ),
      this.cards.cards(bestSellerIds, now),
      this.cards.cards(recommendedIds, now),
    ]);
    return {
      heroBanners: banners.filter((b) => b.placement === 'HERO').map(bannerDto),
      promoBanners: banners.filter((b) => b.placement === 'PROMO').map(bannerDto),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        imageUrl: c.imageFileId ? `${base}/categories/${c.id}/image?v=${c.imageFileId}` : null,
        children: c.children,
      })),
      flashSale,
      featuredProducts,
      bestSellers,
      recommended,
      featuredStores: stores,
    };
  }

  /** The running flash sale ending soonest, with its products. */
  private async flashSale(now: Date): Promise<HomePage['flashSale']> {
    const sale = await this.prisma.flashSale.findFirst({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        items: { some: { status: 'ACTIVE', product: shopperVisible } },
      },
      include: { items: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } },
      orderBy: { endsAt: 'asc' },
    });
    if (!sale) return null;
    const productIds = [...new Set(sale.items.map((i) => i.productId))].slice(0, SECTION_SIZE);
    const products = (await this.cards.cards(productIds, now)).filter((c) => c.flashSale);
    if (products.length === 0) return null;
    return { id: sale.id, title: sale.title, endsAt: sale.endsAt.toISOString(), products };
  }

  /**
   * For a signed-in customer: products in the categories they bought from, saved or carted,
   * that they have not bought yet, best rated first. Otherwise (or when that finds too few):
   * the best rated products.
   */
  private async recommendedIds(customerId: string | null): Promise<string[]> {
    let ids: string[] = [];
    if (customerId) {
      const [bought, saved, carted] = await Promise.all([
        this.prisma.orderItem.findMany({
          where: { order: { customerId, status: { not: 'CANCELLED' } } },
          select: { productId: true, product: { select: { categoryId: true } } },
          take: 100,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.wishlistItem.findMany({
          where: { userId: customerId },
          select: { product: { select: { categoryId: true } } },
          take: 50,
        }),
        this.prisma.cartItem.findMany({
          where: { userId: customerId },
          select: { variant: { select: { product: { select: { categoryId: true } } } } },
          take: 50,
        }),
      ]);
      const categoryIds = [
        ...new Set([
          ...bought.map((b) => b.product.categoryId),
          ...saved.map((s) => s.product.categoryId),
          ...carted.map((c) => c.variant.product.categoryId),
        ]),
      ];
      if (categoryIds.length > 0) {
        ids = await this.cards.idsWhere(
          {
            categoryId: { in: categoryIds },
            id: { notIn: bought.map((b) => b.productId) },
          },
          [{ ratingAverage: 'desc' }, { soldCount: 'desc' }, { approvedAt: 'desc' }],
          SECTION_SIZE,
        );
      }
    }
    if (ids.length < SECTION_SIZE) {
      const more = await this.cards.idsWhere(
        { id: { notIn: ids } },
        [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }, { approvedAt: 'desc' }],
        SECTION_SIZE - ids.length,
      );
      ids = [...ids, ...more];
    }
    return ids;
  }

  private async featuredStores(): Promise<StoreCard[]> {
    const rows = await this.prisma.featuredStore.findMany({
      where: { store: { status: 'ACTIVE', seller: { status: 'VERIFIED' } } },
      include: {
        store: { include: { _count: { select: { products: { where: shopperVisible } } } } },
      },
      orderBy: { position: 'asc' },
      take: SECTION_SIZE,
    });
    return rows.map(({ store }) => storeCardDto(store));
  }

  // ---- Administration -------------------------------------------------------------------

  async banners(): Promise<BannerAdminDto[]> {
    const rows = await this.prisma.homeBanner.findMany({
      orderBy: [{ placement: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(bannerAdminDto);
  }

  private processBanner(upload: { buffer: Buffer; originalName: string }) {
    return processImage(upload.buffer, upload.originalName, {
      maxBytes: this.config.storage.uploadMaxBytes,
      minEdge: 300,
      maxEdge: 1920,
      thumbnailEdge: 320,
    });
  }

  private assertWindow(startsAt: string | null | undefined, endsAt: string | null | undefined) {
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'The end must be after the start.',
        [{ path: 'endsAt', message: 'Must be after the start' }],
      );
    }
  }

  async createBanner(
    user: AuthenticatedUser,
    input: BannerInput,
    upload: { buffer: Buffer; originalName: string },
    context: RequestContext,
  ): Promise<BannerAdminDto> {
    this.assertWindow(input.startsAt, input.endsAt);
    const processed = await this.processBanner(upload);
    const file = await this.files.upload({
      buffer: processed.main,
      originalName: 'banner.webp',
      purpose: FilePurpose.HOME_BANNER,
    });
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.homeBanner.create({
        data: {
          title: input.title,
          subtitle: input.subtitle ?? null,
          linkUrl: input.linkUrl ?? null,
          placement: input.placement ?? 'HERO',
          status: input.status ?? 'ACTIVE',
          position: Number(input.position ?? 0),
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          imageFileId: file.id,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'storefront.banner_created',
          actorId: user.id,
          entityType: 'home_banner',
          entityId: created.id,
        },
        context,
        tx,
      );
      return created;
    });
    return bannerAdminDto(row);
  }

  async updateBanner(
    user: AuthenticatedUser,
    id: string,
    input: UpdateBannerRequest,
    context: RequestContext,
  ): Promise<BannerAdminDto> {
    const current = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!current) throw notFound();
    const startsAt =
      input.startsAt === undefined ? current.startsAt?.toISOString() : input.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt?.toISOString() : input.endsAt;
    this.assertWindow(startsAt, endsAt);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.homeBanner.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
          ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl } : {}),
          ...(input.placement !== undefined ? { placement: input.placement } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.position !== undefined ? { position: Number(input.position) } : {}),
          ...(input.startsAt !== undefined
            ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
            : {}),
          ...(input.endsAt !== undefined
            ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
            : {}),
        },
      });
      await this.audit.record(
        {
          action: 'storefront.banner_updated',
          actorId: user.id,
          entityType: 'home_banner',
          entityId: id,
        },
        context,
        tx,
      );
      return updated;
    });
    return bannerAdminDto(row);
  }

  async replaceBannerImage(
    user: AuthenticatedUser,
    id: string,
    upload: { buffer: Buffer; originalName: string },
    context: RequestContext,
  ): Promise<BannerAdminDto> {
    const current = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!current) throw notFound();
    const processed = await this.processBanner(upload);
    const file = await this.files.upload({
      buffer: processed.main,
      originalName: 'banner.webp',
      purpose: FilePurpose.HOME_BANNER,
    });
    const row = await this.prisma.homeBanner.update({
      where: { id },
      data: { imageFileId: file.id },
    });
    await this.files.delete(current.imageFileId, FilePurpose.HOME_BANNER).catch(() => undefined);
    await this.audit.record(
      {
        action: 'storefront.banner_image_replaced',
        actorId: user.id,
        entityType: 'home_banner',
        entityId: id,
      },
      context,
    );
    return bannerAdminDto(row);
  }

  async deleteBanner(user: AuthenticatedUser, id: string, context: RequestContext): Promise<void> {
    const current = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!current) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.homeBanner.delete({ where: { id } });
      await this.audit.record(
        {
          action: 'storefront.banner_deleted',
          actorId: user.id,
          entityType: 'home_banner',
          entityId: id,
        },
        context,
        tx,
      );
    });
    await this.files.delete(current.imageFileId, FilePurpose.HOME_BANNER).catch(() => undefined);
  }

  async openBannerImage(
    id: string,
  ): Promise<{ contentType: string; sizeBytes: number; body: Readable }> {
    const row = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!row) throw notFound();
    const { file, body } = await this.files.openContent(row.imageFileId, FilePurpose.HOME_BANNER);
    return { contentType: file.contentType, sizeBytes: file.sizeBytes, body };
  }

  async featured(): Promise<FeaturedItems> {
    const now = new Date();
    const [products, stores] = await Promise.all([
      this.prisma.featuredProduct.findMany({
        include: { product: { include: { store: { select: { name: true } } } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.featuredStore.findMany({
        include: { store: true },
        orderBy: { position: 'asc' },
      }),
    ]);
    const visible = new Set(
      (
        await this.prisma.product.findMany({
          where: { id: { in: products.map((p) => p.productId) }, ...shopperVisible },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    return {
      products: products.map((f) => ({
        id: f.id,
        productId: f.productId,
        name: f.product.name,
        storeName: f.product.store.name,
        position: f.position,
        visible:
          visible.has(f.productId) &&
          (!f.startsAt || f.startsAt <= now) &&
          (!f.endsAt || now < f.endsAt),
      })),
      stores: stores.map((f) => ({
        id: f.id,
        storeId: f.storeId,
        name: f.store.name,
        position: f.position,
      })),
    };
  }

  /** Replaces the featured products, in the given order. */
  async putFeaturedProducts(
    user: AuthenticatedUser,
    productIds: string[],
    context: RequestContext,
  ) {
    const unique = [...new Set(productIds)];
    const found = await this.prisma.product.count({
      where: { id: { in: unique }, ...shopperVisible },
    });
    if (found !== unique.length) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Only products shoppers can buy can be featured.',
        [{ path: 'productIds', message: 'Only approved, visible products' }],
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.featuredProduct.deleteMany({ where: { productId: { notIn: unique } } });
      for (const [position, productId] of unique.entries()) {
        await tx.featuredProduct.upsert({
          where: { productId },
          create: { productId, position },
          update: { position },
        });
      }
      await this.audit.record(
        {
          action: 'storefront.featured_products_set',
          actorId: user.id,
          metadata: { count: unique.length },
        },
        context,
        tx,
      );
    });
    return this.featured();
  }

  async putFeaturedStores(user: AuthenticatedUser, storeIds: string[], context: RequestContext) {
    const unique = [...new Set(storeIds)];
    const found = await this.prisma.store.count({
      where: { id: { in: unique }, status: 'ACTIVE', seller: { status: 'VERIFIED' } },
    });
    if (found !== unique.length) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Only open stores of verified sellers can be featured.',
        [{ path: 'storeIds', message: 'Only open stores' }],
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.featuredStore.deleteMany({ where: { storeId: { notIn: unique } } });
      for (const [position, storeId] of unique.entries()) {
        await tx.featuredStore.upsert({
          where: { storeId },
          create: { storeId, position },
          update: { position },
        });
      }
      await this.audit.record(
        {
          action: 'storefront.featured_stores_set',
          actorId: user.id,
          metadata: { count: unique.length },
        },
        context,
        tx,
      );
    });
    return this.featured();
  }
}

export function storeCardDto(
  store: Prisma.StoreGetPayload<object> & { _count: { products: number } },
): StoreCard {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logoUrl: storeImageUrl(store.id, 'logo', store.logoFileId),
    bannerUrl: storeImageUrl(store.id, 'banner', store.bannerFileId),
    city: store.city,
    province: store.province,
    productCount: store._count.products,
  };
}
