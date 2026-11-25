import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ProductEventType, type ProductStatus } from '@marketplace/database';
import {
  type AuthenticatedUser,
  MAX_VARIANTS_PER_PRODUCT,
  type PaginatedResponse,
} from '@marketplace/shared-types';
import {
  type CategoryAttributeDto,
  type CreateProductRequest,
  type ProductDetail,
  type ProductListQuery,
  type ProductSummary,
  type ReviewProductRequest,
  type SetProductOptionsRequest,
  slugify,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  VARIANT_PRICE_FIELDS,
} from '@marketplace/validation';
import type { RequestContext } from '../../common/auth/auth.decorators';
import { sellerScope } from '../../common/auth/seller-scope';
import { ApiException } from '../../common/errors/api.exception';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../catalog/categories.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  detailDto,
  productDetailInclude,
  type ProductDetailRow,
  productSummaryInclude,
  summaryDto,
} from './product-mapping';

type Tx = Prisma.TransactionClient;

export const productNotFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product not found.');
const conflict = (message: string, path?: string) =>
  new ApiException(
    HttpStatus.CONFLICT,
    'CONFLICT',
    message,
    path ? [{ path, message }] : undefined,
  );
const invalid = (message: string, path: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);
const skuTaken = (sku: string) =>
  conflict(`SKU "${sku}" is already used by another of your products.`, 'sku');

/** Statuses in which an approved product's content change needs approval again. */
const APPROVED_STATUSES: ProductStatus[] = ['ACTIVE', 'INACTIVE'];

/** SKU part from an option value: "Navy Blue" → "NAVY-BLUE". */
const skuPart = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 20) || 'X';

/** Every combination of the options' values ([[]] when there are no options). */
function combinations<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((v) => [...combo, v])),
    [[]],
  );
}

