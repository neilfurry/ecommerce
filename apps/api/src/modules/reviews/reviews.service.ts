import { HttpStatus, Injectable } from '@nestjs/common';
import { emitNotificationInTx, FilePurpose, type Prisma } from '@marketplace/database';
import {
  type AuthenticatedUser,
  MAX_REVIEW_IMAGES,
  type PaginatedResponse,
} from '@marketplace/shared-types';
import type {
  AdminReviewDto,
  CreateReviewRequest,
  ModerateReviewRequest,
  MyReviews,
  ReportReviewRequest,
  ResolveReviewReportsRequest,
  ReviewDto,
  ReviewReplyRequest,
  ReviewReportDto,
  SellerRatingDto,
  SellerRatingInput,
  SellerRatingSummary,
  UpdateReviewRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { processImage } from '../files/image-processor';
import { shopperVisible } from '../storefront/product-cards.service';

type Tx = Prisma.TransactionClient;

const MAX_REVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

const authorName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName.slice(0, 1).toUpperCase()}.`;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Review not found.');
const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);

/** Served by the API (GET /catalog/review-images/:id), so lists need no signed URLs. */
export const reviewImageUrl = (fileId: string) => `/api/v1/catalog/review-images/${fileId}`;

const reviewInclude = {
  user: { select: { firstName: true, lastName: true, email: true } },
  orderItem: {
    select: {
      variantTitle: true,
      imageUrl: true,
      sellerOrder: { select: { deliveredAt: true } },
    },
  },
  images: { orderBy: { position: 'asc' }, select: { id: true, fileId: true } },
} satisfies Prisma.ProductReviewInclude;
type ReviewRow = Prisma.ProductReviewGetPayload<{ include: typeof reviewInclude }>;

function reviewDto(r: ReviewRow): ReviewDto {
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    authorName: authorName(r.user),
    variantTitle: r.orderItem.variantTitle,
    // Every review is tied to an order item; "verified" once that parcel was delivered.
    verifiedPurchase: r.orderItem.sellerOrder.deliveredAt !== null,
    images: r.images.map((i) => ({ id: i.id, url: reviewImageUrl(i.fileId) })),
    sellerReply:
      r.sellerReply && r.sellerReplyAt
        ? { body: r.sellerReply, repliedAt: r.sellerReplyAt.toISOString() }
        : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Recomputes a product's rating from its published reviews (same transaction as the change). */
export async function refreshRating(tx: Tx, productId: string) {
  await tx.$executeRaw`
    UPDATE "products" p SET
      "rating_average" = coalesce(r."average", 0),
      "rating_count" = coalesce(r."count", 0)
    FROM (
      SELECT round(avg("rating")::numeric, 2) AS "average", COUNT(*)::int AS "count"
      FROM "product_reviews" WHERE "product_id" = ${productId}::uuid AND "status" = 'PUBLISHED'
    ) r
    WHERE p."id" = ${productId}::uuid`;
}

const page = <T>(items: T[], q: { page: number; pageSize: number }, totalItems: number) => ({
  items,
  page: q.page,
  pageSize: q.pageSize,
  totalItems,
  totalPages: Math.ceil(totalItems / q.pageSize),
});

/**
 * Product reviews, seller replies, review reports and seller ratings. Customers review what
 * they bought (one review per order item: the unique order_item_id prevents duplicates), and
 * rate the seller once per delivered seller order. Ratings shown in the catalog count
 * published reviews only.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  async forProduct(
    productId: string,
    query: { page: number; pageSize: number; rating?: number },
  ): Promise<PaginatedResponse<ReviewDto>> {
    const visible = await this.prisma.product.count({
      where: { id: productId, ...shopperVisible },
    });
    if (!visible) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product not found.');
    const where: Prisma.ProductReviewWhereInput = {
      productId,
      status: 'PUBLISHED',
      ...(query.rating ? { rating: query.rating } : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where,
        include: reviewInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productReview.count({ where }),
    ]);
    return page(rows.map(reviewDto), query, totalItems);
  }

  async mine(user: AuthenticatedUser): Promise<MyReviews> {
    const [reviews, toReview] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { userId: user.id },
        include: { ...reviewInclude, product: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.orderItem.findMany({
        where: {
          order: { customerId: user.id, status: { in: ['PLACED', 'COMPLETED'] } },
          sellerOrder: {
            status: { notIn: ['CANCELLED', 'RETURNED_TO_SELLER', 'AWAITING_PAYMENT'] },
          },
          review: null,
        },
        include: {
          order: { select: { orderNumber: true, placedAt: true } },
          product: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      reviews: reviews.map((r) => ({
        ...reviewDto(r),
        status: r.status,
        product: r.product,
        orderItemId: r.orderItemId,
        imageUrl: r.orderItem.imageUrl,
      })),
      toReview: toReview.map((i) => ({
        orderItemId: i.id,
        orderNumber: i.order.orderNumber,
        product: i.product,
        variantTitle: i.variantTitle,
        imageUrl: i.imageUrl,
        orderedAt: i.order.placedAt.toISOString(),
      })),
    };
  }

  async create(user: AuthenticatedUser, input: CreateReviewRequest): Promise<MyReviews> {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: input.orderItemId, order: { customerId: user.id } },
      include: {
        order: { select: { status: true } },
        sellerOrder: { select: { status: true, sellerId: true } },
        review: { select: { id: true } },
      },
    });
    if (!item) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order item not found.');
    }
    // Placed (or completed) orders, except parts that were cancelled or never delivered.
    if (
      !['PLACED', 'COMPLETED'].includes(item.order.status) ||
      ['CANCELLED', 'RETURNED_TO_SELLER', 'AWAITING_PAYMENT'].includes(item.sellerOrder.status)
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'You can review items from placed orders only.',
        [{ path: 'orderItemId', message: 'This order is not placed (or was cancelled)' }],
      );
    }
    if (item.review) throw conflict('You already reviewed this item.');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productReview.create({
          data: {
            productId: item.productId,
            sellerId: item.sellerOrder.sellerId,
            userId: user.id,
            orderItemId: item.id,
            rating: Number(input.rating),
            title: input.title ?? null,
            body: input.body ?? null,
          },
        });
        await refreshRating(tx, item.productId);
      });
    } catch (error) {
      // Two submissions at once: the unique order item wins once.
      if ((error as { code?: string }).code === 'P2002')
        throw conflict('You already reviewed this item.');
      throw error;
    }
    return this.mine(user);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateReviewRequest,
  ): Promise<MyReviews> {
    const review = await this.prisma.productReview.findFirst({ where: { id, userId: user.id } });
    if (!review) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.productReview.update({
        where: { id },
        data: {
          rating: Number(input.rating),
          title: input.title ?? null,
          body: input.body ?? null,
        },
      });
      await refreshRating(tx, review.productId);
    });
    return this.mine(user);
  }

  // ---- Review photos ------------------------------------------------------------------------

  async addImages(
    user: AuthenticatedUser,
    id: string,
    images: { buffer: Buffer; originalName: string }[],
  ): Promise<MyReviews> {
    const review = await this.prisma.productReview.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { images: true } } },
    });
    if (!review) throw notFound();
    if (images.length === 0) throw invalid('images', 'Choose at least one photo.');
    if (review._count.images + images.length > MAX_REVIEW_IMAGES)
      throw invalid('images', `At most ${MAX_REVIEW_IMAGES} photos per review.`);
    const processed = [];
    for (const image of images) {
      processed.push(
        await processImage(image.buffer, image.originalName, {
          maxBytes: MAX_REVIEW_IMAGE_BYTES,
          minEdge: 200,
          maxEdge: 1600,
          thumbnailEdge: 320,
        }),
      );
    }
    const stored: string[] = [];
    try {
      for (const [index, image] of processed.entries()) {
        const file = await this.files.upload({
          buffer: image.main,
          originalName: `review-${index + 1}.webp`,
          purpose: FilePurpose.REVIEW_IMAGE,
        });
        stored.push(file.id);
      }
      await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ n: number }[]>`
          SELECT COUNT(*)::int AS "n" FROM "review_images" WHERE "review_id" = ${id}::uuid`;
        if ((locked?.n ?? 0) + stored.length > MAX_REVIEW_IMAGES)
          throw invalid('images', `At most ${MAX_REVIEW_IMAGES} photos per review.`);
        await tx.reviewImage.createMany({
          data: stored.map((fileId, i) => ({
            reviewId: id,
            fileId,
            position: (locked?.n ?? 0) + i,
          })),
        });
      });
    } catch (error) {
      for (const fileId of stored)
        await this.files.delete(fileId, FilePurpose.REVIEW_IMAGE).catch(() => undefined);
      throw error;
    }
    return this.mine(user);
  }

  async removeImage(user: AuthenticatedUser, id: string, imageId: string): Promise<MyReviews> {
    const image = await this.prisma.reviewImage.findFirst({
      where: { id: imageId, reviewId: id, review: { userId: user.id } },
    });
    if (!image) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Photo not found.');
    await this.prisma.reviewImage.delete({ where: { id: imageId } });
    await this.files.delete(image.fileId, FilePurpose.REVIEW_IMAGE).catch(() => undefined);
    return this.mine(user);
  }

  /** A review photo, only while its review is published. */
  async imageContent(fileId: string) {
    const image = await this.prisma.reviewImage.findUnique({
      where: { fileId },
      select: { review: { select: { status: true } } },
    });
    if (!image || image.review.status !== 'PUBLISHED')
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Photo not found.');
    return this.files.openContent(fileId, FilePurpose.REVIEW_IMAGE);
  }

  // ---- Seller replies -------------------------------------------------------------------------

  async sellerList(
    user: AuthenticatedUser,
    query: { page: number; pageSize: number; replied?: 'true' | 'false'; rating?: number },
  ): Promise<PaginatedResponse<AdminReviewDto>> {
    const { sellerId } = sellerScope(user);
    return this.adminList(
      { ...query, sellerId, status: 'PUBLISHED' },
      query.replied === undefined ? undefined : query.replied === 'true',
    );
  }

  async reply(
    user: AuthenticatedUser,
    id: string,
    input: ReviewReplyRequest | null,
    context: RequestContext,
  ): Promise<AdminReviewDto> {
    const { sellerId } = sellerScope(user);
    const review = await this.prisma.productReview.findFirst({
      where: { id, sellerId },
      include: { product: { select: { name: true, store: { select: { name: true } } } } },
    });
    if (!review) throw notFound();
    if (review.status !== 'PUBLISHED' && input)
      throw conflict('Hidden reviews cannot be answered.');
    await this.prisma.$transaction(async (tx) => {
      await tx.productReview.update({
        where: { id },
        data: input
          ? { sellerReply: input.body, sellerReplyAt: new Date(), sellerReplyById: user.id }
          : { sellerReply: null, sellerReplyAt: null, sellerReplyById: null },
      });
      if (input && !review.sellerReply) {
        await emitNotificationInTx(tx, {
          event: 'REVIEW_REPLIED',
          userIds: [review.userId],
          data: { storeName: review.product.store.name, productName: review.product.name },
          link: '/account/reviews',
        });
      }
      await this.audit.record(
        {
          action: input ? 'review.replied' : 'review.reply_removed',
          actorId: user.id,
          entityType: 'product_review',
          entityId: id,
          metadata: { sellerId },
        },
        context,
        tx,
      );
    });
    const [dto] = (await this.adminList({ page: 1, pageSize: 1, id, sellerId })).items;
    return dto!;
  }

  // ---- Reports ----------------------------------------------------------------------------

  async report(user: AuthenticatedUser, id: string, input: ReportReviewRequest): Promise<void> {
    const review = await this.prisma.productReview.findUnique({ where: { id } });
    if (!review || review.status !== 'PUBLISHED') throw notFound();
    if (review.userId === user.id) throw conflict('You cannot report your own review.');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.reviewReport.create({
          data: {
            reviewId: id,
            userId: user.id,
            reason: input.reason,
            details: input.details ?? null,
          },
        });
        await tx.productReview.update({ where: { id }, data: { openReports: { increment: 1 } } });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw conflict('You already reported this review.');
      throw error;
    }
  }

  async reports(id: string): Promise<{ items: ReviewReportDto[] }> {
    const rows = await this.prisma.reviewReport.findMany({
      where: { reviewId: id },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        reviewId: r.reviewId,
        reason: r.reason,
        details: r.details,
        status: r.status,
        reporterEmail: r.user.email,
        resolutionNote: r.resolutionNote,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Uphold (hide the review) or dismiss its open reports. */
  async resolveReports(
    user: AuthenticatedUser,
    id: string,
    input: ResolveReviewReportsRequest,
    context: RequestContext,
  ): Promise<void> {
    const review = await this.prisma.productReview.findUnique({ where: { id } });
    if (!review) throw notFound();
    if (input.action === 'UPHOLD' && !input.note)
      throw invalid('note', 'Say why the review is hidden.');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reviewReport.updateMany({
        where: { reviewId: id, status: 'OPEN' },
        data: {
          status: input.action === 'UPHOLD' ? 'UPHELD' : 'DISMISSED',
          resolvedById: user.id,
          resolvedAt: now,
          resolutionNote: input.note ?? null,
        },
      });
      if (count === 0) throw conflict('This review has no open reports.');
      await tx.productReview.update({
        where: { id },
        data: {
          openReports: 0,
          ...(input.action === 'UPHOLD'
            ? {
                status: 'HIDDEN',
                moderationNote: input.note ?? null,
                moderatedById: user.id,
                moderatedAt: now,
              }
            : {}),
        },
      });
      await refreshRating(tx, review.productId);
      await this.audit.record(
        {
          action: input.action === 'UPHOLD' ? 'review.reports_upheld' : 'review.reports_dismissed',
          actorId: user.id,
          entityType: 'product_review',
          entityId: id,
          metadata: { reports: count },
        },
        context,
        tx,
      );
    });
  }

  // ---- Moderation -------------------------------------------------------------------------

  list(query: {
    page: number;
    pageSize: number;
    status?: 'PUBLISHED' | 'HIDDEN';
    rating?: number;
    search?: string;
    reported?: 'true' | 'false';
  }): Promise<PaginatedResponse<AdminReviewDto>> {
    return this.adminList(query);
  }

  private async adminList(
    query: {
      page: number;
      pageSize: number;
      status?: 'PUBLISHED' | 'HIDDEN';
      rating?: number;
      search?: string;
      reported?: 'true' | 'false';
      sellerId?: string;
      id?: string;
    },
    replied?: boolean,
  ): Promise<PaginatedResponse<AdminReviewDto>> {
    const where: Prisma.ProductReviewWhereInput = {
      ...(query.id ? { id: query.id } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { rating: query.rating } : {}),
      ...(query.reported === 'true' ? { openReports: { gt: 0 } } : {}),
      ...(query.reported === 'false' ? { openReports: 0 } : {}),
      ...(replied === true ? { sellerReply: { not: null } } : {}),
      ...(replied === false ? { sellerReply: null } : {}),
      ...(query.search
        ? {
            OR: [
              { product: { name: { contains: query.search, mode: 'insensitive' } } },
              { body: { contains: query.search, mode: 'insensitive' } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where,
        include: {
          ...reviewInclude,
          product: {
            select: { id: true, name: true, store: { select: { id: true, name: true } } },
          },
        },
        orderBy: query.reported === 'true' ? [{ openReports: 'desc' }] : { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productReview.count({ where }),
    ]);
    return page(
      rows.map((r) => ({
        ...reviewDto(r),
        status: r.status,
        moderationNote: r.moderationNote,
        product: { id: r.product.id, name: r.product.name },
        store: r.product.store,
        // Sellers do not see reviewers' email addresses.
        customerEmail: query.sellerId ? '' : r.user.email,
        openReports: r.openReports,
      })),
      query,
      totalItems,
    );
  }

  async moderate(
    user: AuthenticatedUser,
    id: string,
    input: ModerateReviewRequest,
    context: RequestContext,
  ): Promise<void> {
    const review = await this.prisma.productReview.findUnique({ where: { id } });
    if (!review) throw notFound();
    if (input.status === 'HIDDEN' && !input.note) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Say why the review is hidden.',
        [{ path: 'note', message: 'Required to hide a review' }],
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productReview.update({
        where: { id },
        data: {
          status: input.status,
          moderationNote: input.note ?? null,
          moderatedById: user.id,
          moderatedAt: new Date(),
        },
      });
      await refreshRating(tx, review.productId);
      await this.audit.record(
        {
          action: input.status === 'HIDDEN' ? 'review.hidden' : 'review.published',
          actorId: user.id,
          entityType: 'product_review',
          entityId: id,
        },
        context,
        tx,
      );
    });
  }

  // ---- Seller ratings -------------------------------------------------------------------------

  /** Rates the seller for a delivered seller order of the customer's (once; editable). */
  async rateSeller(
    user: AuthenticatedUser,
    sellerOrderId: string,
    input: SellerRatingInput,
  ): Promise<SellerRatingDto> {
    const so = await this.prisma.sellerOrder.findFirst({
      where: { id: sellerOrderId, order: { customerId: user.id } },
      select: { id: true, sellerId: true, status: true, deliveredAt: true },
    });
    if (!so) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order not found.');
    // Verified transactions only: the parcel was delivered to the customer.
    if (!so.deliveredAt || !['DELIVERED', 'COMPLETED'].includes(so.status))
      throw invalid('sellerOrderId', 'You can rate the seller once the order is delivered.');
    const scores = [input.productQuality, input.shippingSpeed, input.communication].map(Number);
    const overall = (scores.reduce((a, b) => a + b, 0) / 3).toFixed(2);
    const data = {
      productQuality: scores[0]!,
      shippingSpeed: scores[1]!,
      communication: scores[2]!,
      overall,
      comment: input.comment ?? null,
    };
    const row = await this.prisma.sellerRating.upsert({
      where: { sellerOrderId },
      create: { sellerOrderId, sellerId: so.sellerId, userId: user.id, ...data },
      update: data,
    });
    return {
      id: row.id,
      sellerOrderId: row.sellerOrderId,
      productQuality: row.productQuality,
      shippingSpeed: row.shippingSpeed,
      communication: row.communication,
      overall: row.overall.toFixed(2),
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Aggregates from verified (delivered) seller orders. */
  async sellerRatingSummary(sellerId: string): Promise<SellerRatingSummary> {
    const [agg] = await this.prisma.$queryRaw<
      {
        count: number;
        overall: string | null;
        quality: string | null;
        shipping: string | null;
        communication: string | null;
      }[]
    >`
      SELECT COUNT(*)::int AS "count",
        round(avg("overall"), 2)::text AS "overall",
        round(avg("product_quality"), 2)::text AS "quality",
        round(avg("shipping_speed"), 2)::text AS "shipping",
        round(avg("communication"), 2)::text AS "communication"
      FROM "seller_ratings" WHERE "seller_id" = ${sellerId}::uuid`;
    const breakdown = await this.prisma.$queryRaw<{ rating: number; count: number }[]>`
      SELECT round("overall")::int AS "rating", COUNT(*)::int AS "count"
      FROM "seller_ratings" WHERE "seller_id" = ${sellerId}::uuid GROUP BY 1`;
    const delivered = await this.prisma.sellerOrder.count({
      where: { sellerId, deliveredAt: { not: null } },
    });
    const fmt = (v: string | null) => Number(v ?? 0).toFixed(2);
    return {
      count: agg?.count ?? 0,
      overall: fmt(agg?.overall ?? null),
      productQuality: fmt(agg?.quality ?? null),
      shippingSpeed: fmt(agg?.shipping ?? null),
      communication: fmt(agg?.communication ?? null),
      deliveredOrders: delivered,
      breakdown: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: breakdown.find((b) => b.rating === rating)?.count ?? 0,
      })),
    };
  }

  async storeRatingSummary(storeId: string): Promise<SellerRatingSummary> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, status: 'ACTIVE' },
      select: { sellerId: true },
    });
    if (!store) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Store not found.');
    return this.sellerRatingSummary(store.sellerId);
  }

  async mySellerRatings(user: AuthenticatedUser) {
    const { sellerId } = sellerScope(user);
    const [summary, recent] = await Promise.all([
      this.sellerRatingSummary(sellerId),
      this.prisma.sellerRating.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { sellerOrder: { select: { number: true } } },
      }),
    ]);
    return {
      summary,
      recent: recent.map((r) => ({
        id: r.id,
        sellerOrderId: r.sellerOrderId,
        sellerOrderNumber: r.sellerOrder.number,
        productQuality: r.productQuality,
        shippingSpeed: r.shippingSpeed,
        communication: r.communication,
        overall: r.overall.toFixed(2),
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
