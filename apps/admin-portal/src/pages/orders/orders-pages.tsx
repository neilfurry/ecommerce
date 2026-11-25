import {
  toDisplayError,
  useAdminOrder,
  useAdminOrders,
  useAdminSellerOrder,
  useAdminSellerOrders,
} from '@marketplace/api-client';
import {
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  type OrderStatus,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SELLER_ORDER_STATUS_LABELS,
  SELLER_ORDER_STATUSES,
  type SellerOrderStatus,
} from '@marketplace/shared-types';
import {
  Badge,
  Breadcrumbs,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@marketplace/ui';
import type { AdminOrderSummary, SellerOrderSummary } from '@marketplace/validation';
import { ReceiptIcon } from 'lucide-react';
import { type ReactNode, useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 25;

const orderVariant = (s: OrderStatus) =>
  s === 'PLACED'
    ? ('success' as const)
    : s === 'CANCELLED'
      ? ('secondary' as const)
      : ('warning' as const);

function Filters<S extends string>({
  search,
  onSearch,
  status,
  onStatus,
  statuses,
  labels,
}: {
  search: string;
  onSearch: (v: string) => void;
  status: S | 'ALL';
  onStatus: (v: S | 'ALL') => void;
  statuses: readonly S[];
  labels: Record<S, string>;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Input
        type="search"
        aria-label="Search orders"
        placeholder="Order number, customer name or email"
        className="sm:w-80"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className="sm:w-56">
        <Select value={status} onValueChange={(v) => onStatus(v as S | 'ALL')}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {labels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function CustomerOrders() {
  const [status, setStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const orders = useAdminOrders({
    status: status === 'ALL' ? undefined : status,
    search: deferred || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<AdminOrderSummary>[] = [
    {
      id: 'number',
      header: 'Order',
      cell: (o) => (
        <div>
          <Link to={`/orders/${o.id}`} className="font-mono font-medium hover:underline">
            {o.orderNumber}
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
          <p>{o.customer.name}</p>
          <p className="text-xs text-muted-foreground">
            {o.customer.email}
            {o.buyerType === 'WHOLESALE' ? ' · wholesale' : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'sellers',
      header: 'Sellers',
      hideOnMobile: true,
      cell: (o) => `${o.sellerCount} · ${o.itemCount} items`,
    },
    {
      id: 'total',
      header: 'Total',
      cell: (o) => <span className="font-mono">{formatMoney(o.grandTotal)}</span>,
    },
    {
      id: 'payment',
      header: 'Payment',
      hideOnMobile: true,
      cell: (o) => (
        <div>
          <p>{PAYMENT_METHOD_LABELS[o.paymentMethod]}</p>
          <p className="text-xs text-muted-foreground">{PAYMENT_STATUS_LABELS[o.paymentStatus]}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => <Badge variant={orderVariant(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>,
    },
  ];
  return (
    <div className="space-y-4">
      <Filters
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statuses={ORDER_STATUSES}
        labels={ORDER_STATUS_LABELS}
      />
      <DataTable
        label="Customer orders"
        columns={columns}
        rows={orders.data?.items}
        getRowId={(o) => o.id}
        isLoading={orders.isPending}
        error={toDisplayError(orders.error)}
        onRetry={() => void orders.refetch()}
        empty={{ icon: ReceiptIcon, title: 'No orders found' }}
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

function SellerOrders() {
  const [status, setStatus] = useState<SellerOrderStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const orders = useAdminSellerOrders({
    status: status === 'ALL' ? undefined : status,
    search: deferred || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<SellerOrderSummary>[] = [
    {
      id: 'number',
      header: 'Suborder',
      cell: (o) => (
        <div>
          <Link to={`/seller-orders/${o.id}`} className="font-mono font-medium hover:underline">
            {o.number}
          </Link>
          <p className="text-xs text-muted-foreground">{formatDateTime(o.placedAt)}</p>
        </div>
      ),
    },
    {
      id: 'seller',
      header: 'Seller',
      cell: (o) => (
        <div>
          <p>{o.seller.businessName}</p>
          <p className="text-xs text-muted-foreground">{o.store.name}</p>
        </div>
      ),
    },
    { id: 'customer', header: 'Customer', hideOnMobile: true, cell: (o) => o.customerName },
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
    { id: 'status', header: 'Status', cell: (o) => <SellerOrderStatusBadge status={o.status} /> },
  ];
  return (
    <div className="space-y-4">
      <Filters
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        status={status}
        onStatus={(v) => {
          setStatus(v);
          setPage(1);
        }}
        statuses={SELLER_ORDER_STATUSES}
        labels={SELLER_ORDER_STATUS_LABELS}
      />
      <DataTable
        label="Seller orders"
        columns={columns}
        rows={orders.data?.items}
        getRowId={(o) => o.id}
        isLoading={orders.isPending}
        error={toDisplayError(orders.error)}
        onRetry={() => void orders.refetch()}
        empty={{ icon: ReceiptIcon, title: 'No seller orders found' }}
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

export function AdminOrdersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Customer orders and the per-seller suborders they were split into. Read-only in this phase."
      />
      <Tabs defaultValue="orders">
        <TabsList aria-label="Order view">
          <TabsTrigger value="orders">Customer orders</TabsTrigger>
          <TabsTrigger value="seller-orders">Seller orders</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <CustomerOrders />
        </TabsContent>
        <TabsContent value="seller-orders">
          <SellerOrders />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="text-right font-mono">{value}</span>
    </div>
  );
}

export function AdminOrderPage() {
  const { orderId } = useParams();
  const order = useAdminOrder(orderId);
  if (order.isPending) return <LoadingState />;
  if (order.isError)
    return (
      <ErrorState
        message={toDisplayError(order.error)?.message ?? 'Could not load the order.'}
        onRetry={() => void order.refetch()}
      />
    );
  const o = order.data;
  const t = o.totals;
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Orders', to: '/orders' }, { label: o.orderNumber }]} />
      <PageHeader
        title={`Order ${o.orderNumber}`}
        description={`${o.customer.name} · ${o.customer.email} · ${formatDateTime(o.placedAt)}`}
        actions={<Badge variant={orderVariant(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Seller orders ({o.sellerOrders.length})</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {o.sellerOrders.map((so) => (
                <div key={so.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link
                      to={`/seller-orders/${so.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {so.number}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {so.store.name} · {so.items.reduce((n, i) => n + i.quantity, 0)} units ·{' '}
                      {so.shipping ? `ships from ${so.shipping.origin}` : 'no shipping'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono">{formatMoney(so.total)}</span>
                    <SellerOrderStatusBadge status={so.status} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {o.events.map((e, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span>
                      {ORDER_EVENT_LABELS[e.type]}
                      {e.note ? <span className="text-muted-foreground"> — {e.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Row label="Items" value={formatMoney(t.itemsSubtotal)} />
              {Number(t.wholesaleSavings) > 0 ? (
                <Row label="Wholesale savings (included)" value={formatMoney(t.wholesaleSavings)} />
              ) : null}
              {Number(t.couponDiscount) > 0 ? (
                <Row label="Coupons" value={`−${formatMoney(t.couponDiscount)}`} />
              ) : null}
              <Row label="Shipping" value={formatMoney(t.shippingFee)} />
              {Number(t.shippingDiscount) > 0 ? (
                <Row label="Shipping discount" value={`−${formatMoney(t.shippingDiscount)}`} />
              ) : null}
              {Number(t.chargesTotal) > 0 ? (
                <Row label="Other charges" value={formatMoney(t.chargesTotal)} />
              ) : null}
              <Separator className="my-2" />
              <Row label="Grand total" value={formatMoney(t.grandTotal)} strong />
              <Row
                label={`VAT (${(Number(o.vat.rate) * 100).toFixed(0)}%) included`}
                value={formatMoney(t.vatAmount)}
              />
              <Row label="Marketplace commission" value={formatMoney(o.commissionAmount)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment and delivery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row label="Method" value={PAYMENT_METHOD_LABELS[o.paymentMethod]} />
              <Row label="Status" value={PAYMENT_STATUS_LABELS[o.paymentStatus]} />
              {o.paymentDueAt ? (
                <Row label="Pay by" value={formatDateTime(o.paymentDueAt)} />
              ) : null}
              <Row
                label="Buyer type"
                value={o.buyerType === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
              />
              <Separator className="my-2" />
              <p className="font-medium">{o.address.recipientName}</p>
              <p className="text-muted-foreground">{o.address.mobile}</p>
              <p>{o.address.formatted}</p>
              {o.cancelReason ? (
                <p className="pt-2 text-muted-foreground">Cancelled: {o.cancelReason}</p>
              ) : null}
            </CardContent>
          </Card>
          {o.coupons.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Coupons</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {o.coupons.map((c) => (
                  <Row
                    key={c.code}
                    label={<span className="font-mono">{c.code}</span>}
                    value={`−${formatMoney(c.amount)}`}
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AdminSellerOrderPage() {
  const { orderId } = useParams();
  const order = useAdminSellerOrder(orderId);
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
      <Breadcrumbs
        items={[
          { label: 'Orders', to: '/orders' },
          { label: o.orderNumber, to: `/orders/${o.orderId}` },
          { label: o.number },
        ]}
      />
      <PageHeader title={`Seller order ${o.number}`} description={o.store.name} />
      <SellerOrderView order={o} />
    </div>
  );
}
