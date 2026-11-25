import { toDisplayError, useToggleWishlist, useWishlist } from '@marketplace/api-client';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '@marketplace/ui';
import { HeartIcon } from 'lucide-react';
import { Link } from 'react-router';
import { ProductCard } from '../../components/shop/product-card';

export function WishlistPage() {
  const wishlist = useWishlist();
  const toggle = useToggleWishlist();
  return (
    <div className="space-y-4">
      <PageHeader title="Wishlist" description="Products you saved for later." />
      {wishlist.isPending ? (
        <Skeleton className="h-64" />
      ) : wishlist.isError ? (
        <ErrorState
          message={toDisplayError(wishlist.error)?.message ?? 'Could not load your wishlist.'}
          onRetry={() => void wishlist.refetch()}
        />
      ) : wishlist.data.items.length === 0 ? (
        <EmptyState
          icon={HeartIcon}
          title="Nothing saved yet"
          description="Tap Save on a product page to keep it here."
          action={
            <Button asChild>
              <Link to="/search">Browse products</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
          {wishlist.data.items.map((p) => (
            <li key={p.id} className="flex flex-col gap-2">
              <ProductCard product={p} className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ productId: p.id, saved: true })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