/**
 * Sellers' products: creation, editing, variants, and the approval workflow. Every
 * seller-side query is scoped to the caller's seller (another seller's products are 404).
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  // ---- Reading -----------------------------------------------------------------------------

  async listMine(
    user: AuthenticatedUser,
    query: ProductListQuery,
  ): Promise<PaginatedResponse<ProductSummary>> {
    const { sellerId } = sellerScope(user);
    return this.list({ ...query, sellerId }, sellerId);
  }

  /** Staff view across sellers (catalog.products.read). */
  listAll(query: ProductListQuery): Promise<PaginatedResponse<ProductSummary>> {
    return this.list(query, null);
  }

  private async list(
    query: ProductListQuery,
    scopedSellerId: string | null,
  ): Promise<PaginatedResponse<ProductSummary>> {
    const where: Prisma.ProductWhereInput = {
      ...(scopedSellerId
        ? { sellerId: scopedSellerId }
        : query.sellerId
          ? { sellerId: query.sellerId }
          : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: query.search, mode: 'insensitive' } } } },
              ...(scopedSellerId
                ? []
                : [
                    {
                      seller: {
                        businessName: { contains: query.search, mode: 'insensitive' as const },
                      },
                    },
                  ]),
            ],
          }
        : {}),
    };
    const [rows, totalItems, paths] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productSummaryInclude,
        // The approval queue is oldest submission first; everything else newest change first.
        orderBy:
          query.status === 'PENDING_APPROVAL'
            ? [{ submittedAt: 'asc' }, { id: 'asc' }]
            : [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
      this.categoryPaths(),
    ]);
    return {
      items: rows.map((row) => summaryDto(row, paths.get(row.categoryId) ?? [row.category.name])),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** Own seller's product, or any product for staff with catalog.products.read; else 404. */
  async get(user: AuthenticatedUser, id: string): Promise<ProductDetail> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: productDetailInclude,
    });
    const staff = user.app === 'admin' && user.permissions.includes('catalog.products.read');
    if (!row || (!staff && row.sellerId !== user.seller?.id)) throw productNotFound();
    return this.toDetail(row, { showStaffNames: staff });
  }

  // ---- Creating and editing ----------------------------------------------------------------

  async create(
    user: AuthenticatedUser,
    input: CreateProductRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.assertCanEdit(user);
    await this.assertStore(sellerId, input.storeId);
    const attributes = await this.assertCategory(input.categoryId);
    await this.assertBrand(sellerId, input.brandId ?? null);
    const attributeValues = validateAttributeValues(attributes, input.attributeValues ?? {});
    const slug =
      input.slug ?? (await this.freeSlug(input.storeId, slugify(input.name, 200) || 'product'));

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            sellerId,
            storeId: input.storeId,
            categoryId: input.categoryId,
            brandId: input.brandId ?? null,
            name: input.name.trim(),
            slug,
            description: input.description ?? null,
            specifications: input.specifications ?? [],
            attributeValues,
            seoTitle: input.seoTitle ?? null,
            seoDescription: input.seoDescription ?? null,
            seoKeywords: input.seoKeywords ?? null,
            createdById: user.id,
            variants: {
              create: {
                sellerId,
                sku: input.sku,
                title: 'Default',
                optionKey: '',
                regularPrice: new Prisma.Decimal(input.regularPrice),
              },
            },
          },
        });
        await this.event(tx, created.id, 'CREATED', null, 'DRAFT', null, user.id);
        await this.audit.record(
          {
            action: 'product.created',
            actorId: user.id,
            entityType: 'product',
            entityId: created.id,
            metadata: { sellerId, sku: input.sku },
          },
          context,
          tx,
        );
        return created;
      });
      return this.get(user, product.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        if (target.includes('slug'))
          throw conflict('Another product in this store uses this link.', 'slug');
        throw skuTaken(input.sku);
      }
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateProductRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.assertCanEdit(user);
    const product = await this.findOwn(sellerId, id);
    if (product.status === 'ARCHIVED') throw conflict('Restore the product before editing it.');
    if (input.storeId && input.storeId !== product.storeId)
      await this.assertStore(sellerId, input.storeId);
    const categoryId = input.categoryId ?? product.categoryId;
    const attributes =
      input.categoryId && input.categoryId !== product.categoryId
        ? await this.assertCategory(input.categoryId)
        : (await this.categories.effectiveAttributes(categoryId)).attributes;
    if (input.brandId !== undefined && input.brandId !== product.brandId) {
      await this.assertBrand(sellerId, input.brandId ?? null);
    }

    // Values for attributes the (new) category doesn't have are dropped when not resent.
    const known = new Set(attributes.map((a) => a.code));
    const attributeValues =
      input.attributeValues !== undefined
        ? validateAttributeValues(attributes, input.attributeValues)
        : Object.fromEntries(
            Object.entries((product.attributeValues ?? {}) as Record<string, unknown>).filter(
              ([code]) => known.has(code),
            ),
          );

    const data: Prisma.ProductUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.brandId !== undefined ? { brandId: input.brandId ?? null } : {}),
      ...(input.specifications !== undefined ? { specifications: input.specifications } : {}),
      attributeValues: attributeValues as Prisma.InputJsonObject,
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
      ...(input.seoKeywords !== undefined ? { seoKeywords: input.seoKeywords } : {}),
    };

    const contentChanged =
      (input.name !== undefined && input.name.trim() !== product.name) ||
      (input.description !== undefined && input.description !== product.description) ||
      (input.categoryId !== undefined && input.categoryId !== product.categoryId) ||
      (input.brandId !== undefined && (input.brandId ?? null) !== product.brandId) ||
      (input.specifications !== undefined &&
        JSON.stringify(input.specifications) !== JSON.stringify(product.specifications)) ||
      JSON.stringify(attributeValues) !== JSON.stringify(product.attributeValues);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data });
        if (contentChanged) await this.contentChanged(tx, product, user.id);
        await this.audit.record(
          {
            action: 'product.updated',
            actorId: user.id,
            entityType: 'product',
            entityId: id,
            metadata: {
              fields: Object.keys(input),
              backToReview: contentChanged && APPROVED_STATUSES.includes(product.status),
            },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('Another product in this store uses this link.', 'slug');
      }
      throw error;
    }
    return this.get(user, id);
  }

  /**
   * Sets the variation axes and generates a variant for each new combination. Variants whose
   * combination disappears are deleted, unless they have stock history (then 409).
   */
  async setOptions(
    user: AuthenticatedUser,
    id: string,
    input: SetProductOptionsRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.assertCanEdit(user);
    const product = await this.findOwn(sellerId, id);
    if (product.status === 'ARCHIVED') throw conflict('Restore the product before editing it.');
    const wanted = input.options.map((o) => ({
      name: o.name.trim(),
      values: o.values.map((v) => v.trim()),
    }));
    const count = wanted.reduce((n, o) => n * o.values.length, 1);
    if (count > MAX_VARIANTS_PER_PRODUCT) {
      throw invalid(
        `These options make ${count} combinations; a product can have at most ${MAX_VARIANTS_PER_PRODUCT}.`,
        'options',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productOption.findMany({
        where: { productId: id },
        include: { values: true },
      });
      // 1. Upsert options and values (matched by name, case-insensitively), keeping ids.
      const resolved: { optionId: string; values: { id: string; value: string }[] }[] = [];
      for (const [position, option] of wanted.entries()) {
        const match = existing.find((o) => o.name.toLowerCase() === option.name.toLowerCase());
        const row = match
          ? await tx.productOption.update({
              where: { id: match.id },
              data: { name: option.name, position },
            })
          : await tx.productOption.create({ data: { productId: id, name: option.name, position } });
        const values: { id: string; value: string }[] = [];
        for (const [valuePosition, value] of option.values.entries()) {
          const found = match?.values.find((v) => v.value.toLowerCase() === value.toLowerCase());
          const valueRow = found
            ? await tx.productOptionValue.update({
                where: { id: found.id },
                data: { value, position: valuePosition },
              })
            : await tx.productOptionValue.create({
                data: { optionId: row.id, value, position: valuePosition },
              });
          values.push({ id: valueRow.id, value: valueRow.value });
        }
        resolved.push({ optionId: row.id, values });
      }

      // 2. Work out the combinations and which variants survive.
      const combos = combinations(resolved.map((o) => o.values));
      const keyOf = (ids: string[]) => [...ids].sort().join(':');
      const wantedKeys = new Map(combos.map((combo) => [keyOf(combo.map((v) => v.id)), combo]));
      const variants = await tx.productVariant.findMany({
        where: { productId: id },
        include: {
          _count: {
            select: { stockLevels: true, movements: true, reservations: true, transferItems: true },
          },
        },
      });
      const doomed = variants.filter((v) => !wantedKeys.has(v.optionKey));
      const blocked = doomed.filter(
        (v) =>
          v._count.stockLevels +
            v._count.movements +
            v._count.reservations +
            v._count.transferItems >
          0,
      );
      if (blocked.length > 0) {
        throw conflict(
          `These variants have stock records and cannot be removed: ${blocked.map((v) => v.sku).join(', ')}. ` +
            'Keep their option values, or make them inactive instead.',
          'options',
        );
      }
      if (doomed.length > 0) {
        await tx.productVariant.deleteMany({ where: { id: { in: doomed.map((v) => v.id) } } });
      }

      // 3. Create the missing combinations.
      const kept = new Set(
        variants.filter((v) => wantedKeys.has(v.optionKey)).map((v) => v.optionKey),
      );
      const usedSkus = new Set(
        (await tx.productVariant.findMany({ where: { sellerId }, select: { sku: true } })).map(
          (v) => v.sku.toUpperCase(),
        ),
      );
      let position = variants.reduce((max, v) => Math.max(max, v.position), -1) + 1;
      for (const [key, combo] of wantedKeys) {
        if (kept.has(key)) continue;
        const baseSku = [input.generate.skuPrefix, ...combo.map((v) => skuPart(v.value))]
          .join('-')
          .slice(0, 60);
        let sku = baseSku;
        for (let n = 2; usedSkus.has(sku.toUpperCase()); n++) sku = `${baseSku}-${n}`;
        usedSkus.add(sku.toUpperCase());
        await tx.productVariant.create({
          data: {
            productId: id,
            sellerId,
            sku,
            title: combo.length ? combo.map((v) => v.value).join(' / ') : 'Default',
            optionKey: key,
            regularPrice: new Prisma.Decimal(input.generate.regularPrice),
            position: position++,
            optionValues: { create: combo.map((v) => ({ optionValueId: v.id })) },
          },
        });
      }

      // 4. Remove options and values nothing uses any more.
      const keepValueIds = new Set(resolved.flatMap((o) => o.values.map((v) => v.id)));
      const keepOptionIds = new Set(resolved.map((o) => o.optionId));
      await tx.productOptionValue.deleteMany({
        where: { option: { productId: id }, id: { notIn: [...keepValueIds] } },
      });
      await tx.productOption.deleteMany({
        where: { productId: id, id: { notIn: [...keepOptionIds] } },
      });

      await this.contentChanged(tx, product, user.id);
      await this.audit.record(
        {
          action: 'product.options_updated',
          actorId: user.id,
          entityType: 'product',
          entityId: id,
          metadata: {
            options: wanted.map((o) => o.name),
            variants: wantedKeys.size,
            removedVariants: doomed.map((v) => v.sku),
          },
        },
        context,
        tx,
      );
    });
    return this.get(user, id);
  }

  async updateVariant(
    user: AuthenticatedUser,
    productId: string,
    variantId: string,
    input: UpdateVariantRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = sellerScope(user);
    const fields = Object.keys(input);
    const touchesPrice = fields.some((f) =>
      (VARIANT_PRICE_FIELDS as readonly string[]).includes(f),
    );
    const touchesOther = fields.some(
      (f) => !(VARIANT_PRICE_FIELDS as readonly string[]).includes(f),
    );
    if (touchesPrice) this.assertPermission(user, 'seller.pricing.manage');
    if (touchesOther) this.assertPermission(user, 'seller.products.manage');
    this.assertVerified(user);
    const product = await this.findOwn(sellerId, productId);
    if (product.status === 'ARCHIVED') throw conflict('Restore the product before editing it.');
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Variant not found.');

    const regular =
      input.regularPrice !== undefined
        ? new Prisma.Decimal(input.regularPrice)
        : variant.regularPrice;
    const sale =
      input.salePrice !== undefined
        ? input.salePrice === null
          ? null
          : new Prisma.Decimal(input.salePrice)
        : variant.salePrice;
    if (sale && !sale.lessThan(regular)) {
      throw invalid('The sale price must be lower than the regular price.', 'salePrice');
    }
    const starts =
      input.saleStartsAt !== undefined
        ? input.saleStartsAt
        : (variant.saleStartsAt?.toISOString() ?? null);
    const ends =
      input.saleEndsAt !== undefined
        ? input.saleEndsAt
        : (variant.saleEndsAt?.toISOString() ?? null);
    if (starts && ends && new Date(starts) >= new Date(ends)) {
      throw invalid('The sale must end after it starts.', 'saleEndsAt');
    }

    const data: Prisma.ProductVariantUpdateInput = {
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
      ...(input.regularPrice !== undefined ? { regularPrice: regular } : {}),
      ...(input.salePrice !== undefined ? { salePrice: sale } : {}),
      ...(input.saleStartsAt !== undefined
        ? { saleStartsAt: starts ? new Date(starts) : null }
        : {}),
      ...(input.saleEndsAt !== undefined ? { saleEndsAt: ends ? new Date(ends) : null } : {}),
      ...(input.trackInventory !== undefined ? { trackInventory: input.trackInventory } : {}),
      ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}),
      ...(input.lengthCm !== undefined ? { lengthCm: input.lengthCm } : {}),
      ...(input.widthCm !== undefined ? { widthCm: input.widthCm } : {}),
      ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productVariant.update({ where: { id: variantId }, data });
        await this.audit.record(
          {
            action: touchesPrice ? 'product.variant_price_updated' : 'product.variant_updated',
            actorId: user.id,
            entityType: 'product_variant',
            entityId: variantId,
            metadata: {
              productId,
              fields,
              ...(touchesPrice
                ? {
                    from: {
                      regular: variant.regularPrice.toFixed(2),
                      sale: variant.salePrice?.toFixed(2) ?? null,
                    },
                    to: { regular: regular.toFixed(2), sale: sale?.toFixed(2) ?? null },
                  }
                : {}),
            },
          },
          context,
          tx,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw skuTaken(input.sku ?? variant.sku);
      }
      throw error;
    }
    return this.get(user, productId);
  }

  // ---- Seller lifecycle ---------------------------------------------------------------------

  async submit(
    user: AuthenticatedUser,
    id: string,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const { sellerId } = this.assertCanEdit(user);
    const row = await this.loadDetail(id, sellerId);
    if (row.status !== 'DRAFT' && row.status !== 'REJECTED') {
      throw conflict('Only drafts and rejected products can be submitted.');
    }
    const missing = await this.missingForSubmission(row);
    if (missing.length > 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NOT_READY',
        `Finish the product first: ${missing.join('; ')}.`,
        missing.map((message) => ({ path: 'product', message })),
      );
    }
    await this.transition(
      user,
      row,
      ['DRAFT', 'REJECTED'],
      'PENDING_APPROVAL',
      'SUBMITTED',
      null,
      context,
      {
        submittedAt: new Date(),
      },
    );
    return this.get(user, id);
  }

  /** Hide an active product from shoppers. */
  async deactivate(user: AuthenticatedUser, id: string, context: RequestContext) {
    const { sellerId } = this.assertCanEdit(user);
    const row = await this.loadDetail(id, sellerId);
    await this.transition(user, row, ['ACTIVE'], 'INACTIVE', 'DEACTIVATED', null, context);
    return this.get(user, id);
  }

  /** Show a hidden, approved product again (not one the marketplace took down). */
  async activate(user: AuthenticatedUser, id: string, context: RequestContext) {
    const { sellerId } = this.assertCanEdit(user);
    const row = await this.loadDetail(id, sellerId);
    if (row.moderatedAt) {
      throw conflict(
        'The marketplace took this product down. Fix it and submit it for approval again.',
      );
    }
    if (!row.approvedAt) throw conflict('Submit the product for approval first.');
    await this.transition(user, row, ['INACTIVE'], 'ACTIVE', 'ACTIVATED', null, context);
    return this.get(user, id);
  }

  async archive(user: AuthenticatedUser, id: string, context: RequestContext) {
    const { sellerId } = this.assertCanEdit(user);
    const row = await this.loadDetail(id, sellerId);
    await this.transition(
      user,
      row,
      ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE'],
      'ARCHIVED',
      'ARCHIVED',
      null,
      context,
      { archivedAt: new Date() },
    );
    return this.get(user, id);
  }

  /** An archived product comes back as a draft and needs approval again. */
  async restore(user: AuthenticatedUser, id: string, context: RequestContext) {
    const { sellerId } = this.assertCanEdit(user);
    const row = await this.loadDetail(id, sellerId);
    await this.transition(user, row, ['ARCHIVED'], 'DRAFT', 'RESTORED', null, context, {
      archivedAt: null,
      approvedAt: null,
    });
    return this.get(user, id);
  }

  // ---- Marketplace review --------------------------------------------------------------------

  async review(
    user: AuthenticatedUser,
    id: string,
    input: ReviewProductRequest,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const row = await this.loadDetail(id, null);
    const approve = input.decision === 'APPROVE';
    if (approve && row.brand && row.brand.status !== 'ACTIVE') {
      throw conflict(
        row.brand.status === 'PENDING'
          ? `Decide on the brand request "${row.brand.name}" before approving this product.`
          : `The brand "${row.brand.name}" is not active; reject the product or ask the seller to change it.`,
      );
    }
    const now = new Date();
    await this.transition(
      user,
      row,
      ['PENDING_APPROVAL'],
      approve ? 'ACTIVE' : 'REJECTED',
      approve ? 'APPROVED' : 'REJECTED',
      input.note ?? null,
      context,
      approve
        ? {
            approvedAt: now,
            moderatedAt: null,
            reviewedAt: now,
            reviewedById: user.id,
            reviewNote: input.note ?? null,
          }
        : { reviewedAt: now, reviewedById: user.id, reviewNote: input.note ?? null },
    );
    await this.notifyDecision(row, approve ? 'APPROVED' : 'REJECTED', input.note ?? null);
    return this.get(user, id);
  }

  /** Moderation: take a product down. The seller must fix it and submit it again. */
  async takeDown(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    context: RequestContext,
  ): Promise<ProductDetail> {
    const row = await this.loadDetail(id, null);
    const now = new Date();
    await this.transition(
      user,
      row,
      ['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL'],
      'INACTIVE',
      'TAKEN_DOWN',
      reason,
      context,
      {
        moderatedAt: now,
        reviewedAt: now,
        reviewedById: user.id,
        reviewNote: reason,
      },
    );
    await this.notifyDecision(row, 'TAKEN_DOWN', reason);
    return this.get(user, id);
  }

  // ---- Helpers -------------------------------------------------------------------------------

  /** Seller members with seller.products.manage, of a verified seller. */
  assertCanEdit(user: AuthenticatedUser) {
    const scope = sellerScope(user);
    this.assertPermission(user, 'seller.products.manage');
    this.assertVerified(user);
    return scope;
  }

  assertVerified(user: AuthenticatedUser) {
    if (sellerScope(user).status !== 'VERIFIED') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SELLER_NOT_VERIFIED',
        'Your business must be verified (and not suspended) to manage products.',
      );
    }
  }

  assertPermission(user: AuthenticatedUser, permission: AuthenticatedUser['permissions'][number]) {
    if (!user.permissions.includes(permission)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'You do not have permission to do this.',
      );
    }
  }

  async findOwn(sellerId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, sellerId } });
    if (!product) throw productNotFound();
    return product;
  }

  /**
   * After a content change (decision of 2026-11-25): an approved product (active, or hidden
   * by the seller) goes back to review and is hidden until approved again.
   */
  async contentChanged(
    tx: Tx,
    product: { id: string; status: ProductStatus },
    actorId: string,
  ): Promise<void> {
    if (!APPROVED_STATUSES.includes(product.status)) return;
    const { count } = await tx.product.updateMany({
      where: { id: product.id, status: product.status },
      data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
    });
    if (count > 0) {
      await this.event(
        tx,
        product.id,
        'CHANGED_AFTER_APPROVAL',
        product.status,
        'PENDING_APPROVAL',
        null,
        actorId,
      );
    }
  }

  private async transition(
    user: AuthenticatedUser,
    row: ProductDetailRow,
    from: ProductStatus[],
    to: ProductStatus,
    eventType: ProductEventType,
    note: string | null,
    context: RequestContext,
    extra: Prisma.ProductUncheckedUpdateManyInput = {},
  ): Promise<void> {
    if (!from.includes(row.status)) {
      throw conflict(
        `This product is ${row.status.toLowerCase().replace('_', ' ')}; that action is not possible now.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      // Compare-and-set on the status read above: concurrent decisions cannot both apply.
      const { count } = await tx.product.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: to, ...extra },
      });
      if (count === 0) throw conflict('The product changed meanwhile. Reload and try again.');
      await this.event(tx, row.id, eventType, row.status, to, note, user.id);
      await this.audit.record(
        {
          action: `product.${eventType.toLowerCase()}`,
          actorId: user.id,
          entityType: 'product',
          entityId: row.id,
          metadata: { from: row.status, to, sellerId: row.sellerId, ...(note ? { note } : {}) },
        },
        context,
        tx,
      );
    });
  }

  private event(
    tx: Tx,
    productId: string,
    type: ProductEventType,
    fromStatus: ProductStatus | null,
    toStatus: ProductStatus | null,
    note: string | null,
    actorId: string,
  ) {
    return tx.productEvent.create({
      data: { productId, type, fromStatus, toStatus, note, actorId },
    });
  }

  private async notifyDecision(
    row: ProductDetailRow,
    decision: 'APPROVED' | 'REJECTED' | 'TAKEN_DOWN',
    note: string | null,
  ) {
    await this.notifications.safely('product decision email', () =>
      this.notifications.sendProductDecision({
        to: row.seller.email,
        businessName: row.seller.businessName,
        productName: row.name,
        decision,
        note,
        link: `${this.config.appUrls.seller}/products/${row.id}`,
      }),
    );
  }

  async loadDetail(id: string, sellerId: string | null): Promise<ProductDetailRow> {
    const row = await this.prisma.product.findFirst({
      where: { id, ...(sellerId ? { sellerId } : {}) },
      include: productDetailInclude,
    });
    if (!row) throw productNotFound();
    return row;
  }

  async toDetail(
    row: ProductDetailRow,
    options: { showStaffNames: boolean },
  ): Promise<ProductDetail> {
    const [paths, attributes] = await Promise.all([
      this.categoryPaths(),
      this.categories.effectiveAttributes(row.categoryId),
    ]);
    return detailDto(row, {
      categoryPath: paths.get(row.categoryId) ?? [row.category.name],
      categoryAttributes: attributes.attributes,
      missingForSubmission:
        row.status === 'DRAFT' || row.status === 'REJECTED'
          ? await this.missingForSubmission(row, attributes.attributes)
          : [],
      showStaffNames: options.showStaffNames,
    });
  }

  /** What must be in place before a product can be submitted. */
  async missingForSubmission(
    row: ProductDetailRow,
    attributes?: CategoryAttributeDto[],
  ): Promise<string[]> {
    const missing: string[] = [];
    if (row.seller.status !== 'VERIFIED') missing.push('Your business must be verified');
    if (row.store.status === 'SUSPENDED') missing.push('The store is suspended');
    if (row.category.status !== 'ACTIVE') missing.push('Choose an active category');
    if (row.brand && (row.brand.status === 'REJECTED' || row.brand.status === 'INACTIVE')) {
      missing.push('Choose another brand');
    }
    if ((row.description ?? '').trim().length < 30)
      missing.push('Add a description (at least 30 characters)');
    if (row.images.length === 0) missing.push('Add at least one photo');
    if (!row.variants.some((v) => v.status === 'ACTIVE'))
      missing.push('Keep at least one variant active');
    const values = (row.attributeValues ?? {}) as Record<string, unknown>;
    const attrs =
      attributes ?? (await this.categories.effectiveAttributes(row.categoryId)).attributes;
    for (const a of attrs) {
      if (a.isRequired && (values[a.code] === undefined || values[a.code] === '')) {
        missing.push(`Fill in "${a.name}"`);
      }
    }
    return missing;
  }

  async categoryPaths(): Promise<Map<string, string[]>> {
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, name: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const paths = new Map<string, string[]>();
    for (const row of rows) {
      const path: string[] = [];
      let cursor: typeof row | undefined = row;
      while (cursor) {
        path.unshift(cursor.name);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      paths.set(row.id, path);
    }
    return paths;
  }

  private async assertStore(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, sellerId } });
    if (!store) throw invalid('Choose one of your stores.', 'storeId');
    if (store.status === 'SUSPENDED') throw invalid('This store is suspended.', 'storeId');
  }

  private async assertCategory(categoryId: string): Promise<CategoryAttributeDto[]> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.status !== 'ACTIVE')
      throw invalid('Choose an active category.', 'categoryId');
    return (await this.categories.effectiveAttributes(categoryId)).attributes;
  }

  /** Active brands, or the seller's own pending request. */
  private async assertBrand(sellerId: string, brandId: string | null) {
    if (!brandId) return;
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    const usable =
      brand &&
      (brand.status === 'ACTIVE' ||
        (brand.status === 'PENDING' && brand.requestedBySellerId === sellerId));
    if (!usable) throw invalid('Choose an active brand, or request a new one.', 'brandId');
  }

  private async freeSlug(storeId: string, base: string): Promise<string> {
    const taken = new Set(
      (
        await this.prisma.product.findMany({
          where: { storeId, slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((p) => p.slug),
    );
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  }
}

/** Checks values against the category's attributes (types, choices). Unknown codes are refused. */
export function validateAttributeValues(
  attributes: CategoryAttributeDto[],
  values: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const byCode = new Map(attributes.map((a) => [a.code, a]));
  const clean: Record<string, string | number | boolean> = {};
  for (const [code, raw] of Object.entries(values)) {
    const attribute = byCode.get(code);
    const path = `attributeValues.${code}`;
    if (!attribute) throw invalid(`"${code}" is not an attribute of this category.`, path);
    if (raw === '' || raw === null) continue;
    switch (attribute.type) {
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) throw invalid(`${attribute.name} must be a number.`, path);
        clean[code] = n;
        break;
      }
      case 'BOOLEAN':
        if (typeof raw !== 'boolean') throw invalid(`${attribute.name} must be yes or no.`, path);
        clean[code] = raw;
        break;
      case 'SELECT':
        if (typeof raw !== 'string' || !attribute.options.includes(raw)) {
          throw invalid(`Choose one of: ${attribute.options.join(', ')}.`, path);
        }
        clean[code] = raw;
        break;
      default:
        if (typeof raw !== 'string') throw invalid(`${attribute.name} must be text.`, path);
        clean[code] = raw.trim();
    }
  }
  return clean;
}
