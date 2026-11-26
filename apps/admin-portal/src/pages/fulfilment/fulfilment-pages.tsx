import {
  toDisplayError,
  useAdminCarriers,
  usePlatformSettings,
  useAdminReturn,
  useAdminReturns,
  useAdminShipments,
} from '@marketplace/api-client';
import {
  CARRIER_LABELS,
  CARRIERS,
  RETURN_REASON_LABELS,
  RETURN_RESOLUTION_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_STATUSES,
  type ReturnStatus,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUSES,
  type ShipmentStatus,
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
  DataTable,
  type DataTableColumn,
  ErrorState,
  formatMoney,
  Input,
  Label,
  LoadingState,
  PageHeader,
  ReturnStatusBadge,
  ReturnView,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ShipmentStatusBadge,
  TestModeBadge,
  Textarea,
} from '@marketplace/ui';
import type { BankAccount, OrderSettings, ReturnDto, ShipmentDto } from '@marketplace/validation';
import { RotateCcwIcon, TruckIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDateTime } from '../../lib/format';
import { StaffShipmentButtons } from '../orders/order-actions';
import { useCan, useRun } from '../orders/use-actions';

const PAGE_SIZE = 25;
const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

// ---- Shipping --------------------------------------------------------------------------------

function OrderSettingsForm({ initial }: { initial: OrderSettings }) {
  const carriers = useAdminCarriers();
  const { run, pending } = useRun();
  const [value, setValue] = useState(initial);
  const setBank = (index: number, patch: Partial<BankAccount>) =>
    setValue((v) => ({
      ...v,
      bankTransfer: {
        ...v.bankTransfer,
        accounts: v.bankTransfer.accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)),
      },
    }));
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        quiet(
          run('Could not save the settings', 'Settings saved', (f) =>
            f.admin.shipping.saveSettings(value),
          ),
        );
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Couriers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {carriers.data?.items.map((c) => (
            <label key={c.carrier} className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={!!value.carriers[c.carrier]}
                disabled={!c.available}
                onCheckedChange={(on) =>
                  setValue((v) => ({ ...v, carriers: { ...v.carriers, [c.carrier]: on === true } }))
                }
              />
              <span>
                <span className="flex items-center gap-2 font-medium">
                  {c.label} {!c.livemode && c.available ? <TestModeBadge /> : null}
                  {!c.available ? <Badge variant="secondary">Not connected</Badge> : null}
                </span>
                {c.note ? <span className="text-xs text-muted-foreground">{c.note}</span> : null}
              </span>
            </label>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bank transfer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Bank transfer is offered at checkout only while at least one receiving account is
            listed.
          </p>
          {value.bankTransfer.accounts.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
              <Input
                aria-label="Bank"
                placeholder="Bank"
                value={a.bankName}
                onChange={(e) => setBank(i, { bankName: e.target.value })}
              />
              <Input
                aria-label="Account name"
                placeholder="Account name"
                value={a.accountName}
                onChange={(e) => setBank(i, { accountName: e.target.value })}
              />
              <Input
                aria-label="Account number"
                placeholder="Account number"
                value={a.accountNumber}
                onChange={(e) => setBank(i, { accountNumber: e.target.value })}
              />
              <div className="flex gap-2">
                <Input
                  aria-label="Branch"
                  placeholder="Branch (optional)"
                  value={a.branch ?? ''}
                  onChange={(e) => setBank(i, { branch: e.target.value || null })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setValue((v) => ({
                      ...v,
                      bankTransfer: {
                        ...v.bankTransfer,
                        accounts: v.bankTransfer.accounts.filter((_, j) => j !== i),
                      },
                    }))
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {value.bankTransfer.accounts.length < 3 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setValue((v) => ({
                  ...v,
                  bankTransfer: {
                    ...v.bankTransfer,
                    accounts: [
                      ...v.bankTransfer.accounts,
                      { bankName: '', accountName: '', accountNumber: '', branch: null },
                    ],
                  },
                }))
              }
            >
              Add account
            </Button>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="bank-window">Hours to pay</Label>
              <Input
                id="bank-window"
                type="number"
                min={1}
                max={72}
                value={value.bankTransfer.windowHours}
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    bankTransfer: { ...v.bankTransfer, windowHours: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="bank-instructions">Instructions shown to customers</Label>
              <Textarea
                id="bank-instructions"
                rows={2}
                value={value.bankTransfer.instructions}
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    bankTransfer: { ...v.bankTransfer, instructions: e.target.value },
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cash on delivery and returns</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cod-max">Largest COD order (₱)</Label>
            <Input
              id="cod-max"
              inputMode="decimal"
              value={value.cod.maxOrderAmount}
              onChange={(e) =>
                setValue((v) => ({ ...v, cod: { ...v.cod, maxOrderAmount: e.target.value } }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cod-failed">
              Failed COD deliveries before COD is refused (0: no limit)
            </Label>
            <Input
              id="cod-failed"
              type="number"
              min={0}
              max={20}
              value={value.cod.maxFailedDeliveries}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  cod: { ...v.cod, maxFailedDeliveries: Number(e.target.value) },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="return-days">Return window (days after delivery)</Label>
            <Input
              id="return-days"
              type="number"
              min={0}
              max={30}
              value={value.returns.windowDays}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  returns: { ...v.returns, windowDays: Number(e.target.value) },
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="return-response">Days sellers have to answer a return</Label>
            <Input
              id="return-response"
              type="number"
              min={1}
              max={14}
              value={value.returns.sellerResponseDays}
              onChange={(e) =>
                setValue((v) => ({
                  ...v,
                  returns: { ...v.returns, sellerResponseDays: Number(e.target.value) },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending}>
        Save settings
      </Button>
    </form>
  );
}

function ShipmentsTable() {
  const [status, setStatus] = useState<ShipmentStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const shipments = useAdminShipments({
    status: status === 'ALL' ? undefined : status,
    search: search.trim() || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  type Row = ShipmentDto & {
    sellerOrder: { id: string; number: string };
    seller: { businessName: string };
  };
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'tracking',
      header: 'Tracking',
      cell: (s) => (
        <div>
          <p className="font-mono">{s.trackingNumber}</p>
          <p className="text-xs text-muted-foreground">
            {s.carrier === 'SELF' ? s.carrierName : CARRIER_LABELS[s.carrier]}
          </p>
        </div>
      ),
    },
    {
      id: 'order',
      header: 'Seller order',
      cell: (s) => (
        <div>
          <Link to={`/seller-orders/${s.sellerOrder.id}`} className="font-mono hover:underline">
            {s.sellerOrder.number}
          </Link>
          <p className="text-xs text-muted-foreground">{s.seller.businessName}</p>
        </div>
      ),
    },
    {
      id: 'cod',
      header: 'COD',
      hideOnMobile: true,
      cell: (s) => (Number(s.codAmount) > 0 ? formatMoney(s.codAmount) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <span className="flex gap-1">
          <ShipmentStatusBadge status={s.status} />
          {s.test ? <TestModeBadge /> : null}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: (s) => (
        <div className="flex flex-wrap gap-2">
          <StaffShipmentButtons shipment={s} />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="search"
          className="sm:w-72"
          aria-label="Search shipments"
          placeholder="Tracking or order number"
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
              setStatus(v as ShipmentStatus);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Shipment status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {SHIPMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIPMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DataTable
        label="Shipments"
        columns={columns}
        rows={shipments.data?.items as Row[] | undefined}
        getRowId={(s) => s.id}
        isLoading={shipments.isPending}
        error={toDisplayError(shipments.error)}
        onRetry={() => void shipments.refetch()}
        empty={{ icon: TruckIcon, title: 'No shipments' }}
        pagination={
          shipments.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: shipments.data.totalItems,
                onPageChange: setPage,
                isFetching: shipments.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}

export function ShippingPage() {
  const can = useCan();
  const settings = usePlatformSettings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipping and order settings"
        description={`Couriers (${CARRIERS.length - 2} real couriers prepared, connected when their credentials and documentation are available), bank transfer, cash on delivery and returns.`}
      />
      <h2 className="text-lg font-semibold">Shipments</h2>
      <ShipmentsTable />
      {can('settings.manage') ? (
        settings.isPending ? (
          <LoadingState />
        ) : settings.data ? (
          <OrderSettingsForm
            key={JSON.stringify(settings.data.orders)}
            initial={settings.data.orders}
          />
        ) : (
          <ErrorState
            message="Could not load the settings."
            onRetry={() => void settings.refetch()}
          />
        )
      ) : null}
    </div>
  );
}

// ---- Disputes (returns) --------------------------------------------------------------------

export function DisputesPage() {
  const [status, setStatus] = useState<ReturnStatus | 'ALL'>('ESCALATED');
  const [page, setPage] = useState(1);
  const returns = useAdminReturns({
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
          <Link to={`/disputes/${r.id}`} className="font-mono font-medium hover:underline">
            {r.number}
          </Link>
          <p className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'parties',
      header: 'Customer / store',
      cell: (r) => (
        <span>
          {r.customerName}
          <span className="block text-xs text-muted-foreground">{r.store.name}</span>
        </span>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      hideOnMobile: true,
      cell: (r) => RETURN_REASON_LABELS[r.reason],
    },
    { id: 'amount', header: 'Items', hideOnMobile: true, cell: (r) => formatMoney(r.maxRefund) },
    { id: 'status', header: 'Status', cell: (r) => <ReturnStatusBadge status={r.status} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Returns and disputes"
        description="Escalated returns wait for a marketplace decision, oldest first."
      />
      <div className="sm:w-56">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as ReturnStatus);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Return status">
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
        empty={{ icon: RotateCcwIcon, title: 'Nothing to decide' }}
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

function Decide({ ret }: { ret: ReturnDto }) {
  const { run, pending } = useRun();
  const [resolution, setResolution] = useState<
    'FULL_REFUND' | 'PARTIAL_REFUND' | 'REPLACEMENT' | 'REJECTED'
  >('FULL_REFUND');
  const [amount, setAmount] = useState('');
  const [needsItem, setNeedsItem] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="decision">Decision</Label>
        <Select value={resolution} onValueChange={(v) => setResolution(v as 'REJECTED')}>
          <SelectTrigger id="decision">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'REJECTED'] as const).map((r) => (
              <SelectItem key={r} value={r}>
                {RETURN_RESOLUTION_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {resolution === 'PARTIAL_REFUND' || resolution === 'FULL_REFUND' ? (
        <div className="space-y-1">
          <Label htmlFor="decision-amount">
            Amount (₱)
            {resolution === 'FULL_REFUND'
              ? `, default ${formatMoney(ret.maxRefund)}; may include shipping`
              : ''}
          </Label>
          <Input
            id="decision-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      ) : null}
      {resolution !== 'REJECTED' ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={needsItem} onCheckedChange={(v) => setNeedsItem(v === true)} />
          The item must come back first
        </label>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="decision-note">Decision note (shown to the customer and the seller)</Label>
        <Textarea
          id="decision-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <Button
        disabled={
          pending || note.trim().length < 10 || (resolution === 'PARTIAL_REFUND' && !amount)
        }
        onClick={() =>
          quiet(
            run('Could not decide', 'Decision recorded', (f) =>
              f.admin.returns.decide(ret.id, {
                resolution,
                note: note.trim(),
                requiresReturnShipment: resolution === 'REJECTED' ? false : needsItem,
                ...(amount ? { refundAmount: Number(amount).toFixed(2) } : {}),
              }),
            ),
          )
        }
      >
        Record decision
      </Button>
    </div>
  );
}

export function DisputePage() {
  const { returnId } = useParams();
  const ret = useAdminReturn(returnId);
  const can = useCan();
  const { run, pending } = useRun();
  if (ret.isPending) return <LoadingState />;
  if (ret.isError)
    return (
      <ErrorState
        message={toDisplayError(ret.error)?.message ?? 'Could not load the return.'}
        onRetry={() => void ret.refetch()}
      />
    );
  const r = ret.data;
  const undecided = ['ESCALATED', 'REQUESTED', 'REJECTED'].includes(r.status);
  const waitingItem = ['APPROVED', 'RETURN_SHIPPED'].includes(r.status) && r.requiresReturnShipment;
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Returns and disputes', to: '/disputes' }, { label: r.number }]}
      />
      <PageHeader
        title={`Return ${r.number}`}
        description={
          <>
            {r.store.name} ·{' '}
            <Link to={`/seller-orders/${r.sellerOrderId}`} className="hover:underline">
              {r.sellerOrderNumber}
            </Link>{' '}
            · {r.customerName}
          </>
        }
      />
      <ReturnView
        ret={r}
        actions={
          can('disputes.manage') && (undecided || waitingItem) ? (
            <>
              {undecided ? <Decide ret={r} /> : null}
              {waitingItem ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    quiet(
                      run('Could not record', 'Item recorded as received', (f) =>
                        f.admin.returns.receive(r.id, true),
                      ),
                    )
                  }
                >
                  The seller received the item (restock)
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
