import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { AuthenticatedUser, PaginatedResponse } from '@marketplace/shared-types';
import {
  type BrandDto,
  type BrandListQuery,
  type CreateBrandRequest,
  type ReviewBrandRequest,
  slugify,
  type UpdateBrandRequest,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const include = {
  requestedBySeller: { select: { id: true, businessName: true } },
  _count: { select: { products: true } },
} satisfies Prisma.BrandInclude;
type BrandRow = Prisma.BrandGetPayload<{ include: typeof include }>;

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Brand not found.');

/**
 * The global brand list (decision of 2026-11-25): marketplace staff keep it; sellers can
 * request a brand that is missing, which becomes usable once staff approve it.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Staff: every brand. Sellers: active brands plus their own requests. */
  async list(user: AuthenticatedUser, query: BrandListQuery): Promise<PaginatedResponse<BrandDto>> {
    const visibility: Prisma.BrandWhereInput =
      user.app === 'admin'
        ? {}
        : user.seller
          ? {
              OR: [
                { status: 'ACTIVE' },
                { requestedBySellerId: user.seller.id, status: { in: ['PENDING', 'REJECTED'] } },
              ],
            }
          : { status: 'ACTIVE' };
    const where: Prisma.BrandWhereInput = {
      AND: [
        visibility,
        query.status ? { status: query.status } : {},
        query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {},
      ],
    };
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.brand.findMany({
        where,
        include,
        // Requests waiting for a decision first, oldest first; then alphabetical.
        orderBy:
          query.status === 'PENDING' ? [{ createdAt: 'asc' }] : [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return {
      items: rows.map(toDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** Staff create active brands; a seller's request is PENDING until reviewed. */
  async create(
    user: AuthenticatedUser,
    input: CreateBrandRequest,
    context: RequestContext,
  ): Promise<BrandDto> {
    const isRequest = user.app === 'seller';
    const sellerId = isRequest ? sellerScope(user).sellerId : null;
    const slug = slugify(input.name);
    if (!slug) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Invalid name.',
        [{ path: 'name', message: 'Use letters or numbers' }],
      );
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.brand.create({
          data: {
            name: input.name.trim(),
            slug,
            description: input.description ?? null,
            status: isRequest ? 'PENDING' : 'ACTIVE',
            requestedBySellerId: sellerId,
          },
          include,
        });
        await this.audit.record(
          {
            action: isRequest ? 'brand.requested' : 'brand.created',
            actorId: user.id,
            entityType: 'brand',
            entityId: created.id,
            metadata: { name: created.name, ...(sellerId ? { sellerId } : {}) },
          },
          context,
          tx,
        );
        return created;
      });
      return toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.brand.findUnique({ where: { slug } });
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          existing?.status === 'ACTIVE'
            ? `"${existing.name}" already exists; choose it from the list.`
            : 'A brand with this name already exists or was requested.',
          [{ path: 'name', message: 'Already exists' }],
        );
      }
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateBrandRequest,
    context: RequestContext,
  ): Promise<BrandDto> {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) throw notFound();
    if (input.status && brand.status !== 'ACTIVE' && brand.status !== 'INACTIVE') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Decide on the brand request first (approve or reject).',
      );
    }
    const data: Prisma.BrandUpdateInput = {
      ...(input.name ? { name: input.name.trim(), slug: slugify(input.name) } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status ? { status: input.status } : {}),
    };
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.brand.update({ where: { id }, data, include });
        await this.audit.record(
          {
            action: 'brand.updated',
            actorId: user.id,
            entityType: 'brand',
            entityId: id,
            metadata: { fields: Object.keys(input) },
          },
          context,
          tx,
        );
        return updated;
      });
      return toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Another brand has this name.', [
          { path: 'name', message: 'Already exists' },
        ]);
      }
      throw error;
    }
  }

  async review(
    user: AuthenticatedUser,
    id: string,
    input: ReviewBrandRequest,
    context: RequestContext,
  ): Promise<BrandDto> {
    const approve = input.decision === 'APPROVE';
    const row = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set: two reviewers cannot both decide.
      const { count } = await tx.brand.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: approve ? 'ACTIVE' : 'REJECTED',
          reviewNote: input.note ?? null,
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
      });
      if (count === 0) {
        const exists = await tx.brand.count({ where: { id } });
        if (!exists) throw notFound();
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This brand request was already decided.',
        );
      }
      await this.audit.record(
        {
          action: approve ? 'brand.approved' : 'brand.rejected',
          actorId: user.id,
          entityType: 'brand',
          entityId: id,
          metadata: input.note ? { note: input.note } : {},
        },
        context,
        tx,
      );
      return tx.brand.findUniqueOrThrow({ where: { id }, include });
    });
    return toDto(row);
  }
}

function toDto(row: BrandRow): BrandDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    requestedBy: row.requestedBySeller
      ? { sellerId: row.requestedBySeller.id, businessName: row.requestedBySeller.businessName }
      : null,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    productCount: row._count.products,
    createdAt: row.createdAt.toISOString(),
  };
}
