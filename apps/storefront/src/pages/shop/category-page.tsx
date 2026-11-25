import { Breadcrumbs, EmptyState, PageHeader, Skeleton } from '@marketplace/ui';
import { FolderXIcon } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useCategoryTree } from '../../hooks/use-category-tree';
import { ProductListing } from '../../components/shop/product-listing';

export function CategoryPage() {
  const { slug } = useParams();
  const { roots, childrenOf, isPending } = useCategoryTree();
  const all = roots.flatMap((r) => [
    r,
    ...childrenOf(r.id),
    ...childrenOf(r.id).flatMap((c) => childrenOf(c.id)),
  ]);
  const category = all.find((c) => c.slug === slug);
  if (isPending) return <Skeleton className="mx-auto my-6 h-96 max-w-7xl" />;
  if (!category) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={FolderXIcon}
          title="Category not found"
          action={
            <Link to="/search" className="text-primary underline">
              Browse all products
            </Link>
          }
        />
      </div>
    );
  }
  const chain = [category];
  for (let c = category; c.parentId;) {
    const parent = all.find((p) => p.id === c.parentId);
    if (!parent) break;
    chain.unshift(parent);
    c = parent;
  }
  const subcategories = childrenOf(category.id);
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          ...chain.map((c, i) =>
            i === chain.length - 1 ? { label: c.name } : { label: c.name, to: `/c/${c.slug}` },
          ),
        ]}
      />
      <PageHeader title={category.name} description={category.description ?? undefined} />
      {subcategories.length > 0 ? (
        <nav aria-label="Subcategories" className="flex flex-wrap gap-2">
          {subcategories.map((c) => (
            <Link
              key={c.id}
              to={`/c/${c.slug}`}
              className="rounded-full border px-3 py-1 text-sm hover:border-primary hover:bg-accent"
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <ProductListing scope={{ categoryId: category.id }} heading={category.name} />
    </div>
  );
}
