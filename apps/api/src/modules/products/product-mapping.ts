import { API_DEFAULT_VERSION } from '@marketplace/config';
import type { Prisma } from '@marketplace/database';
import type {
  CategoryAttributeDto,
  ProductDetail,
  ProductImageDto,
  ProductSummary,
  VariantDto,
} from '@marketplace/validation';

/** Everything a product page (seller, staff) shows. */
export const productDetailInclude = {
  seller: { select: { id: true, businessName: true, status: true, email: true } },
  store: { select: { id: true, name: true, slug: true, status: true } },
  category: { select: { id: true, name: true, status: true } },
  brand: { select: { id: true, name: true, status: true } },
  options: {
    orderBy: { position: 'asc' },
    include: { values: { orderBy: { position: 'asc' } } },
  },
  variants: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      optionValues: { include: { optionValue: { include: { option: true } } } },
      stockLevels: { select: { quantityOnHand: true, reservedQuantity: true } },
    },
  },
  images: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  priceTiers: { orderBy: [{ minQuantity: 'asc' }, { startsAt: 'asc' }] },
  events: {
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.ProductInclude;
export type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>;

/** What lists show. */
export const productSummaryInclude = {
  seller: { select: { id: true, businessName: true } },
  store: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true, status: true } },
  images: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: 1 },
  variants: {
    select: {
      regularPrice: true,
      status: true,
      stockLevels: { select: { quantityOnHand: true, reservedQuantity: true } },
    },
  },
} satisfies Prisma.ProductInclude;
export type ProductSummaryRow = Prisma.ProductGetPayload<{ include: typeof productSummaryInclude }>;

const base = `/api/v${API_DEFAULT_VERSION}`;
export const productImageUrl = (imageId: string, fileId: string, size: 'large' | 'thumbnail') =>
  `${base}/products/images/${imageId}/${size}?v=${fileId}`;

export function imageDto(image: ProductDetailRow['images'][number]): ProductImageDto {
  return {
    id: image.id,
    variantId: image.variantId,
    url: productImageUrl(image.id, image.fileId, 'large'),
    thumbnailUrl: productImageUrl(image.id, image.thumbnailFileId, 'thumbnail'),
    altText: image.altText,
    position: image.position,
    width: image.width,
    height: image.height,
  };
}

const stockOf = (levels: { quantityOnHand: number; reservedQuantity: number }[]) => {
  const onHand = levels.reduce((sum, l) => sum + l.quantityOnHand, 0);
  const reserved = levels.reduce((sum, l) => sum + l.reservedQuantity, 0);
  return { onHand, reserved, available: onHand - reserved };
};

export function variantDto(variant: ProductDetailRow['variants'][number]): VariantDto {
  const options = Object.fromEntries(
    [...variant.optionValues]
      .sort((a, b) => a.optionValue.option.position - b.optionValue.option.position)
      .map((ov) => [ov.optionValue.option.name, ov.optionValue.value]),
  );
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    title: variant.title,
    options,
    regularPrice: variant.regularPrice.toFixed(2),
    salePrice: variant.salePrice?.toFixed(2) ?? null,
    saleStartsAt: variant.saleStartsAt?.toISOString() ?? null,
    saleEndsAt: variant.saleEndsAt?.toISOString() ?? null,
    trackInventory: variant.trackInventory,
    weightGrams: variant.weightGrams,
    lengthCm: variant.lengthCm?.toFixed(2) ?? null,
    widthCm: variant.widthCm?.toFixed(2) ?? null,
    heightCm: variant.heightCm?.toFixed(2) ?? null,
    status: variant.status,
    position: variant.position,
    stock: stockOf(variant.stockLevels),
  };
}

function priceRange(variants: { regularPrice: Prisma.Decimal; status: string }[]) {
  const prices = variants.filter((v) => v.status === 'ACTIVE').map((v) => v.regularPrice);
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a.comparedTo(b));
  return { min: sorted[0]!.toFixed(2), max: sorted[sorted.length - 1]!.toFixed(2) };
}

export function summaryDto(
  row: ProductSummaryRow | ProductDetailRow,
  categoryPath: string[],
): ProductSummary {
  const image = row.images[0];
  const levels = row.variants.flatMap((v) => v.stockLevels);
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: row.seller.businessName,
    storeId: row.store.id,
    storeName: row.store.name,
    storeSlug: row.store.slug,
    name: row.name,
    slug: row.slug,
    status: row.status,
    category: { id: row.category.id, name: row.category.name, path: categoryPath },
    brand: row.brand ? { id: row.brand.id, name: row.brand.name, status: row.brand.status } : null,
    thumbnailUrl: image ? productImageUrl(image.id, image.thumbnailFileId, 'thumbnail') : null,
    currency: row.currency,
    priceRange: priceRange(row.variants),
    variantCount: row.variants.length,
    totalAvailable: stockOf(levels).available,
    wholesaleEnabled: row.wholesaleEnabled,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    takenDown: row.moderatedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function detailDto(
  row: ProductDetailRow,
  options: {
    categoryPath: string[];
    categoryAttributes: CategoryAttributeDto[];
    missingForSubmission: string[];
    /** Sellers see "Marketplace team" instead of staff names. */
    showStaffNames: boolean;
  },
): ProductDetail {
  return {
    ...summaryDto(row, options.categoryPath),
    description: row.description,
    specifications: Array.isArray(row.specifications)
      ? (row.specifications as { name: string; value: string }[])
      : [],
    attributeValues: (row.attributeValues ?? {}) as Record<string, string | number | boolean>,
    categoryAttributes: options.categoryAttributes,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    seoKeywords: row.seoKeywords,
    minOrderQuantity: row.minOrderQuantity,
    maxOrderQuantity: row.maxOrderQuantity,
    wholesaleMinOrderQuantity: row.wholesaleMinOrderQuantity,
    reviewNote: row.reviewNote,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    options: row.options.map((o) => ({
      id: o.id,
      name: o.name,
      position: o.position,
      values: o.values.map((v) => ({ id: v.id, value: v.value, position: v.position })),
    })),
    variants: row.variants.map(variantDto),
    images: row.images.map(imageDto),
    priceTiers: row.priceTiers.map((t) => ({
      id: t.id,
      variantId: t.variantId,
      minQuantity: t.minQuantity,
      unitPrice: t.unitPrice.toFixed(2),
      startsAt: t.startsAt?.toISOString() ?? null,
      endsAt: t.endsAt?.toISOString() ?? null,
    })),
    events: row.events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      note: e.note,
      actor: !e.actor
        ? null
        : options.showStaffNames ||
            [
              'CREATED',
              'SUBMITTED',
              'CHANGED_AFTER_APPROVAL',
              'DEACTIVATED',
              'ACTIVATED',
              'ARCHIVED',
              'RESTORED',
            ].includes(e.type)
          ? `${e.actor.firstName} ${e.actor.lastName}`
          : 'Marketplace team',
      createdAt: e.createdAt.toISOString(),
    })),
    missingForSubmission: options.missingForSubmission,
    createdAt: row.createdAt.toISOString(),
  };
}
