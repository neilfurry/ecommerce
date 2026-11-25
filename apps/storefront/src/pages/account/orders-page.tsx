import { toDisplayError, useMyOrders } from '@marketplace/api-client';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_METHOD_LABELS,
} from '@marketplace/shared-types';
import {
  Badge,
  EmptyState,
  ErrorState,
  formatMoney,
  PageHeader,
  Pagination,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import { ImageIcon, PackageIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { statusVariant } from '../../lib/order-status';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = (ORDER_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as OrderStatus)
    : undefined;
  const page = Number(params.get('page') ?? '1') || 1;
  const orders = useMyOrders({ page, pageSize: 10, status });
  return (
    <div className="space-y-4">
      <PageHeader title="My orders" />
      <Tabs
        value={status ?? 'ALL'}
        onValueChange={(v) => setParams(v === 'ALL' ? {} : { status: v })}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="ALL">All</TabsTrigger>
          {ORDER_STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {orders.isPending ? (
        <Skeleton className="h-64" />
      ) : orders.isError ? (
        <ErrorState
          message={toDisplayError(orders.error)?.message ?? 'Orders could not be loaded.'}
          onRetry={() => void orders.refetch()}
        />
      ) : orders.data.items.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title="No orders here"
          description="Orders you place appear here."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {orders.data.items.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/account/orders/${o.id}`}
                  className="block rounded-lg border p-4 transition-colors hover:border-primary"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{o.orderNumber}</span>
                    <Badge variant={statusVariant(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {new Date(o.placedAt).toLocaleString('en-PH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · {o.itemCount} item
                    {o.itemCount === 1 ? '' : 's'} from {o.sellerCount} store
                    {o.sellerCount === 1 ? '' : 's'} · {PAYMENT_METHOD_LABELS[o.paymentMethod]}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex -space-x-2">
                      {o.preview.map((p, i) => (
                        <span
                          key={i}
                          className="size-10 overflow-hidden rounded-md border-2 border-background bg-muted"
                          title={p.productName}
                        >
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt="" className="size-full object-cover" />
                          ) : (
                            <ImageIcon
                              className="m-2 size-5 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      ))}
                    </div>
                    <span className="font-semibold">{formatMoney(o.grandTotal)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination
            page={orders.data.page}
            pageSize={orders.data.pageSize}
            totalItems={orders.data.totalItems}
            onPageChange={(p) => setParams({ ...(status ? { status } : {}), page: String(p) })}
          />
        </>
      )}
    </div>
  );
}
