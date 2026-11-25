import { toDisplayError, useApiClient } from '@marketplace/api-client';
import { Breadcrumbs, EmptyState, ErrorState, Skeleton } from '@marketplace/ui';
import { MapPinIcon, StoreIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ProductListing } from '../../components/shop/product-listing';

/** A seller's store: banner, logo, details and policies, and its products. */
export function StorePage() {
  const { slug = '' } = useParams();
  const client = useApiClient();
  const store = useQuery({
    queryKey: ['shop', 'store', slug],
    queryFn: ({ signal }) => client.stores.bySlug(slug, signal),
    retry: false,
  });
  if (store.isPending) return <Skeleton className="mx-auto my-6 h-96 max-w-7xl" />;
  if (store.isError) {
    const error = toDisplayError(store.error);
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {error?.message.toLowerCase().includes('not found') ? (
          <EmptyState icon={StoreIcon} title="Store not found" />
        ) : (
          <ErrorState
            message={error?.message ?? 'The store could not be loaded.'}
            onRetry={() => void store.refetch()}
          />
        )}
      </div>
    );
  }
  const s = store.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: s.name }]} />
      <section className="overflow-hidden rounded-xl border">
        <div
          className="h-28 bg-gradient-to-r sm:h-40"
          style={{ backgroundColor: s.settings.primaryColor }}
        >
          {s.bannerUrl ? <img src={s.bannerUrl} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-6">
          <span className="-mt-14 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-muted sm:-mt-16 sm:size-24">
            {s.logoUrl ? (
              <img src={s.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <StoreIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{s.name}</h1>
            {s.city || s.province ? (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPinIcon className="size-4" aria-hidden="true" />{' '}
                {[s.city, s.province].filter(Boolean).join(', ')}
              </p>
            ) : null}
            {s.description ? <p className="mt-2 max-w-3xl text-sm">{s.description}</p> : null}
          </div>
        </div>
        {s.settings.announcement ? (
          <p className="border-t bg-accent px-4 py-2 text-sm sm:px-6">{s.settings.announcement}</p>
        ) : null}
        {s.settings.vacationMode ? (
          <p className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
            {s.settings.vacationMessage ?? 'This store is on a break; orders may ship later.'}
          </p>
        ) : null}
      </section>
      <ProductListing scope={{ storeId: s.id }} heading={s.name} />
      {s.settings.shippingPolicy || s.settings.returnPolicy ? (
        <section className="grid gap-4 sm:grid-cols-2" aria-label="Store policies">
          {s.settings.shippingPolicy ? (
            <div className="rounded-lg border p-4 text-sm">
              <h2 className="mb-1 font-semibold">Shipping</h2>
              <p className="whitespace-pre-line text-muted-foreground">
                {s.settings.shippingPolicy}
              </p>
            </div>
          ) : null}
          {s.settings.returnPolicy ? (
            <div className="rounded-lg border p-4 text-sm">
              <h2 className="mb-1 font-semibold">Returns</h2>
              <p className="whitespace-pre-line text-muted-foreground">{s.settings.returnPolicy}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
