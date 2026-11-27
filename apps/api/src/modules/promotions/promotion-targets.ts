import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@marketplace/database';
import { ApiException } from '../../common/errors/api.exception';

type Tx = Prisma.TransactionClient;

export interface TargetInput {
  appliesTo?: 'ALL' | 'PRODUCTS' | 'CATEGORIES';
  productIds?: string[];
  categoryIds?: string[];
}

const invalid = (path: string, message: string) =>
  new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message, [
    { path, message },
  ]);

/**
 * Checks product / category targets of a coupon or campaign: the products exist (and belong to
 * the seller for seller promotions) and the categories exist. Returns the ids to store (only
 * the list that matches applies_to).
 */
export async function checkTargets(
  db: Pick<Tx, 'product' | 'category'>,
  input: Required<TargetInput>,
  sellerId: string | null,
): Promise<{ productIds: string[]; categoryIds: string[] }> {
  const productIds = input.appliesTo === 'PRODUCTS' ? [...new Set(input.productIds)] : [];
  const categoryIds = input.appliesTo === 'CATEGORIES' ? [...new Set(input.categoryIds)] : [];
  if (input.appliesTo === 'PRODUCTS' && productIds.length === 0)
    throw invalid('productIds', 'Choose at least one product');
  if (input.appliesTo === 'CATEGORIES' && categoryIds.length === 0)
    throw invalid('categoryIds', 'Choose at least one category');
  if (productIds.length > 0) {
    const found = await db.product.count({
      where: { id: { in: productIds }, ...(sellerId ? { sellerId } : {}) },
    });
    if (found !== productIds.length)
      throw invalid(
        'productIds',
        sellerId ? 'Choose products of your own store.' : 'Some products were not found.',
      );
  }
  if (categoryIds.length > 0) {
    const found = await db.category.count({ where: { id: { in: categoryIds } } });
    if (found !== categoryIds.length)
      throw invalid('categoryIds', 'Some categories were not found.');
  }
  return { productIds, categoryIds };
}
