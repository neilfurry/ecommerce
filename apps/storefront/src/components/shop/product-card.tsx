import type { ProductCard as Card } from '@marketplace/validation';
import { Badge, cn, formatMoney, Skeleton } from '@marketplace/ui';
import { ImageIcon, ZapIcon } from 'lucide-react';
import { Link } from 'react-router';
import { productPath } from '../../lib/paths';
import { RatingSummary } from './rating';

const percentOff = (price: string, regular: string) => {
  const off = Math.round((1 - Number(price) / Number(regular)) * 100);
  return off >= 1 ? off : 0;
};

/** A product tile: photo, name, current price (sale or flash), rating and sales. */
export function ProductCard({ product, className }: { product: Card; className?: string }) {
  const off = percentOff(product.fromPrice, product.regularFromPrice);
  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring',
        className,
      )}
    >
      <div className="relative aspect-square bg-muted">
        {product.thumbnailUrl ? (
          <img
            src={product.thumbnailUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-10" aria-hidden="true" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {product.flashSale ? (
            <Badge className="gap-1 bg-red-600 text-white hover:bg-red-600">
              <ZapIcon className="size-3" aria-hidden="true" /> Flash sale
            </Badge>
          ) : off > 0 ? (
            <Badge className="bg-red-600 text-white hover:bg-red-600">−{off}%</Badge>
          ) : null}
          {product.wholesaleAvailable ? <Badge variant="secondary">Wholesale</Badge> : null}
        </div>
        {!product.inStock ? (
          <div className="absolute inset-x-0 bottom-0 bg-background/85 py-1 text-center text-xs font-medium">
            Out of stock
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium">
          <Link
            to={productPath(product)}
            className="after:absolute after:inset-0 focus:outline-none"
          >
            {product.name}
          </Link>
        </h3>
        <p className="text-xs text-muted-foreground">{product.storeName}</p>
        <div className="mt-auto pt-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn('text-base font-semibold', off > 0 && 'text-red-600')}>
              {formatMoney(product.fromPrice, product.currency)}
            </span>
            {off > 0 ? (
              <span className="text-xs text-muted-foreground line-through">
                {formatMoney(product.regularFromPrice, product.currency)}
              </span>
            ) : null}
          </p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <RatingSummary average={product.ratingAverage} count={product.ratingCount} />
            {product.soldCount > 0 ? (
              <span className="text-xs text-muted-foreground">{product.soldCount} sold</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, className }: { products: Card[]; className?: string }) {
  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5',
        className,
      )}
    >
      {products.map((p) => (
        <li key={p.id} className="flex">
          <ProductCard product={p} className="w-full" />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
      aria-label="Loading products"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="space-y-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

/** A horizontally scrolling row on phones, a grid row on wider screens. */
export function ProductRail({ products }: { products: Card[] }) {
  return (
    <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-5">
      {products.map((p) => (
        <li key={p.id} className="flex w-40 shrink-0 snap-start sm:w-auto">
          <ProductCard product={p} className="w-full" />
        </li>
      ))}
    </ul>
  );
}
