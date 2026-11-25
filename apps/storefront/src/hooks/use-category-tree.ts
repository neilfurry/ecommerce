import { useCategories } from '@marketplace/api-client';
import type { CategoryDto } from '@marketplace/validation';

/** Top-level categories with their subcategories, from GET /categories. */
export function useCategoryTree() {
  const categories = useCategories();
  const all = categories.data?.categories ?? [];
  const roots = all.filter((c) => c.parentId === null);
  const childrenOf = (id: string): CategoryDto[] => all.filter((c) => c.parentId === id);
  return { roots, childrenOf, isPending: categories.isPending };
}
