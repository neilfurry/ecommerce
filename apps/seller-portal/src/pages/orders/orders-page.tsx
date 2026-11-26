import {
  toDisplayError,
  useApiClient,
  useFulfilmentAction,
  useSellerCarriers,
  useSellerOrder,
  useSellerOrderCounts,
  useSellerOrders,
} from '@marketplace/api-client';
import {
  PAYMENT_METHOD_LABELS,
  SELLER_ORDER_TAB_LABELS,
  SELLER_ORDER_TABS,
  SHIPMENT_STATUS_LABELS,
  type SellerOrderTab,
  type ShipmentStatus,
} from '@marketplace/shared-types';
import {
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  formatMoney,
  Input,
  Label,
  LoadingState,
  PageHeader,
  PromptDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SellerOrderStatusBadge,
  SellerOrderView,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@marketplace/ui';
import type { SellerOrderDetail, SellerOrderSummary, ShipmentDto } from '@marketplace/validation';
import { ReceiptIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useParams } from 'react-router';
import { openBlob, showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
const TABS = Object.keys(SELLER_ORDER_TABS) as SellerOrderTab[];

/** The order dashboard: one tab per stage, with counts; new orders oldest first. */
export function OrdersPage() {
  const [tab, setTab] = useState<SellerOrderTab>('NEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferred = useDeferredValue(search.trim());
  const counts = useSellerOrderCounts();
  const orders = useSellerOrders({
    tab: deferred ? undefined : tab,
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
    { id: 'items', header: 'Items', hideOnMobile: true, cell: (o) => o.itemCount },
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
    {
      id: 'tracking',
      header: 'Tracking',
      hideOnMobile: true,
      cell: (o) =>
        o.trackingNumber ? <span className="font-mono text-xs">{o.trackingNumber}</span> : '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (o) => (
        <span className="flex flex-wrap gap-1">
          <SellerOrderStatusBadge status={o.status} />
          {o.cancellationRequested ? (
            <Badge variant="destructive">Cancellation requested</Badge>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Each customer order is split by seller; these are the parts your stores ship."
        actions={
          counts.data && counts.data.returns + counts.data.cancellationRequests > 0 ? (
            <div className="flex gap-2 text-sm">
              {counts.data.cancellationRequests > 0 ? (
                <Badge variant="destructive">
                  {counts.data.cancellationRequests} cancellation request(s)
                </Badge>
              ) : null}
              {counts.data.returns > 0 ? (
                <Link to="/returns">
                  <Badge variant="warning">{counts.data.returns} return(s) to answer</Badge>
                </Link>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as SellerOrderTab);
          setPage(1);
        }}
      >
        <TabsList className="h-auto flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {SELLER_ORDER_TAB_LABELS[t]}
              {counts.data ? (
                <span className="ml-1 text-muted-foreground">({counts.data[t]})</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Input
        type="search"
        aria-label="Search orders"
        placeholder="Order number, tracking number or customer (all tabs)"
        className="sm:w-96"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
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
          title: deferred ? 'No matching orders' : `No orders in “${SELLER_ORDER_TAB_LABELS[tab]}”`,
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

const SELF_UPDATES: ShipmentStatus[] = [
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNING',
  'RETURNED',
];

function BookShipment({ order }: { order: SellerOrderDetail }) {
  const carriers = useSellerCarriers();
  const action = useFulfilmentAction();
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState('MOCK');
  const [carrierName, setCarrierName] = useState('');
  const [tracking, setTracking] = useState('');
  const enabled = carriers.data?.items.filter((c) => c.enabled) ?? [];
  const self = carrier === 'SELF';
  return (
    <>
      <Button onClick={() => setOpen(true)}>Book shipment</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Book the delivery</DialogTitle>
            <DialogDescription>
              Book a courier pickup (a label is generated), or record a courier you arranged
              yourself.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="carrier">Courier</Label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger id="carrier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabled.map((c) => (
                    <SelectItem key={c.carrier} value={c.carrier}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {carriers.data?.items
                .filter((c) => !c.available)
                .map((c) => (
                  <p key={c.carrier} className="text-xs text-muted-foreground">
                    {c.label}: not connected yet.
                  </p>
                ))}
            </div>
            {self ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="carrier-name">Courier used</Label>
                  <Input
                    id="carrier-name"
                    value={carrierName}
                    onChange={(e) => setCarrierName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tracking">Tracking number</Label>
                  <Input
                    id="tracking"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                  />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              disabled={
                action.isPending ||
                (self && (carrierName.trim().length < 2 || tracking.trim().length < 4))
              }
              onClick={() =>
                action.mutate(
                  (f) =>
                    f.seller.book(order.id, {
                      carrier: carrier as 'MOCK',
                      ...(self
                        ? { carrierName: carrierName.trim(), trackingNumber: tracking.trim() }
                        : {}),
                    }),
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.success('Shipment booked');
                    },
                    onError: (e) => showError('Could not book the shipment', e),
                  },
                )
              }
            >
              Book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShipmentButtons({ shipment, canManage }: { shipment: ShipmentDto; canManage: boolean }) {
  const client = useApiClient();
  const action = useFulfilmentAction();
  const [status, setStatus] = useState<ShipmentStatus>('PICKED_UP');
  return (
    <>
      {shipment.hasWaybill ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void client.fulfilment.seller
              .waybill(shipment.id)
              .then((blob) => openBlob(blob, `waybill-${shipment.trackingNumber}.pdf`))
              .catch((e: unknown) => showError('Could not open the label', e))
          }
        >
          Print label
        </Button>
      ) : null}
      {canManage && shipment.status === 'BOOKED' && shipment.direction === 'FORWARD' ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost">
              Cancel booking
            </Button>
          }
          title="Cancel this booking?"
          description="The order goes back to Processing so you can book again."
          destructive
          onConfirm={() =>
            action
              .mutateAsync((f) => f.seller.cancelShipment(shipment.id))
              .catch((e: unknown) => {
                showError('Could not cancel the booking', e);
                throw e;
              })
          }
        />
      ) : null}
      {canManage &&
      shipment.carrier === 'SELF' &&
      !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(shipment.status) ? (
        <span className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as ShipmentStatus)}>
            <SelectTrigger className="h-8 w-48" aria-label="New delivery status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SELF_UPDATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIPMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                (f) => f.seller.updateShipment(shipment.id, { status: status as 'PICKED_UP' }),
                {
                  onSuccess: () => toast.success('Delivery status updated'),
                  onError: (e) => showError('Could not update the delivery', e),
                },
              )
            }
          >
            Update
          </Button>
        </span>
      ) : null}
    </>
  );
}

function NoteForm({ orderId }: { orderId: string }) {
  const action = useFulfilmentAction();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'CUSTOMER' | 'SELLER'>('CUSTOMER');
  return (
    <div className="space-y-2">
      <Label htmlFor="note">Add a message</Label>
      <Textarea
        id="note"
        rows={2}
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Select value={visibility} onValueChange={(v) => setVisibility(v as 'CUSTOMER')}>
          <SelectTrigger className="h-8 w-56" aria-label="Who sees it">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CUSTOMER">Customer, my team and support</SelectItem>
            <SelectItem value="SELLER">My team and support only</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!body.trim() || action.isPending}
          onClick={() =>
            action.mutate((f) => f.seller.addNote(orderId, { body: body.trim(), visibility }), {
              onSuccess: () => setBody(''),
              onError: (e) => showError('Could not add the message', e),
            })
          }
        >
          Send
        </Button>
      </div>
    </div>
  );
}

function Actions({ order }: { order: SellerOrderDetail }) {
  const action = useFulfilmentAction();
  const a = order.actions;
  const run = (title: string, success: string) => (fn: Parameters<typeof action.mutateAsync>[0]) =>
    action
      .mutateAsync(fn)
      .then(() => toast.success(success))
      .catch((e: unknown) => {
        showError(title, e);
        throw e;
      });
  return (
    <>
      {a.accept ? (
        <Button
          disabled={action.isPending}
          onClick={() =>
            void run(
              'Could not accept',
              'Order accepted',
            )((f) => f.seller.accept(order.id)).catch(() => undefined)
          }
        >
          Accept and start preparing
        </Button>
      ) : null}
      {a.bookShipment ? <BookShipment order={order} /> : null}
      {a.answerCancellation ? (
        <>
          <ConfirmDialog
            trigger={<Button variant="destructive">Approve cancellation</Button>}
            title="Cancel at the customer’s request?"
            description="Stock is released and any payment is refunded to the customer."
            destructive
            onConfirm={() =>
              run(
                'Could not cancel',
                'Order cancelled',
              )((f) => f.seller.approveCancellation(order.id))
            }
          />
          <PromptDialog
            trigger={<Button variant="outline">Decline cancellation</Button>}
            title="Decline the cancellation request"
            label="Tell the customer why"
            minLength={5}
            confirmLabel="Decline"
            onSubmit={(text) =>
              run(
                'Could not decline',
                'Request declined',
              )((f) => f.seller.rejectCancellation(order.id, text))
            }
          />
        </>
      ) : null}
      {a.cancel ? (
        <PromptDialog
          trigger={<Button variant="ghost">Cancel order</Button>}
          title="Cancel this order?"
          description="Held stock is released; if the customer paid, the money is refunded automatically."
          label="Reason (shown to the customer)"
          confirmLabel="Cancel order"
          destructive
          onSubmit={(text) =>
            run('Could not cancel', 'Order cancelled')((f) => f.seller.cancel(order.id, text))
          }
        />
      ) : null}
    </>
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
  const a = o.actions;
  const hasActions = a.accept || a.cancel || a.bookShipment || a.answerCancellation;
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Orders', to: '/orders' }, { label: o.number }]} />
      <PageHeader
        title={`Order ${o.number}`}
        description={`Part of customer order ${o.orderNumber} · ${o.store.name}`}
      />
      <SellerOrderView
        order={o}
        actions={hasActions ? <Actions order={o} /> : undefined}
        shipmentActions={(s) => <ShipmentButtons shipment={s} canManage={a.canManage} />}
        noteForm={a.canManage ? <NoteForm orderId={o.id} /> : undefined}
        returnLink={(id) => `/returns/${id}`}
      />
    </div>
  );
}
