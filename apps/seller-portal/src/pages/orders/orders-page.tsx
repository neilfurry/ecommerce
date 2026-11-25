import { toDisplayError, useSellerOrder, useSellerOrders } from '@marketplace/api-client';
import {
  PAYMENT_METHOD_LABELS,
  SELLER_ORDER_STATUS_LABELS,
  SELLER_ORDER_STATUSES,
  type SellerOrderStatus,
} from '@marketplace/shared-types';
import {
  Breadcrumbs,
  DataTable,
  type DataTableColumn,
  ErrorState,
  formatMoney,
  Input,
  LoadingState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SellerOrderStatusBadge,
  SellerOrderView,
} from '@marketplace/ui';
import type { SellerOrderSummary } from '@marketplace/validation';
import { ReceiptIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;

/** Suborders of the seller's stores, newest first. Fulfilment actions come in a later phase. */
export function OrdersPage() {
  const [status, setStatus] = useState<SellerOrderStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const orders = useSellerOrders({
    status: status === 'ALL' ? undefined : status,
    search: deferred || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<SellerOrderSummary>[] = [
    {
      id: 'number',
      header: 'Order',
      cell: (o) => (
        <div>
          <Link to={`/orders/${o.id}`} className="font-mono font-medium hover:underline">
            {o.number}
          </Link>
          <p className="text-xs text-muted-foreground">{formatDateTime(o.placedAt)}</p>
        </div>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: (o) => (
        <div>
          <p>{o.customerName}</p>
          <p className="text-xs text-muted-foreground">{o.store.name}</p>
        </div>
      ),
    },
    {
      id: 'items',
      header: 'Items',
      hideOnMobile: true,
      cell: (o) => o.itemCount,
    },
    {
      id: 'total',
      header: 'Total',
      cell: (o) => <span className="font-mono">{formatMoney(o.total)}</span>,
    },
    {
      id: 'commission',
      header: 'Commission',
      hideOnMobile: true,
      cell: (o) => <span className="font-mono">{formatMoney(o.commissionAmount)}</span>,
    },
    {
      id: 'payment',
      header: 'Payment',
      hideOnMobile: true,
      cell: (o) => PAYMENT_METHOD_LABELS[o.paymentMethod],
    },
    { id: 'status', header: 'Status', cell: (o) => <SellerOrderStatusBadge status={o.status} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Each customer order is split by seller; these are the parts your stores ship."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="search"
          aria-label="Search orders"
          placeholder="Order number or customer"
          className="sm:w-72"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div className="sm:w-56">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as SellerOrderStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {SELLER_ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SELLER_ORDER_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        label="Orders"
        columns={columns}
        rows={orders.data?.items}
        getRowId={(o) => o.id}
        isLoading={orders.isPending}
        error={toDisplayError(orders.error)}
        onRetry={() => void orders.refetch()}
        empty={{
          icon: ReceiptIcon,
          title: deferred || status !== 'ALL' ? 'No matching orders' : 'No orders yet',
          description: 'Orders appear here as soon as a customer checks out.',
        }}
        pagination={
          orders.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: orders.data.totalItems,
                onPageChange: setPage,
                isFetching: orders.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}

export function OrderPage() {
  const { orderId } = useParams();
  const order = useSellerOrder(orderId);
  if (order.isPending) return <LoadingState />;
  if (order.isError)
    return (
      <ErrorState
        message={toDisplayError(order.error)?.message ?? 'Could not load the order.'}
        onRetry={() => void order.refetch()}
      />
    );
  const o = order.data;
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Orders', to: '/orders' }, { label: o.number }]} />
      <PageHeader
        title={`Order ${o.number}`}
        description={`Part of customer order ${o.orderNumber} · ${o.store.name}`}
      />
      <SellerOrderView order={o} />
    </div>
  );
}
