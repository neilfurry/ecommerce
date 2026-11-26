import {
  toDisplayError,
  useFulfilmentAction,
  useSellerLedger,
  useSellerReturn,
  useSellerReturns,
} from '@marketplace/api-client';
import {
  RETURN_REASON_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_STATUSES,
  type ReturnStatus,
  ledgerKindLabel,
} from '@marketplace/shared-types';
import {
  Breadcrumbs,
  Button,
  Checkbox,
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
  ReturnStatusBadge,
  ReturnView,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@marketplace/ui';
import type { LedgerEntryDto, ReturnDto } from '@marketplace/validation';
import { RotateCcwIcon, WalletIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;

export function ReturnsPage() {
  const [status, setStatus] = useState<ReturnStatus | 'ALL'>('REQUESTED');
  const [page, setPage] = useState(1);
  const returns = useSellerReturns({
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<ReturnDto>[] = [
    {
      id: 'number',
      header: 'Return',
      cell: (r) => (
        <div>
          <Link to={`/returns/${r.id}`} className="font-mono font-medium hover:underline">
            {r.number}
          </Link>
          <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p>
        </div>
      ),
    },
    { id: 'customer', header: 'Customer', cell: (r) => r.customerName },
    {
      id: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      cell: (r) => RETURN_REASON_LABELS[r.reason],
    },
    {
      id: 'deadline',
      header: 'Answer by',
      hideOnMobile: true,
      cell: (r) => (r.status === 'REQUESTED' ? formatDateTime(r.sellerDeadline) : '—'),
    },
    { id: 'status', header: 'Status', cell: (r) => <ReturnStatusBadge status={r.status} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Returns"
        description="Answer return requests before their deadline; unanswered requests go to the marketplace."
      />
      <div className="sm:w-56">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as ReturnStatus);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All returns</SelectItem>
            {RETURN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {RETURN_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        label="Returns"
        columns={columns}
        rows={returns.data?.items}
        getRowId={(r) => r.id}
        isLoading={returns.isPending}
        error={toDisplayError(returns.error)}
        onRetry={() => void returns.refetch()}
        empty={{
          icon: RotateCcwIcon,
          title: 'No returns here',
          description: 'Return requests from customers appear here.',
        }}
        pagination={
          returns.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: returns.data.totalItems,
                onPageChange: setPage,
                isFetching: returns.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}

function Approve({ ret }: { ret: ReturnDto }) {
  const action = useFulfilmentAction();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<'FULL_REFUND' | 'PARTIAL_REFUND' | 'REPLACEMENT'>(
    ret.requestedResolution === 'REPLACEMENT' ? 'REPLACEMENT' : 'FULL_REFUND',
  );
  const [amount, setAmount] = useState('');
  const [needsItem, setNeedsItem] = useState(true);
  const [response, setResponse] = useState('');
  return (
    <>
      <Button onClick={() => setOpen(true)}>Approve</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve return {ret.number}</DialogTitle>
            <DialogDescription>
              Refunds are paid by the marketplace and taken from your payables (commission on the
              refunded items is returned to you).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="resolution">Resolution</Label>
              <Select value={resolution} onValueChange={(v) => setResolution(v as 'FULL_REFUND')}>
                <SelectTrigger id="resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_REFUND">
                    Full refund ({formatMoney(ret.maxRefund)})
                  </SelectItem>
                  <SelectItem value="PARTIAL_REFUND">Partial refund</SelectItem>
                  <SelectItem value="REPLACEMENT">Replacement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {resolution === 'PARTIAL_REFUND' ? (
              <div className="space-y-1">
                <Label htmlFor="amount">
                  Amount to refund (at most {formatMoney(ret.maxRefund)})
                </Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={needsItem} onCheckedChange={(v) => setNeedsItem(v === true)} />
              The customer must send the item back first
            </label>
            <div className="space-y-1">
              <Label htmlFor="response">Message to the customer (optional)</Label>
              <Textarea
                id="response"
                rows={2}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              disabled={
                action.isPending ||
                (resolution === 'PARTIAL_REFUND' && !/^\d+(\.\d{1,2})?$/.test(amount))
              }
              onClick={() =>
                action.mutate(
                  (f) =>
                    f.seller.returns.approve(ret.id, {
                      resolution,
                      requiresReturnShipment: needsItem,
                      ...(resolution === 'PARTIAL_REFUND'
                        ? { refundAmount: Number(amount).toFixed(2) }
                        : {}),
                      ...(response.trim() ? { response: response.trim() } : {}),
                    }),
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.success('Return approved');
                    },
                    onError: (e) => showError('Could not approve', e),
                  },
                )
              }
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReplacementOrReceive({ ret }: { ret: ReturnDto }) {
  const action = useFulfilmentAction();
  const [carrierName, setCarrierName] = useState('');
  const [tracking, setTracking] = useState('');
  const waitingItem =
    ['APPROVED', 'RETURN_SHIPPED'].includes(ret.status) && ret.requiresReturnShipment;
  const replacement =
    ret.resolution === 'REPLACEMENT' &&
    (ret.status === 'RECEIVED' || (ret.status === 'APPROVED' && !ret.requiresReturnShipment)) &&
    !ret.shipments.some((s) => s.direction === 'FORWARD' && s.status !== 'CANCELLED');
  const receive = (restock: boolean) =>
    action.mutate((f) => f.seller.returns.receive(ret.id, restock), {
      onSuccess: () => toast.success('Return received'),
      onError: (e) => showError('Could not record the return', e),
    });
  return (
    <>
      {waitingItem ? (
        <>
          <Button disabled={action.isPending} onClick={() => receive(true)}>
            Item received — put back in stock
          </Button>
          <Button variant="outline" disabled={action.isPending} onClick={() => receive(false)}>
            Item received — damaged, do not restock
          </Button>
        </>
      ) : null}
      {replacement ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Send the replacement</p>
          <Input
            aria-label="Courier"
            placeholder="Courier"
            value={carrierName}
            onChange={(e) => setCarrierName(e.target.value)}
          />
          <Input
            aria-label="Tracking number"
            placeholder="Tracking number"
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
          />
          <Button
            disabled={
              action.isPending || carrierName.trim().length < 2 || tracking.trim().length < 4
            }
            onClick={() =>
              action.mutate(
                (f) =>
                  f.seller.returns.replacement(ret.id, {
                    carrierName: carrierName.trim(),
                    trackingNumber: tracking.trim(),
                  }),
                {
                  onSuccess: () => toast.success('Replacement sent'),
                  onError: (e) => showError('Could not send', e),
                },
              )
            }
          >
            Replacement sent
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** One return with its breadcrumbs and the seller's (or staff's) actions. */
export function ReturnDetail({
  ret,
  actions,
  backTo,
}: {
  ret: ReturnDto;
  actions?: ReactNode;
  backTo: { label: string; to: string };
}) {
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[backTo, { label: ret.number }]} />
      <PageHeader
        title={`Return ${ret.number}`}
        description={`${ret.store.name} · order ${ret.sellerOrderNumber} · ${ret.customerName}`}
      />
      <ReturnView ret={ret} actions={actions} />
    </div>
  );
}

export function ReturnPage() {
  const { returnId } = useParams();
  const ret = useSellerReturn(returnId);
  const action = useFulfilmentAction();
  if (ret.isPending) return <LoadingState />;
  if (ret.isError)
    return (
      <ErrorState
        message={toDisplayError(ret.error)?.message ?? 'Could not load the return.'}
        onRetry={() => void ret.refetch()}
      />
    );
  const r = ret.data;
  return (
    <ReturnDetail
      ret={r}
      backTo={{ label: 'Returns', to: '/returns' }}
      actions={
        <>
          {r.status === 'REQUESTED' ? (
            <>
              <Approve ret={r} />
              <PromptDialog
                trigger={<Button variant="outline">Reject</Button>}
                title="Reject this return"
                description="The customer can ask the marketplace to review your decision."
                label="Reason (shown to the customer)"
                minLength={10}
                confirmLabel="Reject"
                destructive
                onSubmit={(text) =>
                  action
                    .mutateAsync((f) => f.seller.returns.reject(r.id, text))
                    .catch((e: unknown) => {
                      showError('Could not reject', e);
                      throw e;
                    })
                }
              />
            </>
          ) : null}
          <ReplacementOrReceive ret={r} />
        </>
      }
    />
  );
}

const ledgerColumns: DataTableColumn<LedgerEntryDto>[] = [
  { id: 'date', header: 'Date', cell: (e) => formatDateTime(e.createdAt) },
  { id: 'type', header: 'Type', cell: (e) => ledgerKindLabel(e.type) },
  {
    id: 'description',
    header: 'Description',
    hideOnMobile: true,
    cell: (e) =>
      e.sellerOrderId ? (
        <Link to={`/orders/${e.sellerOrderId}`} className="hover:underline">
          {e.description}
        </Link>
      ) : (
        e.description
      ),
  },
  {
    id: 'amount',
    header: 'Amount',
    cell: (e) => (
      <span className={`font-mono ${Number(e.amount) < 0 ? 'text-destructive' : ''}`}>
        {formatMoney(e.amount)}
      </span>
    ),
  },
];

/** What the marketplace owes the seller: earnings less commission and refunds (payouts: Finance phase). */
export function PayablesPage() {
  const [page, setPage] = useState(1);
  const ledger = useSellerLedger({ page, pageSize: PAGE_SIZE });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payables"
        description="Earnings are added when the customer’s money is received (cash on delivery: when the courier remits it)."
        actions={
          ledger.data ? (
            <p className="text-lg font-semibold">
              Balance <span className="font-mono">{formatMoney(ledger.data.balance)}</span>
            </p>
          ) : undefined
        }
      />
      <DataTable
        label="Payables ledger"
        columns={ledgerColumns}
        rows={ledger.data?.items}
        getRowId={(e) => e.id}
        isLoading={ledger.isPending}
        error={toDisplayError(ledger.error)}
        onRetry={() => void ledger.refetch()}
        empty={{
          icon: WalletIcon,
          title: 'Nothing yet',
          description: 'Paid orders add earnings here.',
        }}
        pagination={
          ledger.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: ledger.data.totalItems,
                onPageChange: setPage,
                isFetching: ledger.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
