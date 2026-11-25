import { toDisplayError } from '@marketplace/api-client';
import type { CartLine } from '@marketplace/validation';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  formatMoney,
  PageHeader,
  Separator,
  Skeleton,
} from '@marketplace/ui';
import {
  AlertTriangleIcon,
  ImageIcon,
  ShoppingCartIcon,
  StoreIcon,
  Trash2Icon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { productPath } from '../../lib/paths';
import { QuantityInput } from '../../components/shop/quantity-input';
import { useShoppingCart } from '../../hooks/use-shopping-cart';

function LineRow({ line, saved }: { line: CartLine; saved?: boolean }) {
  const { update, remove, busy } = useShoppingCart();
  const price = line.price;
  const max = line.availableQuantity ?? price?.maxOrderQuantity ?? undefined;
  return (
    <li className="flex gap-3 py-4 sm:gap-4" aria-label={line.productName}>
      <Link
        to={productPath({ id: line.productId, slug: line.productSlug })}
        className="size-20 shrink-0 overflow-hidden rounded-md border bg-muted sm:size-24"
      >
        {line.imageUrl ? (
          <img src={line.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageIcon aria-hidden="true" />
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <Link
              to={productPath({ id: line.productId, slug: line.productSlug })}
              className="line-clamp-2 font-medium hover:underline"
            >
              {line.productName}
            </Link>
            {line.variantTitle !== 'Default' ? (
              <p className="text-sm text-muted-foreground">{line.variantTitle}</p>
            ) : null}
          </div>
          {price ? (
            <div className="text-right">
              <p className="font-semibold">{formatMoney(price.lineTotal)}</p>
              <p className="text-xs text-muted-foreground">
                {formatMoney(price.unitPrice)} each
                {price.source === 'WHOLESALE_TIER'
                  ? ' · wholesale'
                  : price.source === 'FLASH_SALE'
                    ? ' · flash sale'
                    : ''}
              </p>
            </div>
          ) : null}
        </div>
        {line.previousUnitPrice && price ? (
          <p className="text-xs text-amber-700">
            Price changed from {formatMoney(line.previousUnitPrice)} to{' '}
            {formatMoney(price.unitPrice)}.
          </p>
        ) : null}
        {line.problem ? (
          <p className="flex items-center gap-1 text-sm text-destructive" role="alert">
            <AlertTriangleIcon className="size-4" aria-hidden="true" /> {line.problem}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {saved ? null : (
            <QuantityInput
              value={line.quantity}
              min={price?.minOrderQuantity ?? 1}
              max={max}
              disabled={busy}
              label={`Quantity of ${line.productName}`}
              onChange={(quantity) => void update(line.id, { quantity })}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void update(line.id, { savedForLater: !saved })}
          >
            {saved ? 'Move to cart' : 'Save for later'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void remove(line.id)}
            aria-label={`Remove ${line.productName}`}
          >
            <Trash2Icon aria-hidden="true" /> Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

export function CartPage() {
  const { cart, isLoading, isError, error, signedIn } = useShoppingCart();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div
        className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8"
        aria-label="Loading cart"
      >
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (isError || !cart) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState message={toDisplayError(error)?.message ?? 'Your cart could not be loaded.'} />
      </div>
    );
  }
  const empty = cart.groups.length === 0;
  const checkout = () => {
    if (signedIn) void navigate('/checkout');
    else void navigate('/sign-in', { state: { from: '/checkout' } });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Your cart"
        description={
          empty
            ? undefined
            : `${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'} from ${cart.groups.length} store${cart.groups.length === 1 ? '' : 's'}`
        }
      />
      {empty ? (
        <EmptyState
          icon={ShoppingCartIcon}
          title="Your cart is empty"
          description={
            cart.saved.length > 0
              ? 'Move saved items back to your cart below.'
              : 'Find something you like and add it here.'
          }
          action={
            <Button asChild>
              <Link to="/search">Browse products</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            {cart.groups.map((group) => (
              <Card key={group.sellerId}>
                <CardHeader className="pb-0">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <Link
                      to={`/s/${group.store.slug}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <StoreIcon className="size-4" aria-hidden="true" /> {group.store.name}
                    </Link>
                    <span className="text-sm font-normal text-muted-foreground">
                      {formatMoney(group.subtotal)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {group.lines.map((line) => (
                      <LineRow key={line.id} line={line} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle className="text-base">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal ({cart.itemCount} items)</span>
                <span className="font-medium">{formatMoney(cart.subtotal)}</span>
              </div>
              {Number(cart.wholesaleSavings) > 0 ? (
                <div className="flex justify-between text-emerald-700">
                  <span>Wholesale savings</span>
                  <span>−{formatMoney(cart.wholesaleSavings)}</span>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Shipping, coupons and the final total are calculated at checkout. Prices include
                VAT.
              </p>
              <Separator />
              {!cart.ready ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    Fix the items marked above before checking out.
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button className="w-full" size="lg" disabled={!cart.ready} onClick={checkout}>
                {signedIn ? 'Check out' : 'Sign in to check out'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      {cart.saved.length > 0 ? (
        <section aria-labelledby="saved-heading" className="space-y-2">
          <h2 id="saved-heading" className="text-lg font-semibold">
            Saved for later ({cart.saved.length})
          </h2>
          <ul className="divide-y rounded-lg border px-4">
            {cart.saved.map((line) => (
              <LineRow key={line.id} line={line} saved />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
