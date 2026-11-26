import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import type {
  AdminReviewDto,
  CreateReviewRequest,
  ModerateReviewRequest,
  MyReviews,
  ReviewDto,
  UpdateReviewRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { shopperVisible } from '../storefront/product-cards.service';

type Tx = Prisma.TransactionClient;

const authorName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName.slice(0, 1).toUpperCase()}.`;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Review not found.');

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

/**
 * Product reviews. Customers review what they bought (one review per order item, from orders
 * that were placed and not cancelled); ratings shown in the catalog count published reviews.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
        include: {
          user: { select: { firstName: true, lastName: true } },
          orderItem: { select: { variantTitle: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productReview.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        authorName: authorName(r.user),
        variantTitle: r.orderItem.variantTitle,
        createdAt: r.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async mine(user: AuthenticatedUser): Promise<MyReviews> {
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    });
    const [reviews, toReview] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { userId: user.id },
        include: {
          product: { select: { id: true, name: true, slug: true } },
          orderItem: { select: { variantTitle: true, imageUrl: true } },
        },
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
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        authorName: authorName(me),
        variantTitle: r.orderItem.variantTitle,
        createdAt: r.createdAt.toISOString(),
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
        sellerOrder: { select: { status: true } },
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
    if (item.review) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'You already reviewed this item.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productReview.create({
        data: {
          productId: item.productId,
          sellerId: (await tx.sellerOrder.findUniqueOrThrow({ where: { id: item.sellerOrderId } }))
            .sellerId,
          userId: user.id,
          orderItemId: item.id,
          rating: Number(input.rating),
          title: input.title ?? null,
          body: input.body ?? null,
        },
      });
      await refreshRating(tx, item.productId);
    });
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

  // ---- Moderation -------------------------------------------------------------------------

  async list(query: {
    page: number;
    pageSize: number;
    status?: 'PUBLISHED' | 'HIDDEN';
    rating?: number;
    search?: string;
  }): Promise<PaginatedResponse<AdminReviewDto>> {
    const where: Prisma.ProductReviewWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.rating ? { rating: query.rating } : {}),
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
          user: { select: { firstName: true, lastName: true, email: true } },
          orderItem: { select: { variantTitle: true } },
          product: {
            select: { id: true, name: true, store: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.productReview.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        authorName: authorName(r.user),
        variantTitle: r.orderItem.variantTitle,
        createdAt: r.createdAt.toISOString(),
        status: r.status,
        moderationNote: r.moderationNote,
        product: { id: r.product.id, name: r.product.name },
        store: r.product.store,
        customerEmail: r.user.email,
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
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
}
