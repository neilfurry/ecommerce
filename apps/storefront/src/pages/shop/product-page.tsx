import {
  toDisplayError,
  useApiClient,
  useProductReviews,
  useSession,
  useStorefrontProduct,
  useToggleWishlist,
} from '@marketplace/api-client';
import { PRICE_SOURCE_LABELS } from '@marketplace/shared-types';
import type { PriceQuoteLine, StorefrontProduct } from '@marketplace/validation';
import {
  Badge,
  Breadcrumbs,
  Button,
  cn,
  EmptyState,
  ErrorState,
  formatMoney,
  Pagination,
  Skeleton,
  toast,
} from '@marketplace/ui';
import { useQuery } from '@tanstack/react-query';
import {
  HeartIcon,
  ImageIcon,
  PackageXIcon,
  ShoppingCartIcon,
  StoreIcon,
  TruckIcon,
  ZapIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Countdown } from '../../components/shop/countdown';
import { QuantityInput } from '../../components/shop/quantity-input';
import { RatingSummary, Stars } from '../../components/shop/rating';
import { useShoppingCart } from '../../hooks/use-shopping-cart';

function Gallery({
  product,
  variantId,
}: {
  product: StorefrontProduct;
  variantId: string | undefined;
}) {
  const images = useMemo(() => {
    const own = product.images.filter((i) => i.variantId === variantId);
    return [...own, ...product.images.filter((i) => i.variantId !== variantId)];
  }, [product.images, variantId]);
  const [active, setActive] = useState(0);
  const [shownFor, setShownFor] = useState(variantId);
  if (shownFor !== variantId) {
    // Another variant: start from its first photo.
    setShownFor(variantId);
    setActive(0);
  }
  const current = images[active];
  return (
    <div className="space-y-3">
      <div className="aspect-square overflow-hidden rounded-lg border bg-muted">
        {current ? (
          <img
            src={current.url}
            alt={current.altText ?? product.name}
            className="size-full object-contain"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-16" aria-hidden="true" />
          </div>
        )}
      </div>
      {images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Product photos">
          {images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show photo ${index + 1}`}
                aria-current={index === active}
                className={cn(
                  'size-16 overflow-hidden rounded-md border-2 sm:size-20',
                  index === active ? 'border-primary' : 'border-transparent',
                )}
              >
                <img src={image.thumbnailUrl} alt="" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PriceBox({ line, currency }: { line: PriceQuoteLine | undefined; currency: string }) {
  if (!line) return <Skeleton className="h-16 w-48" />;
  const discounted = Number(line.unitPrice) < Number(line.regularPrice);
  return (
    <div className="space-y-1">
      {line.flashSale ? (
        <p className="inline-flex flex-wrap items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white">
          <ZapIcon className="size-4" aria-hidden="true" /> Flash sale · ends in{' '}
          <Countdown until={line.flashSale.endsAt} />
          <span className="font-normal">· {line.flashSale.remaining} left at this price</span>
        </p>
      ) : null}
      <p className="flex flex-wrap items-baseline gap-3">
        <span
          className={cn('text-3xl font-bold', discounted && 'text-red-600')}
          data-testid="unit-price"
        >
          {formatMoney(line.unitPrice, currency)}
        </span>
        {discounted ? (
          <span className="text-muted-foreground line-through">
            {formatMoney(line.regularPrice, currency)}
          </span>
        ) : null}
        {line.source !== 'REGULAR' ? (
          <Badge variant="secondary">{PRICE_SOURCE_LABELS[line.source]}</Badge>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        Per piece, VAT included
        {line.quantity > 1
          ? ` · ${formatMoney(line.lineTotal, currency)} for ${line.quantity}`
          : ''}
        {line.flashSale?.perOrderLimit
          ? ` · flash price for up to ${line.flashSale.perOrderLimit} per order`
          : ''}
      </p>
    </div>
  );
}

function OptionPicker({
  product,
  selected,
  onSelect,
}: {
  product: StorefrontProduct;
  selected: Record<string, string>;
  onSelect: (values: Record<string, string>) => void;
}) {
  if (product.options.length === 0) return null;
  const exists = (values: Record<string, string>) =>
    product.variants.find((v) => Object.entries(values).every(([k, val]) => v.options[k] === val));
  return (
    <div className="space-y-4">
      {product.options.map((option) => (
        <fieldset key={option.id}>
          <legend className="mb-2 text-sm font-medium">
            {option.name}:{' '}
            <span className="text-muted-foreground">{selected[option.name] ?? 'Choose'}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const next = { ...selected, [option.name]: value.value };
              const variant = exists(next);
              const active = selected[option.name] === value.value;
              return (
                <button
                  key={value.id}
                  type="button"
                  aria-pressed={active}
                  disabled={!variant}
                  onClick={() => onSelect(next)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    active ? 'border-primary bg-primary/10 font-medium' : 'hover:border-primary',
                    variant && !variant.available && 'text-muted-foreground line-through',
                  )}
                >
                  {value.value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function Reviews({ product }: { product: StorefrontProduct }) {
  const [rating, setRating] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const reviews = useProductReviews(product.id, { page, pageSize: 10, rating });
  const total = product.ratingBreakdown.reduce((n, r) => n + r.count, 0);
  return (
    <section aria-labelledby="reviews-heading" className="space-y-4">
      <h2 id="reviews-heading" className="text-xl font-semibold">
        Ratings and reviews
      </h2>
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <div className="space-y-2">
          <p className="flex items-center gap-2">
            <span className="text-4xl font-bold">
              {product.ratingCount ? product.ratingAverage.toFixed(1) : '–'}
            </span>
            <span className="space-y-1">
              <Stars value={product.ratingAverage} size="md" />
              <span className="block text-sm text-muted-foreground">
                {product.ratingCount} rating{product.ratingCount === 1 ? '' : 's'}
              </span>
            </span>
          </p>
          <ul className="space-y-1">
            {product.ratingBreakdown.map((r) => (
              <li key={r.rating}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-1 text-sm hover:bg-accent',
                    rating === r.rating && 'bg-accent font-medium',
                  )}
                  aria-pressed={rating === r.rating}
                  onClick={() => {
                    setRating(rating === r.rating ? undefined : r.rating);
                    setPage(1);
                  }}
                >
                  <span className="w-12 text-left">{r.rating} star</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full bg-amber-500"
                      style={{ width: total ? `${(r.count / total) * 100}%` : 0 }}
                    />
                  </span>
                  <span className="w-8 text-right text-muted-foreground">{r.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {reviews.isPending ? (
            <Skeleton className="h-32" />
          ) : reviews.data && reviews.data.items.length > 0 ? (
            <>
              <ul className="divide-y">
                {reviews.data.items.map((r) => (
                  <li key={r.id} className="space-y-1 py-4 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Stars value={r.rating} />
                      <span className="font-medium">{r.authorName}</span>
                      <span className="text-muted-foreground">
                        ·{' '}
                        {new Date(r.createdAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                        {r.variantTitle !== 'Default' ? ` · ${r.variantTitle}` : ''}
                      </span>
                    </div>
                    {r.title ? <p className="font-medium">{r.title}</p> : null}
                    {r.body ? <p className="text-sm whitespace-pre-line">{r.body}</p> : null}
                  </li>
                ))}
              </ul>
              <Pagination
                page={reviews.data.page}
                pageSize={reviews.data.pageSize}
                totalItems={reviews.data.totalItems}
                onPageChange={setPage}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {rating
                ? `No ${rating}-star reviews.`
                : 'No reviews yet. Customers who buy this product can review it from their orders.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ProductPage() {
  const { productId } = useParams();
  const product = useStorefrontProduct(productId);
  const session = useSession();
  const navigate = useNavigate();
  const client = useApiClient();
  const cart = useShoppingCart();
  const wishlist = useToggleWishlist();
  const [chosen, setSelected] = useState<Record<string, string> | null>(null);
  const [chosenQuantity, setQuantity] = useState<number | null>(null);
  const p = product.data;
  // Until the shopper chooses, the first available variant and the minimum quantity.
  const selected =
    chosen ?? (p ? ((p.variants.find((v) => v.available) ?? p.variants[0])?.options ?? {}) : {});
  const quantity = chosenQuantity ?? p?.minOrderQuantity ?? 1;

  const variant =
    p?.variants.find(
      (v) =>
        Object.entries(v.options).length === Object.keys(selected).length &&
        Object.entries(v.options).every(([k, val]) => selected[k] === val),
    ) ?? (p && p.options.length === 0 ? p.variants[0] : undefined);
  const maxQuantity = variant
    ? Math.min(
        variant.availableQuantity ?? Number.MAX_SAFE_INTEGER,
        p?.maxOrderQuantity ?? Number.MAX_SAFE_INTEGER,
      )
    : undefined;

  // The price at the chosen quantity, from the server (tiers and flash limits depend on it).
  const price = useQuery({
    queryKey: ['shop', 'price', variant?.id, quantity, session.data?.user.id ?? 'guest'],
    queryFn: async () =>
      (await client.catalog.quote({ items: [{ variantId: variant!.id, quantity }] })).lines[0],
    enabled: !!variant && quantity >= (p?.minOrderQuantity ?? 1),
    retry: false,
    placeholderData: (previous) => previous,
  });

  if (product.isPending) {
    return (
      <div
        className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 md:grid-cols-2 lg:px-8"
        aria-label="Loading"
      >
        <Skeleton className="aspect-square" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }
  if (product.isError || !p) {
    const error = toDisplayError(product.error);
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error?.message.toLowerCase().includes('not found') ? (
          <EmptyState
            icon={PackageXIcon}
            title="This product is not available"
            action={
              <Link to="/search" className="text-primary underline">
                Browse products
              </Link>
            }
          />
        ) : (
          <ErrorState
            message={error?.message ?? 'The product could not be loaded.'}
            onRetry={() => void product.refetch()}
          />
        )}
      </div>
    );
  }

  const line = price.data ?? p.prices.find((l) => l.variantId === variant?.id);
  const priceError = price.isError ? toDisplayError(price.error)?.message : null;
  const available = variant?.available ?? false;
  const stockText = !variant
    ? 'Choose the options'
    : !available
      ? 'Out of stock'
      : variant.availableQuantity === null
        ? 'In stock'
        : variant.availableQuantity <= 10
          ? `Only ${variant.availableQuantity} left`
          : `In stock (${variant.availableQuantity} available)`;

  const addToCart = async () => {
    if (!variant) return;
    try {
      await cart.add(variant.id, quantity);
      toast.success('Added to cart', {
        action: { label: 'View cart', onClick: () => void navigate('/cart') },
      });
    } catch (error) {
      toast.error(toDisplayError(error)?.message ?? 'Could not add to cart.');
    }
  };
  const buyNow = () => {
    if (!variant) return;
    const target = `/checkout?buy=${variant.id}&qty=${quantity}`;
    if (session.data) void navigate(target);
    else void navigate('/sign-in', { state: { from: target } });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          ...p.category.path.map((c) => ({ label: c.name, to: `/c/${c.slug}` })),
          { label: p.name },
        ]}
      />
      <div className="grid gap-8 md:grid-cols-2">
        <Gallery product={p} variantId={variant?.id} />
        <div className="space-y-5">
          <div className="space-y-2">
            {p.brand ? <p className="text-sm font-medium text-primary">{p.brand.name}</p> : null}
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <a href="#reviews-heading" className="hover:underline">
                <RatingSummary average={p.ratingAverage} count={p.ratingCount} />
              </a>
              {p.soldCount > 0 ? (
                <span className="text-muted-foreground">{p.soldCount} sold</span>
              ) : null}
            </div>
          </div>

          {priceError ? (
            <p role="alert" className="text-sm text-destructive">
              {priceError}
            </p>
          ) : (
            <PriceBox line={line} currency="PHP" />
          )}

          {p.wholesale ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="mb-2 text-sm font-semibold">
                Wholesale prices
                {p.wholesale.minOrderQuantity > 1
                  ? ` (from ${p.wholesale.minOrderQuantity} pieces)`
                  : ''}
              </p>
              <table className="w-full text-sm">
                <thead className="sr-only">
                  <tr>
                    <th>Quantity</th>
                    <th>Price per piece</th>
                  </tr>
                </thead>
                <tbody>
                  {p.wholesale.tiers
                    .filter((t) => t.variantId === null || t.variantId === variant?.id)
                    .map((t, i, all) => (
                      <tr key={`${t.variantId}-${t.minQuantity}`}>
                        <td className="py-0.5">
                          {t.minQuantity}
                          {all[i + 1] ? `–${all[i + 1]!.minQuantity - 1}` : '+'} pcs
                        </td>
                        <td className="py-0.5 text-right font-medium">
                          {formatMoney(t.unitPrice)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                {p.buyerIsWholesale ? (
                  'Your wholesale account gets these prices automatically.'
                ) : (
                  <>
                    For approved wholesale accounts.{' '}
                    <Link to="/account/settings" className="text-primary underline">
                      Apply for wholesale
                    </Link>
                  </>
                )}
              </p>
            </div>
          ) : null}

          <OptionPicker product={p} selected={selected} onSelect={setSelected} />

          <div className="space-y-2">
            <p
              className={cn(
                'text-sm font-medium',
                available ? 'text-emerald-700' : 'text-destructive',
              )}
            >
              {stockText}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <QuantityInput
                value={quantity}
                min={p.minOrderQuantity}
                max={maxQuantity}
                onChange={setQuantity}
                disabled={!available}
              />
              {p.minOrderQuantity > 1 ? (
                <span className="text-xs text-muted-foreground">
                  Minimum order: {p.minOrderQuantity}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              onClick={() => void addToCart()}
              disabled={!available || cart.busy || !!priceError}
            >
              <ShoppingCartIcon aria-hidden="true" /> Add to cart
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={buyNow}
              disabled={!available || !!priceError}
            >
              Buy now
            </Button>
            {session.data ? (
              <Button
                size="lg"
                variant="ghost"
                aria-pressed={p.wishlisted}
                disabled={wishlist.isPending}
                onClick={() =>
                  wishlist.mutate(
                    { productId: p.id, saved: p.wishlisted },
                    {
                      onSuccess: () =>
                        toast.success(
                          p.wishlisted ? 'Removed from your wishlist' : 'Saved to your wishlist',
                        ),
                    },
                  )
                }
              >
                <HeartIcon
                  className={cn(p.wishlisted && 'fill-red-500 text-red-500')}
                  aria-hidden="true"
                />
                {p.wishlisted ? 'Saved' : 'Save'}
              </Button>
            ) : null}
          </div>

          <Link
            to={`/s/${p.store.slug}`}
            className="flex items-center gap-3 rounded-lg border p-3 hover:border-primary"
          >
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
              {p.store.logoUrl ? (
                <img src={p.store.logoUrl} alt="" className="size-full object-cover" />
              ) : (
                <StoreIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-medium">{p.store.name}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <TruckIcon className="size-3.5" aria-hidden="true" />
                Ships from{' '}
                {[p.store.city, p.store.province].filter(Boolean).join(', ') || 'the seller'}
              </span>
            </span>
          </Link>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="description-heading" className="space-y-3">
          <h2 id="description-heading" className="text-xl font-semibold">
            Description
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {p.description ?? 'No description.'}
          </p>
        </section>
        {p.attributes.length + p.specifications.length > 0 ? (
          <section aria-labelledby="specs-heading" className="space-y-3">
            <h2 id="specs-heading" className="text-xl font-semibold">
              Specifications
            </h2>
            <dl className="divide-y rounded-lg border text-sm">
              {[...p.attributes, ...p.specifications].map((s) => (
                <div key={`${s.name}-${s.value}`} className="grid grid-cols-2 gap-2 px-3 py-2">
                  <dt className="text-muted-foreground">{s.name}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
              {variant ? (
                <div className="grid grid-cols-2 gap-2 px-3 py-2">
                  <dt className="text-muted-foreground">SKU</dt>
                  <dd>{variant.sku}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
      </div>

      <Reviews product={p} />
    </div>
  );
}
