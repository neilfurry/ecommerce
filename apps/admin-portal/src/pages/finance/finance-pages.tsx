import {
  toDisplayError,
  useAdminPayment,
  useAdminPayments,
  useAdminRefunds,
  useApiClient,
  useBankProofs,
  useCodCollections,
  usePaymentGateways,
  useReconciliation,
  useRemittances,
  useWebhookEvents,
} from '@marketplace/api-client';
import {
  CARRIER_LABELS,
  CARRIERS,
  COD_COLLECTION_STATUS_LABELS,
  type Carrier,
  type CodCollectionStatus,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_REVIEW_REASON_LABELS,
  REFUND_REASON_LABELS,
  REFUND_STATUS_LABELS,
  REFUND_STATUSES,
  type RefundStatus,
} from '@marketplace/shared-types';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  ErrorState,
  formatMoney,
  Input,
  Label,
  LoadingState,
  PageHeader,
  PaymentAttemptBadge,
  PromptDialog,
  RefundList,
  RefundStatusBadge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TestModeBadge,
  Textarea,
} from '@marketplace/ui';
import type {
  AdminPayment,
  AdminProof,
  CodCollectionDto,
  RefundDto,
  RemittanceDto,
  WebhookEventDto,
} from '@marketplace/validation';
import {
  BanknoteIcon,
  CreditCardIcon,
  LandmarkIcon,
  RotateCcwIcon,
  WebhookIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { openBlob, showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { RefundButtons } from '../orders/order-actions';
import { useCan, useRun } from '../orders/use-actions';

const PAGE_SIZE = 25;
const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);
const pageOf = (
  data: { totalItems: number } | undefined,
  page: number,
  setPage: (n: number) => void,
  isFetching: boolean,
) =>
  data
    ? { page, pageSize: PAGE_SIZE, totalItems: data.totalItems, onPageChange: setPage, isFetching }
    : undefined;

// ---- Payments ------------------------------------------------------------------------------------

const paymentColumns: DataTableColumn<AdminPayment>[] = [
  {
    id: 'reference',
    header: 'Payment',
    cell: (p) => (
      <div>
        <Link to={`/payments/${p.id}`} className="font-mono font-medium hover:underline">
          {p.reference}
        </Link>
        <p className="text-xs text-muted-foreground">{formatDateTime(p.createdAt)}</p>
      </div>
    ),
  },
  {
    id: 'order',
    header: 'Order',
    cell: (p) => (
      <div>
        <Link to={`/orders/${p.order.id}`} className="font-mono hover:underline">
          {p.order.orderNumber}
        </Link>
        <p className="text-xs text-muted-foreground">{p.customer.name}</p>
      </div>
    ),
  },
  {
    id: 'method',
    header: 'Method',
    hideOnMobile: true,
    cell: (p) => (
      <span>
        {PAYMENT_METHOD_LABELS[p.method]}
        <span className="block text-xs text-muted-foreground">
          {PAYMENT_PROVIDER_LABELS[p.provider]}
        </span>
      </span>
    ),
  },
  {
    id: 'amount',
    header: 'Amount',
    cell: (p) => <span className="font-mono">{formatMoney(p.amount)}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (p) => (
      <span className="flex flex-wrap gap-1">
        <PaymentAttemptBadge status={p.status} />
        {!p.livemode ? <TestModeBadge /> : null}
        {p.reviewReason && !p.reviewedAt ? (
          <Badge variant="destructive">{PAYMENT_REVIEW_REASON_LABELS[p.reviewReason]}</Badge>
        ) : null}
      </span>
    ),
  },
];

function PaymentTable({ queue }: { queue?: 'review' | 'failed' }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const payments = useAdminPayments({
    queue,
    search: search.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  return (
    <div className="space-y-3">
      <Input
        type="search"
        className="sm:w-80"
        aria-label="Search payments"
        placeholder="Payment reference, order number, email"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <DataTable
        label="Payments"
        columns={paymentColumns}
        rows={payments.data?.items}
        getRowId={(p) => p.id}
        isLoading={payments.isPending}
        error={toDisplayError(payments.error)}
        onRetry={() => void payments.refetch()}
        empty={{
          icon: CreditCardIcon,
          title: queue ? 'Nothing to review' : 'No payments',
          description:
            queue === 'review'
              ? 'Money that cannot pay an order (late, duplicate, wrong amount) shows here.'
              : undefined,
        }}
        pagination={pageOf(payments.data, page, setPage, payments.isFetching)}
      />
    </div>
  );
}

function WebhookEvents() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('FAILED');
  const events = useWebhookEvents({
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const can = useCan();
  const { run, pending } = useRun();
  const columns: DataTableColumn<WebhookEventDto>[] = [
    {
      id: 'event',
      header: 'Event',
      cell: (e) => (
        <div>
          <p className="font-medium">{e.eventType}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {e.source} · {e.eventId}
          </p>
        </div>
      ),
    },
    {
      id: 'received',
      header: 'Received',
      hideOnMobile: true,
      cell: (e) => formatDateTime(e.receivedAt),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (e) => (
        <div>
          <Badge
            variant={
              e.status === 'FAILED'
                ? 'destructive'
                : e.status === 'PROCESSED'
                  ? 'success'
                  : 'secondary'
            }
          >
            {e.status}
          </Badge>
          {e.error ? <p className="text-xs text-muted-foreground">{e.error}</p> : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (e) =>
        can('payments.manage') && (e.status === 'FAILED' || e.status === 'RECEIVED') ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              quiet(
                run('Could not reprocess', 'Event processed again', (f) =>
                  f.admin.payments.reprocess(e.id),
                ),
              )
            }
          >
            Reprocess
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="space-y-3">
      <div className="sm:w-56">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Event status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['FAILED', 'RECEIVED', 'PROCESSED', 'IGNORED', 'ALL'].map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All events' : s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        label="Provider events"
        columns={columns}
        rows={events.data?.items}
        getRowId={(e) => e.id}
        isLoading={events.isPending}
        error={toDisplayError(events.error)}
        onRetry={() => void events.refetch()}
        empty={{ icon: WebhookIcon, title: 'No events here' }}
        pagination={pageOf(events.data, page, setPage, events.isFetching)}
      />
    </div>
  );
}

function Gateways() {
  const gateways = usePaymentGateways();
  if (gateways.isPending) return <LoadingState />;
  if (gateways.isError)
    return (
      <ErrorState message="Could not load the gateways." onRetry={() => void gateways.refetch()} />
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {gateways.data.items.map((g) => (
        <Card key={g.provider}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {g.label}
              <span className="flex gap-1">
                {g.active ? (
                  <Badge variant="success">Taking payments</Badge>
                ) : (
                  <Badge variant="secondary">Not active</Badge>
                )}
                {g.active && !g.livemode ? <TestModeBadge /> : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {g.methods.length > 0 ? (
              <p>Methods: {g.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(', ')}</p>
            ) : null}
            {g.note ? <p className="text-muted-foreground">{g.note}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PaymentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every payment attempt, money waiting for a decision, failed payments and provider events."
      />
      <Tabs defaultValue="review">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="review">Needs review</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
          <TabsTrigger value="all">All payments</TabsTrigger>
          <TabsTrigger value="events">Provider events</TabsTrigger>
          <TabsTrigger value="gateways">Gateways</TabsTrigger>
        </TabsList>
        <TabsContent value="review">
          <PaymentTable queue="review" />
        </TabsContent>
        <TabsContent value="failed">
          <PaymentTable queue="failed" />
        </TabsContent>
        <TabsContent value="all">
          <PaymentTable />
        </TabsContent>
        <TabsContent value="events">
          <WebhookEvents />
        </TabsContent>
        <TabsContent value="gateways">
          <Gateways />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function PaymentPage() {
  const { paymentId } = useParams();
  const payment = useAdminPayment(paymentId);
  const can = useCan();
  const { run } = useRun();
  const [key] = useState(() => crypto.randomUUID());
  if (payment.isPending) return <LoadingState />;
  if (payment.isError)
    return (
      <ErrorState
        message={toDisplayError(payment.error)?.message ?? 'Could not load the payment.'}
        onRetry={() => void payment.refetch()}
      />
    );
  const p = payment.data;
  const outstanding = Number(p.amountReceived) - Number(p.refundedAmount);
  const needsReview = (!!p.reviewReason || p.status === 'FAILED') && !p.reviewedAt;
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Payments', to: '/payments' }, { label: p.reference }]} />
      <PageHeader
        title={`Payment ${p.reference}`}
        description={`${PAYMENT_METHOD_LABELS[p.method]} via ${PAYMENT_PROVIDER_LABELS[p.provider]} · order ${p.order.orderNumber}`}
        actions={
          <span className="flex gap-1">
            <PaymentAttemptBadge status={p.status} />
            {!p.livemode ? <TestModeBadge label="Test: no real money" /> : null}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {p.reviewReason ? (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-base">
                  {PAYMENT_REVIEW_REASON_LABELS[p.reviewReason]}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {p.reviewReason === 'AMOUNT_MISMATCH'
                    ? p.failureMessage
                    : `${formatMoney(p.amountReceived)} arrived but cannot pay the order (it had expired, was cancelled or was already paid). Refund it to the customer.`}
                </p>
                {p.reviewedAt ? (
                  <p className="text-muted-foreground">Resolved {formatDateTime(p.reviewedAt)}.</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {p.events.map((e, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span>
                      {e.type.replaceAll('_', ' ').toLowerCase()}
                      {e.actorName ? ` · ${e.actorName}` : ''}
                      {e.webhookEventId ? ' · from a provider event' : ''}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Refunds</CardTitle>
            </CardHeader>
            <CardContent>
              <RefundList refunds={p.refunds} actions={(r) => <RefundButtons refund={r} />} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-1.5 pt-6 text-sm">
              <p className="flex justify-between">
                <span>Amount</span>
                <span className="font-mono">{formatMoney(p.amount)}</span>
              </p>
              <p className="flex justify-between">
                <span>Received</span>
                <span className="font-mono">{formatMoney(p.amountReceived)}</span>
              </p>
              <p className="flex justify-between">
                <span>Refunded</span>
                <span className="font-mono">{formatMoney(p.refundedAmount)}</span>
              </p>
              {p.providerReference ? (
                <p className="break-all text-xs text-muted-foreground">
                  Provider ref: {p.providerReference}
                </p>
              ) : null}
              {p.providerPaymentId ? (
                <p className="break-all text-xs text-muted-foreground">
                  Provider payment: {p.providerPaymentId}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Customer: {p.customer.name} · {p.customer.email}
              </p>
            </CardContent>
          </Card>
          {can('refunds.manage') && outstanding > 0 && p.reviewReason ? (
            <PromptDialog
              trigger={
                <Button className="w-full">Refund {formatMoney(outstanding.toFixed(2))}</Button>
              }
              title="Refund this money"
              description="Sent back through the provider when possible; otherwise recorded for a manual payout."
              label="Note"
              confirmLabel="Refund"
              onSubmit={(note) =>
                run('Could not refund', 'Refund created', (f) =>
                  f.admin.refunds.create({
                    paymentId: p.id,
                    reason:
                      p.reviewReason === 'DUPLICATE_PAYMENT'
                        ? 'DUPLICATE_PAYMENT'
                        : p.reviewReason === 'LATE_PAYMENT'
                          ? 'LATE_PAYMENT'
                          : 'OTHER',
                    kind: 'FULL',
                    note,
                    idempotencyKey: key,
                  }),
                )
              }
            />
          ) : null}
          {can('payments.manage') && needsReview ? (
            <PromptDialog
              trigger={
                <Button variant="outline" className="w-full">
                  Mark as resolved
                </Button>
              }
              title="Mark as resolved"
              description="Record what was done (e.g. refunded, customer contacted)."
              label="What was done"
              confirmLabel="Resolve"
              onSubmit={(note) =>
                run('Could not resolve', 'Resolved', (f) => f.admin.payments.resolve(p.id, note))
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---- Bank transfers --------------------------------------------------------------------------

export function BankTransfersPage() {
  const [status, setStatus] = useState('SUBMITTED');
  const [page, setPage] = useState(1);
  const proofs = useBankProofs({ status, page, pageSize: PAGE_SIZE });
  const client = useApiClient();
  const can = useCan();
  const { run } = useRun();
  const columns: DataTableColumn<AdminProof>[] = [
    {
      id: 'order',
      header: 'Order',
      cell: (p) => (
        <div>
          <Link to={`/orders/${p.order.id}`} className="font-mono hover:underline">
            {p.order.orderNumber}
          </Link>
          <p className="text-xs text-muted-foreground">{p.customer.name}</p>
        </div>
      ),
    },
    {
      id: 'transfer',
      header: 'Transfer',
      cell: (p) => (
        <div className="text-sm">
          <p>
            {p.bankName} · <span className="font-mono">{p.referenceNumber}</span>
          </p>
          <p className="text-xs text-muted-foreground">{formatDateTime(p.transferredAt)}</p>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (p) => (
        <div>
          <p className="font-mono">{formatMoney(p.amount)}</p>
          {p.amount !== p.payment.amount ? (
            <Badge variant="destructive">Expected {formatMoney(p.payment.amount)}</Badge>
          ) : (
            <p className="text-xs text-muted-foreground">ref {p.payment.reference}</p>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (p) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void client.fulfilment.admin.proofs
                .file(p.id)
                .then((blob) => openBlob(blob, `proof-${p.referenceNumber}`))
                .catch((e: unknown) => showError('Could not open the proof', e))
            }
          >
            View proof
          </Button>
          {p.status === 'SUBMITTED' && can('payments.manage') ? (
            <>
              <ConfirmDialog
                trigger={<Button size="sm">Approve</Button>}
                title={`Confirm ${formatMoney(p.payment.amount)} arrived?`}
                description={`Check the marketplace's bank account for reference ${p.referenceNumber}. The order becomes paid and goes to the sellers.`}
                onConfirm={() =>
                  run('Could not approve', 'Payment confirmed', (f) => f.admin.proofs.approve(p.id))
                }
              />
              <PromptDialog
                trigger={
                  <Button size="sm" variant="ghost">
                    Reject
                  </Button>
                }
                title="Reject this proof"
                description="The customer sees the reason and gets more time to pay."
                label="Reason"
                minLength={5}
                confirmLabel="Reject"
                destructive
                onSubmit={(text) =>
                  run('Could not reject', 'Proof rejected', (f) =>
                    f.admin.proofs.reject(p.id, text),
                  )
                }
              />
            </>
          ) : (
            <Badge variant={p.status === 'APPROVED' ? 'success' : 'secondary'}>
              {p.status.toLowerCase()}
              {p.reviewedBy ? ` by ${p.reviewedBy}` : ''}
            </Badge>
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank transfer verification"
        description="Customers' transfer receipts, oldest first. Approve only after the money shows in the bank account."
      />
      <div className="sm:w-56">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Proof status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SUBMITTED">Waiting for review</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable
        label="Bank transfer proofs"
        columns={columns}
        rows={proofs.data?.items}
        getRowId={(p) => p.id}
        isLoading={proofs.isPending}
        error={toDisplayError(proofs.error)}
        onRetry={() => void proofs.refetch()}
        empty={{ icon: LandmarkIcon, title: 'No proofs here' }}
        pagination={pageOf(proofs.data, page, setPage, proofs.isFetching)}
      />
    </div>
  );
}

// ---- Cash on delivery ------------------------------------------------------------------------

function RecordRemittance({
  selected,
  carrier,
  onDone,
}: {
  selected: CodCollectionDto[];
  carrier: Carrier;
  onDone: () => void;
}) {
  const { run } = useRun();
  const expected = selected
    .reduce((s, c) => s + Number(c.collectedAmount ?? c.expectedAmount), 0)
    .toFixed(2);
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const differs = amount !== '' && Number(amount).toFixed(2) !== expected;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Record a {CARRIER_LABELS[carrier]} remittance for {selected.length} parcel(s) ·{' '}
          {formatMoney(expected)}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="rmt-ref">Remittance reference</Label>
          <Input id="rmt-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rmt-amount">Amount received (₱)</Label>
          <Input
            id="rmt-amount"
            inputMode="decimal"
            placeholder={expected}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rmt-when">Received on</Label>
          <Input
            id="rmt-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        {differs ? (
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="rmt-note">Why does the amount differ?</Label>
            <Textarea
              id="rmt-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        ) : null}
        <Button
          className="sm:col-span-3 sm:justify-self-start"
          disabled={
            reference.trim().length < 3 || !amount || !when || (differs && note.trim().length < 5)
          }
          onClick={() =>
            quiet(
              run(
                'Could not record the remittance',
                'Remittance recorded; the money now counts as received',
                (f) =>
                  f.admin.cod.record({
                    carrier,
                    reference: reference.trim(),
                    amount: Number(amount).toFixed(2),
                    remittedAt: new Date(when).toISOString(),
                    collectionIds: selected.map((c) => c.id),
                    ...(differs ? { discrepancyNote: note.trim() } : {}),
                  }),
              ).then(onDone),
            )
          }
        >
          Record remittance
        </Button>
      </CardContent>
    </Card>
  );
}

export function CodPage() {
  const [status, setStatus] = useState<CodCollectionStatus>('COLLECTED');
  const [carrier, setCarrier] = useState<Carrier>('MOCK');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, CodCollectionDto>>({});
  const can = useCan();
  const collections = useCodCollections({ status, carrier, page, pageSize: PAGE_SIZE });
  const [rPage, setRPage] = useState(1);
  const remittances = useRemittances({ page: rPage, pageSize: PAGE_SIZE });
  const columns: DataTableColumn<CodCollectionDto>[] = [
    ...(status === 'COLLECTED' && can('cod.manage')
      ? [
          {
            id: 'select',
            header: <span className="sr-only">Select</span>,
            cell: (c: CodCollectionDto) => (
              <Checkbox
                aria-label={`Include ${c.sellerOrderNumber}`}
                checked={!!selected[c.id]}
                onCheckedChange={(v) =>
                  setSelected((s) => {
                    const next = { ...s };
                    if (v === true) next[c.id] = c;
                    else delete next[c.id];
                    return next;
                  })
                }
              />
            ),
          },
        ]
      : []),
    {
      id: 'order',
      header: 'Seller order',
      cell: (c) => (
        <div>
          <Link to={`/seller-orders/${c.sellerOrderId}`} className="font-mono hover:underline">
            {c.sellerOrderNumber}
          </Link>
          <p className="text-xs text-muted-foreground">{c.sellerName}</p>
        </div>
      ),
    },
    {
      id: 'tracking',
      header: 'Tracking',
      hideOnMobile: true,
      cell: (c) => <span className="font-mono text-xs">{c.trackingNumber ?? '—'}</span>,
    },
    {
      id: 'expected',
      header: 'Expected',
      cell: (c) => <span className="font-mono">{formatMoney(c.expectedAmount)}</span>,
    },
    {
      id: 'collected',
      header: 'Collected',
      cell: (c) =>
        c.collectedAmount ? (
          <span className="font-mono">{formatMoney(c.collectedAmount)}</span>
        ) : (
          '—'
        ),
    },
    {
      id: 'when',
      header: 'Collected on',
      hideOnMobile: true,
      cell: (c) => (c.collectedAt ? formatDateTime(c.collectedAt) : '—'),
    },
    { id: 'status', header: 'Status', cell: (c) => COD_COLLECTION_STATUS_LABELS[c.status] },
  ];
  const remittanceColumns: DataTableColumn<RemittanceDto>[] = [
    {
      id: 'ref',
      header: 'Reference',
      cell: (r) => <span className="font-mono">{r.reference}</span>,
    },
    { id: 'carrier', header: 'Courier', cell: (r) => CARRIER_LABELS[r.carrier] },
    {
      id: 'when',
      header: 'Received',
      hideOnMobile: true,
      cell: (r) => formatDateTime(r.remittedAt),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (r) => (
        <div>
          <p className="font-mono">{formatMoney(r.amount)}</p>
          {r.discrepancyNote ? (
            <p className="text-xs text-destructive">
              Expected {formatMoney(r.expectedAmount)}: {r.discrepancyNote}
            </p>
          ) : null}
        </div>
      ),
    },
    { id: 'parcels', header: 'Parcels', cell: (r) => r.collections },
    { id: 'by', header: 'Recorded by', hideOnMobile: true, cell: (r) => r.recordedBy },
  ];
  const chosen = Object.values(selected);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash on delivery"
        description="Cash collected by couriers is only counted as received once their remittance is recorded here."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-56">
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as CodCollectionStatus);
              setSelected({});
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Collection status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['COLLECTED', 'PENDING', 'REMITTED', 'FAILED'] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {COD_COLLECTION_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:w-56">
          <Select
            value={carrier}
            onValueChange={(v) => {
              setCarrier(v as Carrier);
              setSelected({});
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Courier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CARRIERS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CARRIER_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {chosen.length > 0 ? (
        <RecordRemittance selected={chosen} carrier={carrier} onDone={() => setSelected({})} />
      ) : null}
      <DataTable
        label="Cash-on-delivery parcels"
        columns={columns}
        rows={collections.data?.items}
        getRowId={(c) => c.id}
        isLoading={collections.isPending}
        error={toDisplayError(collections.error)}
        onRetry={() => void collections.refetch()}
        empty={{ icon: BanknoteIcon, title: 'No parcels here' }}
        pagination={pageOf(collections.data, page, setPage, collections.isFetching)}
      />
      <h2 className="text-lg font-semibold">Remittances</h2>
      <DataTable
        label="Remittances"
        columns={remittanceColumns}
        rows={remittances.data?.items}
        getRowId={(r) => r.id}
        isLoading={remittances.isPending}
        error={toDisplayError(remittances.error)}
        onRetry={() => void remittances.refetch()}
        empty={{ icon: BanknoteIcon, title: 'No remittances recorded yet' }}
        pagination={pageOf(remittances.data, rPage, setRPage, remittances.isFetching)}
      />
    </div>
  );
}

// ---- Refunds ---------------------------------------------------------------------------------

export function RefundsPage() {
  const [status, setStatus] = useState<RefundStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const refunds = useAdminRefunds({
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<RefundDto>[] = [
    {
      id: 'ref',
      header: 'Refund',
      cell: (r) => (
        <div>
          <p className="font-mono font-medium">{r.reference}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'order',
      header: 'Order',
      cell: (r) => (
        <div>
          <Link to={`/orders/${r.orderId}`} className="font-mono hover:underline">
            {r.orderNumber}
          </Link>
          {r.sellerOrderNumber ? (
            <p className="text-xs text-muted-foreground">{r.sellerOrderNumber}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      cell: (r) => `${REFUND_REASON_LABELS[r.reason]}${r.kind === 'PARTIAL' ? ' (partial)' : ''}`,
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: (r) => (
        <div>
          <p className="font-mono">{formatMoney(r.amount)}</p>
          {Number(r.sellerDebit) > 0 ? (
            <p className="text-xs text-muted-foreground">
              Seller pays {formatMoney(r.sellerDebit)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <RefundStatusBadge status={r.status} />
          {r.test ? <TestModeBadge /> : null}
          <RefundButtons refund={r} />
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Refunds to customers: through the payment provider, or paid out manually by finance."
      />
      <div className="sm:w-56">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as RefundStatus);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Refund status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All refunds</SelectItem>
            {REFUND_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {REFUND_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        label="Refunds"
        columns={columns}
        rows={refunds.data?.items}
        getRowId={(r) => r.id}
        isLoading={refunds.isPending}
        error={toDisplayError(refunds.error)}
        onRetry={() => void refunds.refetch()}
        empty={{ icon: RotateCcwIcon, title: 'No refunds' }}
        pagination={pageOf(refunds.data, page, setPage, refunds.isFetching)}
      />
    </div>
  );
}

// ---- Reconciliation --------------------------------------------------------------------------

const manilaToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

export function ReconciliationPage() {
  const [from, setFrom] = useState(() => manilaToday().slice(0, 8) + '01');
  const [to, setTo] = useState(manilaToday);
  const report = useReconciliation(from, to);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reconciliation"
        description="Money received and refunded per method, cash still with couriers, and everything that needs a person."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="rec-from">From</Label>
          <Input id="rec-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rec-to">To</Label>
          <Input id="rec-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {report.isPending ? <LoadingState /> : null}
      {report.isError ? (
        <ErrorState
          message={toDisplayError(report.error)?.message ?? 'Could not load the report.'}
          onRetry={() => void report.refetch()}
        />
      ) : null}
      {report.data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Received and refunded</CardTitle>
            </CardHeader>
            <CardContent>
              {report.data.byMethod.length === 0 ? (
                <p className="text-sm text-muted-foreground">No money received in this period.</p>
              ) : null}
              <ul className="divide-y text-sm">
                {report.data.byMethod.map((m) => (
                  <li
                    key={`${m.method}-${m.provider}-${m.livemode}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="flex items-center gap-2">
                      {PAYMENT_METHOD_LABELS[m.method]} · {PAYMENT_PROVIDER_LABELS[m.provider]} (
                      {m.payments}){!m.livemode ? <TestModeBadge /> : null}
                    </span>
                    <span className="font-mono">
                      {formatMoney(m.received)} − {formatMoney(m.refunded)} = {formatMoney(m.net)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash on delivery</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                To collect: {report.data.cod.pendingCount} parcel(s) ·{' '}
                {formatMoney(report.data.cod.pendingAmount)}
              </p>
              <p>
                With couriers (not remitted): {report.data.cod.collectedNotRemittedCount} ·{' '}
                {formatMoney(report.data.cod.collectedNotRemittedAmount)}
              </p>
              <p>Remitted in the period: {formatMoney(report.data.cod.remittedAmount)}</p>
              <p>Remittances with a discrepancy: {report.data.cod.discrepancies}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Exceptions ({report.data.exceptions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.data.exceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
              ) : null}
              <ul className="divide-y text-sm">
                {report.data.exceptions.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <Badge variant="outline" className="mr-2">
                        {e.kind.replaceAll('_', ' ').toLowerCase()}
                      </Badge>
                      {e.message}
                    </span>
                    <span className="flex gap-2">
                      {e.paymentId ? (
                        <Link
                          to={`/payments/${e.paymentId}`}
                          className="text-primary hover:underline"
                        >
                          Payment
                        </Link>
                      ) : null}
                      {e.orderId ? (
                        <Link to={`/orders/${e.orderId}`} className="text-primary hover:underline">
                          Order
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
