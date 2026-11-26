import {
  toDisplayError,
  useAdminBankAccounts,
  useAdminDocument,
  useAdminDocuments,
  useAdminPayout,
  useAdminPayouts,
  useAdminSellerBalance,
  useAdminSettlement,
  useAdminSettlements,
  useAdminSubledger,
  useFinanceDashboard,
  useFinanceSettings,
  useSellerBalances,
  useSettlementPreview,
} from '@marketplace/api-client';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from '@marketplace/shared-types';
import {
  Badge,
  BalanceCards,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  FinanceDocumentView,
  formatMoney,
  Input,
  Label,
  PAYOUT_STATUS_LABELS,
  PageHeader,
  PayoutStatusBadge,
  PayoutTimeline,
  periodLabel,
  PromptDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettlementStatement,
  SubledgerTable,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TestModeBadge,
} from '@marketplace/ui';
import {
  type FeeBearer,
  type FinanceDocumentList,
  type FinanceSettings,
  PAYOUT_STATUSES,
  type PayoutDto,
  type PayoutStatus,
  type SellerBalanceList,
  type SellerBankAccountDto,
  SETTLEMENT_FREQUENCIES,
  type SettlementDto,
} from '@marketplace/validation';
import { CalendarCheckIcon, FileTextIcon, LandmarkIcon, WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatDateTime } from '../../lib/format';
import { Loaded, Pager, PeriodPicker } from './finance-common';
import {
  documentLink,
  monthStart,
  manilaToday,
  orderLink,
  PAGE_SIZE,
  pageOf,
  useCan,
  useFinanceRun,
} from './finance-utils';

// ---- Dashboard -------------------------------------------------------------------------------------

function Tile({
  label,
  value,
  to,
  hint,
}: {
  label: string;
  value: string;
  to?: string;
  hint?: string;
}) {
  const body = (
    <div className="rounded-lg border p-4 transition-colors hover:bg-muted/40">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

/** Financial dashboard: revenue, payables, cash, taxes and work queues. */
export function FinanceDashboardPage() {
  const [range, setRange] = useState({ from: monthStart(), to: manilaToday() });
  const dashboard = useFinanceDashboard(range.from, range.to);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Marketplace revenue, what is owed to sellers, cash and taxes, all from the double-entry ledger."
      />
      <PeriodPicker
        from={range.from}
        to={range.to}
        onChange={(from, to) => setRange({ from, to })}
        idPrefix="dash"
      />
      <Loaded query={dashboard}>
        {(d) => (
          <>
            {!d.reconciliationOk ? (
              <Card className="border-destructive">
                <CardContent className="pt-6 text-sm">
                  A reconciliation check failed.{' '}
                  <Link className="underline" to="/finance/reports?tab=checks">
                    See the checks
                  </Link>
                  .
                </CardContent>
              </Card>
            ) : null}
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">This period</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Tile label="Seller sales (GMV)" value={formatMoney(d.grossMerchandiseValue)} />
                <Tile
                  label="Commission revenue"
                  value={formatMoney(d.commissionRevenue)}
                  hint="Net of VAT"
                  to="/finance/reports?tab=commission"
                />
                <Tile
                  label="Fee recoveries"
                  value={formatMoney(d.feeRecoveries)}
                  hint="Net of VAT"
                />
                <Tile label="Payment fees" value={formatMoney(d.paymentFees)} />
                <Tile
                  label="Refunds (marketplace share)"
                  value={formatMoney(d.refunds)}
                  to="/finance/reports?tab=refunds"
                />
              </div>
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">Owed to sellers now</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Tile
                  label="Pending"
                  value={formatMoney(d.sellerPayables.pending)}
                  to="/finance/balances"
                />
                <Tile
                  label="Available"
                  value={formatMoney(d.sellerPayables.available)}
                  to="/finance/balances"
                />
                <Tile label="Reserved" value={formatMoney(d.sellerPayables.reserved)} />
                <Tile
                  label="In payout"
                  value={formatMoney(d.sellerPayables.inPayout)}
                  to="/finance/payouts"
                />
                <Tile label="Paid out (all time)" value={formatMoney(d.sellerPayables.paid)} />
              </div>
            </section>
            <section className="grid gap-3 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cash and taxes</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    Bank{' '}
                    <span className="block font-mono text-base">{formatMoney(d.cash.bank)}</span>
                  </p>
                  <p>
                    Payment provider{' '}
                    <span className="block font-mono text-base">
                      {formatMoney(d.cash.provider)}
                    </span>
                  </p>
                  <p>
                    COD with couriers{' '}
                    <span className="block font-mono text-base">
                      {formatMoney(d.cash.codReceivable)}
                    </span>
                  </p>
                  <p>
                    Output VAT payable{' '}
                    <span className="block font-mono text-base">
                      {formatMoney(d.taxes.outputVat)}
                    </span>
                  </p>
                  <p>
                    Withholding tax payable{' '}
                    <span className="block font-mono text-base">
                      {formatMoney(d.taxes.withholding)}
                    </span>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">To do</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    <li>
                      <Link className="underline" to="/finance/payouts?status=REQUESTED">
                        {d.queues.payoutsToApprove} payout(s) to approve
                      </Link>
                    </li>
                    <li>
                      <Link className="underline" to="/finance/payouts?status=APPROVED">
                        {d.queues.payoutsToPay} payout(s) to pay
                      </Link>
                    </li>
                    <li>
                      <Link className="underline" to="/finance/payouts?tab=bank-accounts">
                        {d.queues.bankAccountsToVerify} bank account(s) to verify
                      </Link>
                    </li>
                    <li>
                      <Link className="underline" to="/finance/taxes?tab=sellers">
                        {d.queues.taxProfilesToVerify} seller tax profile(s) to verify
                      </Link>
                    </li>
                    <li>
                      <Link className="underline" to="/finance/settlements">
                        {d.queues.eligibleOrders} order(s) eligible for settlement
                      </Link>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </Loaded>
    </div>
  );
}

// ---- Seller balances ---------------------------------------------------------------------------

export function SellerBalancesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [negativeOnly, setNegativeOnly] = useState(false);
  const list = useSellerBalances({
    page,
    pageSize: PAGE_SIZE,
    q: q.trim() || undefined,
    negativeOnly: negativeOnly || undefined,
  });
  type Row = SellerBalanceList['items'][number];
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'seller',
      header: 'Seller',
      cell: (r) => (
        <Link to={`/finance/balances/${r.seller.id}`} className="font-medium hover:underline">
          {r.seller.name}
        </Link>
      ),
    },
    {
      id: 'pending',
      header: 'Pending',
      hideOnMobile: true,
      cell: (r) => <span className="font-mono">{formatMoney(r.pending)}</span>,
    },
    {
      id: 'available',
      header: 'Available',
      cell: (r) => (
        <span className={`font-mono ${Number(r.available) < 0 ? 'text-destructive' : ''}`}>
          {formatMoney(r.available)}
        </span>
      ),
    },
    {
      id: 'reserved',
      header: 'Reserved',
      hideOnMobile: true,
      cell: (r) => <span className="font-mono">{formatMoney(r.reserved)}</span>,
    },
    {
      id: 'payout',
      header: 'In payout',
      hideOnMobile: true,
      cell: (r) => <span className="font-mono">{formatMoney(r.inPayout)}</span>,
    },
    {
      id: 'paid',
      header: 'Paid',
      hideOnMobile: true,
      cell: (r) => <span className="font-mono">{formatMoney(r.paid)}</span>,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Seller balances"
        description="Derived from the ledger: never edited by hand. Open a seller for its statement of account."
      />
      {list.data ? (
        <p className="text-sm text-muted-foreground">
          Totals: pending {formatMoney(list.data.totals.pending)} · available{' '}
          {formatMoney(list.data.totals.available)} · reserved{' '}
          {formatMoney(list.data.totals.reserved)} · in payout{' '}
          {formatMoney(list.data.totals.inPayout)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="sm:w-64"
          placeholder="Search sellers"
          aria-label="Search sellers"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={negativeOnly}
            onCheckedChange={(v) => {
              setNegativeOnly(v === true);
              setPage(1);
            }}
          />{' '}
          Owing the marketplace only
        </label>
      </div>
      <DataTable
        label="Seller balances"
        columns={columns}
        rows={list.data?.items}
        getRowId={(r) => r.seller.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{ icon: WalletIcon, title: 'No seller balances yet' }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
    </div>
  );
}

export function SellerFinancePage() {
  const { sellerId } = useParams();
  const balances = useAdminSellerBalance(sellerId);
  const [page, setPage] = useState(1);
  const lines = useAdminSubledger(sellerId, { page, pageSize: PAGE_SIZE });
  const settlements = useAdminSettlements({ sellerId, page: 1, pageSize: 10 });
  const can = useCan();
  const { run } = useFinanceRun();
  const [amount, setAmount] = useState('');
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Seller balances', to: '/finance/balances' },
          { label: 'Seller' },
        ]}
      />
      <PageHeader
        title="Seller finance"
        description={
          <Link className="underline" to={`/sellers/${sellerId}`}>
            Seller profile
          </Link>
        }
        actions={
          can('settlements.manage') ? (
            <>
              <PromptDialog
                trigger={<Button variant="outline">Place reserve</Button>}
                title="Reserve part of the available balance"
                label="Reason"
                confirmLabel="Place reserve"
                onSubmit={(reason) =>
                  run('Could not place the reserve', 'Reserve placed', (f) =>
                    f.admin.balances.reserve(sellerId!, { action: 'PLACE', amount, reason }),
                  )
                }
              >
                <div className="space-y-1">
                  <Label htmlFor="reserve-amount">Amount</Label>
                  <Input
                    id="reserve-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </PromptDialog>
              <PromptDialog
                trigger={<Button variant="outline">Release reserve</Button>}
                title="Release reserved money"
                label="Reason"
                confirmLabel="Release"
                onSubmit={(reason) =>
                  run('Could not release the reserve', 'Reserve released', (f) =>
                    f.admin.balances.reserve(sellerId!, { action: 'RELEASE', amount, reason }),
                  )
                }
              >
                <div className="space-y-1">
                  <Label htmlFor="release-amount">Amount</Label>
                  <Input
                    id="release-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </PromptDialog>
            </>
          ) : undefined
        }
      />
      <Loaded query={balances}>{(b) => <BalanceCards balances={b} />}</Loaded>
      {settlements.data && settlements.data.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent settlements</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {settlements.data.items.map((s) => (
                <li key={s.id}>
                  <Link className="hover:underline" to={`/finance/settlements/${s.id}`}>
                    {periodLabel(s.periodStart, s.periodEnd)} · {s.reference}
                  </Link>{' '}
                  · net {formatMoney(s.netSettled)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Statement of account</CardTitle>
        </CardHeader>
        <CardContent>
          <Loaded query={lines}>
            {(data) => (
              <>
                <SubledgerTable data={data} orderLink={orderLink} />
                <Pager page={page} totalPages={data.totalPages} onChange={setPage} />
              </>
            )}
          </Loaded>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Settlements -------------------------------------------------------------------------------------

export function SettlementsAdminPage() {
  const [page, setPage] = useState(1);
  const list = useAdminSettlements({ page, pageSize: PAGE_SIZE });
  const preview = useSettlementPreview();
  const can = useCan();
  const { run } = useFinanceRun();
  const columns: DataTableColumn<SettlementDto>[] = [
    {
      id: 'ref',
      header: 'Settlement',
      cell: (s) => (
        <Link to={`/finance/settlements/${s.id}`} className="font-medium hover:underline">
          {s.seller.name}
          <span className="block font-mono text-xs text-muted-foreground">{s.reference}</span>
        </Link>
      ),
    },
    {
      id: 'period',
      header: 'Period',
      hideOnMobile: true,
      cell: (s) => periodLabel(s.periodStart, s.periodEnd),
    },
    { id: 'orders', header: 'Orders', hideOnMobile: true, cell: (s) => s.ordersCount },
    {
      id: 'commission',
      header: 'Commission',
      hideOnMobile: true,
      cell: (s) => <span className="font-mono">{formatMoney(s.commission)}</span>,
    },
    {
      id: 'wht',
      header: 'Withholding',
      hideOnMobile: true,
      cell: (s) => <span className="font-mono">{formatMoney(s.withholdingTax)}</span>,
    },
    {
      id: 'net',
      header: 'Net settled',
      cell: (s) => <span className="font-mono">{formatMoney(s.netSettled)}</span>,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="The worker settles each closed period automatically (weekly by default). Orders are eligible once delivered and the return window has passed with no open return, dispute or refund."
        actions={
          can('settlements.manage') ? (
            <ConfirmDialog
              trigger={<Button>Settle last period now</Button>}
              title="Settle the last closed period?"
              description={
                preview.data
                  ? `${periodLabel(preview.data.periodStart, preview.data.periodEnd)}: ${preview.data.sellers.length} seller(s) with eligible orders. Each order is settled once.`
                  : 'Each order is settled once.'
              }
              confirmLabel="Settle"
              onConfirm={() =>
                run('Could not settle', 'Settlement done', (f) => f.admin.settlements.run({}))
              }
            />
          ) : undefined
        }
      />
      {preview.data && preview.data.sellers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for settlement</CardTitle>
            <CardDescription>
              {periodLabel(preview.data.periodStart, preview.data.periodEnd)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm">
              {preview.data.sellers.map((s) => (
                <li key={s.sellerId}>
                  {s.name}: {s.orders} order(s)
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <DataTable
        label="Settlements"
        columns={columns}
        rows={list.data?.items}
        getRowId={(s) => s.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{ icon: CalendarCheckIcon, title: 'No settlements yet' }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
    </div>
  );
}

export function SettlementAdminPage() {
  const { settlementId } = useParams();
  const settlement = useAdminSettlement(settlementId);
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Settlements', to: '/finance/settlements' },
          { label: settlement.data?.reference ?? 'Settlement' },
        ]}
      />
      <Loaded query={settlement}>
        {(s) => (
          <>
            <PageHeader
              title={`Settlement ${s.reference}`}
              description={
                <>
                  <Link className="underline" to={`/finance/balances/${s.seller.id}`}>
                    {s.seller.name}
                  </Link>{' '}
                  ·{' '}
                  {s.journal ? (
                    <Link className="underline" to={`/finance/journals/${s.journal.id}`}>
                      journal {s.journal.reference}
                    </Link>
                  ) : (
                    'no journal (nothing to move)'
                  )}
                </>
              }
            />
            <SettlementStatement settlement={s} orderLink={orderLink} documentLink={documentLink} />
          </>
        )}
      </Loaded>
    </div>
  );
}

// ---- Documents --------------------------------------------------------------------------------------

export function DocumentsAdminPage() {
  const [page, setPage] = useState(1);
  const list = useAdminDocuments({ page, pageSize: PAGE_SIZE });
  const columns: DataTableColumn<FinanceDocumentList['items'][number]>[] = [
    {
      id: 'number',
      header: 'Document',
      cell: (d) => (
        <Link to={`/finance/documents/${d.id}`} className="font-mono font-medium hover:underline">
          {d.number}
          <span className="block font-sans text-xs text-muted-foreground">
            {d.type === 'SERVICE_INVOICE' ? 'Service invoice' : 'Credit note'}
          </span>
        </Link>
      ),
    },
    { id: 'seller', header: 'Seller', cell: (d) => d.seller.name },
    { id: 'date', header: 'Issued', hideOnMobile: true, cell: (d) => formatDateTime(d.issuedAt) },
    {
      id: 'total',
      header: 'Total',
      cell: (d) => <span className="font-mono">{formatMoney(d.total)}</span>,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Service invoices and credit notes"
        description="Issued to sellers at settlement from the commission and fee lines of the ledger; numbered without gaps."
      />
      <DataTable
        label="Documents"
        columns={columns}
        rows={list.data?.items}
        getRowId={(d) => d.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{ icon: FileTextIcon, title: 'No documents yet' }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
    </div>
  );
}

export function DocumentAdminPage() {
  const { documentId } = useParams();
  const doc = useAdminDocument(documentId);
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Documents', to: '/finance/documents' },
          { label: doc.data?.number ?? 'Document' },
        ]}
      />
      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <Loaded query={doc}>{(d) => <FinanceDocumentView document={d} />}</Loaded>
    </div>
  );
}

// ---- Payouts --------------------------------------------------------------------------------------

export function PayoutsAdminPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(
    params.get('tab') === 'bank-accounts' ? 'bank-accounts' : 'payouts',
  );
  const [status, setStatus] = useState<PayoutStatus | 'ALL'>(
    (params.get('status') as PayoutStatus | null) ?? 'ALL',
  );
  const [page, setPage] = useState(1);
  const list = useAdminPayouts({
    status: status === 'ALL' ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  });
  const columns: DataTableColumn<PayoutDto>[] = [
    {
      id: 'ref',
      header: 'Payout',
      cell: (p) => (
        <Link to={`/finance/payouts/${p.id}`} className="font-mono font-medium hover:underline">
          {p.reference}
          <span className="block font-sans text-xs text-muted-foreground">
            {formatDateTime(p.requestedAt)}
          </span>
        </Link>
      ),
    },
    { id: 'seller', header: 'Seller', cell: (p) => p.seller.name },
    {
      id: 'to',
      header: 'To',
      hideOnMobile: true,
      cell: (p) => `${p.destination.institutionName} ${p.destination.accountNumberMasked}`,
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
        <span className="flex items-center gap-1">
          <PayoutStatusBadge status={p.status} />
          {p.method === 'PAYMONGO' && !p.livemode ? <TestModeBadge /> : null}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description="Seller payout requests: verify, approve, pay (bank transfer with reference, or PayMongo when set up), and handle failures."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="bank-accounts">Bank accounts to verify</TabsTrigger>
        </TabsList>
        <TabsContent value="payouts" className="space-y-4">
          <div className="sm:w-56">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as PayoutStatus);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Payout status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All payouts</SelectItem>
                {PAYOUT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PAYOUT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DataTable
            label="Payouts"
            columns={columns}
            rows={list.data?.items}
            getRowId={(p) => p.id}
            isLoading={list.isPending}
            error={toDisplayError(list.error)}
            onRetry={() => void list.refetch()}
            empty={{ icon: LandmarkIcon, title: 'No payouts' }}
            pagination={pageOf(list.data, page, setPage, list.isFetching)}
          />
        </TabsContent>
        <TabsContent value="bank-accounts">
          <BankAccountsToVerify />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BankAccountsToVerify() {
  const accounts = useAdminBankAccounts({ status: 'PENDING_VERIFICATION' });
  const can = useCan();
  const { run } = useFinanceRun();
  const review = (a: SellerBankAccountDto, decision: 'VERIFY' | 'REJECT', note?: string) =>
    run(
      'Could not review the account',
      decision === 'VERIFY' ? 'Account verified' : 'Account rejected',
      (f) => f.admin.bankAccounts.review(a.id, { decision, note: note ?? null }),
    );
  return (
    <Loaded query={accounts}>
      {(data) =>
        data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bank accounts waiting for verification.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.items.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <span>
                  <span className="font-medium">{a.seller.name}</span> · {a.institutionName}
                  {a.institutionCode ? ` (${a.institutionCode})` : ''} · {a.accountName} ·{' '}
                  <span className="font-mono">{a.accountNumberMasked}</span>
                  <span className="block text-xs text-muted-foreground">
                    Added {formatDateTime(a.createdAt)}. Check the bank document or a test transfer
                    before verifying.
                  </span>
                </span>
                {can('payouts.approve') ? (
                  <span className="flex gap-2">
                    <ConfirmDialog
                      trigger={<Button size="sm">Verify</Button>}
                      title="Verify this bank account?"
                      description="Payouts can then be sent to it."
                      confirmLabel="Verify"
                      onConfirm={() => review(a, 'VERIFY')}
                    />
                    <PromptDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          Reject
                        </Button>
                      }
                      title="Reject this bank account"
                      label="Reason (shown to the seller)"
                      confirmLabel="Reject"
                      destructive
                      onSubmit={(note) => review(a, 'REJECT', note)}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      }
    </Loaded>
  );
}

export function PayoutAdminPage() {
  const { payoutId } = useParams();
  const payout = useAdminPayout(payoutId);
  const can = useCan();
  const { run } = useFinanceRun();
  const [reference, setReference] = useState('');
  const [fee, setFee] = useState('0.00');
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Payouts', to: '/finance/payouts' },
          { label: payout.data?.reference ?? 'Payout' },
        ]}
      />
      <Loaded query={payout}>
        {(p) => {
          const has = (a: (typeof p.actions)[number]) => p.actions.includes(a);
          return (
            <>
              <PageHeader
                title={`Payout ${p.reference}`}
                description={
                  <>
                    <Link className="underline" to={`/finance/balances/${p.seller.id}`}>
                      {p.seller.name}
                    </Link>{' '}
                    · {formatMoney(p.amount)} to {p.destination.institutionName}{' '}
                    {p.destination.institutionCode ? `(${p.destination.institutionCode}) ` : ''}
                    {p.destination.accountName} {p.destination.accountNumberMasked}
                  </>
                }
                actions={
                  <>
                    {has('APPROVE') && can('payouts.approve') ? (
                      <ConfirmDialog
                        trigger={<Button>Approve</Button>}
                        title="Approve this payout?"
                        description="Check the seller’s balance and bank account first. The requester cannot approve their own payout."
                        confirmLabel="Approve"
                        onConfirm={() =>
                          run('Could not approve', 'Payout approved', (f) =>
                            f.admin.payouts.approve(p.id),
                          )
                        }
                      />
                    ) : null}
                    {has('REJECT') && can('payouts.approve') ? (
                      <PromptDialog
                        trigger={<Button variant="outline">Reject</Button>}
                        title="Reject this payout"
                        label="Reason (shown to the seller)"
                        confirmLabel="Reject"
                        destructive
                        onSubmit={(reason) =>
                          run('Could not reject', 'Payout rejected', (f) =>
                            f.admin.payouts.reject(p.id, reason),
                          )
                        }
                      />
                    ) : null}
                    {has('SEND') && can('payouts.process') ? (
                      <ConfirmDialog
                        trigger={<Button variant="outline">Send via PayMongo</Button>}
                        title="Send through PayMongo?"
                        description="An InstaPay transfer is created from the marketplace wallet."
                        confirmLabel="Send"
                        onConfirm={() =>
                          run('Could not send', 'Sent to PayMongo', (f) =>
                            f.admin.payouts.send(p.id),
                          )
                        }
                      />
                    ) : null}
                    {has('CHECK') && can('payouts.process') ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void run('Could not check', 'Status updated', (f) =>
                            f.admin.payouts.check(p.id),
                          ).catch(() => undefined)
                        }
                      >
                        Check status
                      </Button>
                    ) : null}
                    {has('MARK_PAID') && can('payouts.process') ? (
                      <PromptDialog
                        trigger={<Button>Record payment</Button>}
                        title="Record the bank transfer"
                        description="Enter the bank’s transfer reference once the money has left the marketplace account."
                        label="Note (optional)"
                        minLength={0}
                        confirmLabel="Record payment"
                        onSubmit={() =>
                          run('Could not record the payment', 'Payout recorded as paid', (f) =>
                            f.admin.payouts.markPaid(p.id, {
                              transferReference: reference,
                              transferFee: fee || '0',
                            }),
                          )
                        }
                      >
                        <div className="grid gap-3">
                          <div className="space-y-1">
                            <Label htmlFor="po-ref">Transfer reference</Label>
                            <Input
                              id="po-ref"
                              value={reference}
                              onChange={(e) => setReference(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="po-fee">Transfer fee paid by the marketplace</Label>
                            <Input
                              id="po-fee"
                              inputMode="decimal"
                              value={fee}
                              onChange={(e) => setFee(e.target.value)}
                            />
                          </div>
                        </div>
                      </PromptDialog>
                    ) : null}
                    {has('MARK_FAILED') && can('payouts.process') ? (
                      <PromptDialog
                        trigger={<Button variant="outline">Mark failed</Button>}
                        title="The transfer failed"
                        label="What happened"
                        confirmLabel="Mark failed"
                        destructive
                        onSubmit={(reason) =>
                          run(
                            'Could not update',
                            'Payout marked failed; amount returned to available',
                            (f) => f.admin.payouts.markFailed(p.id, reason),
                          )
                        }
                      />
                    ) : null}
                    {has('REVERSE') && can('payouts.process') ? (
                      <PromptDialog
                        trigger={<Button variant="outline">Reverse</Button>}
                        title="Reverse a paid payout"
                        description="Use when the bank returned the money or the payment was recorded in error. The amount returns to the seller’s available balance."
                        label="Reason"
                        confirmLabel="Reverse"
                        destructive
                        onSubmit={(reason) =>
                          run('Could not reverse', 'Payout reversed', (f) =>
                            f.admin.payouts.reverse(p.id, reason),
                          )
                        }
                      />
                    ) : null}
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <PayoutStatusBadge status={p.status} />
                <Badge variant="outline">
                  {p.method === 'PAYMONGO' ? 'PayMongo' : 'Manual bank transfer'}
                </Badge>
                {p.method === 'PAYMONGO' && !p.livemode ? <TestModeBadge /> : null}
                {p.transferReference ? (
                  <span>
                    Reference <span className="font-mono">{p.transferReference}</span>
                  </span>
                ) : null}
                {Number(p.transferFee) > 0 ? <span>Fee {formatMoney(p.transferFee)}</span> : null}
                {p.failureReason ? (
                  <span className="text-destructive">{p.failureReason}</span>
                ) : null}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Approval and processing log</CardTitle>
                </CardHeader>
                <CardContent>
                  <PayoutTimeline payout={p} />
                </CardContent>
              </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

// ---- Finance settings --------------------------------------------------------------------------------

const BEARER_LABELS: Record<FeeBearer, string> = {
  SELLER: 'Seller (deducted at settlement)',
  MARKETPLACE: 'Marketplace absorbs',
};
const FREQUENCY_LABELS = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  MONTHLY: 'Monthly',
} as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function FinanceSettingsPage() {
  const settings = useFinanceSettings();
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Settings' }]} />
      <PageHeader
        title="Finance settings"
        description="Fees and who bears them, the settlement schedule, payouts and the details on service invoices. Changes apply to new postings only."
      />
      <Loaded query={settings}>
        {(s) => {
          const { payMongoPayoutsConfigured, ...value } = s;
          return (
            <FinanceSettingsForm initial={value} payMongoConfigured={payMongoPayoutsConfigured} />
          );
        }}
      </Loaded>
    </div>
  );
}

function FinanceSettingsForm({
  initial,
  payMongoConfigured,
}: {
  initial: FinanceSettings;
  payMongoConfigured: boolean;
}) {
  const [v, setV] = useState<FinanceSettings>(initial);
  const can = useCan();
  const { run, pending } = useFinanceRun();
  const editable = can('finance.manage');
  const setFee = (m: PaymentMethod, field: 'percent' | 'fixed', value: string) =>
    setV({
      ...v,
      fees: {
        ...v.fees,
        methods: { ...v.fees.methods, [m]: { ...v.fees.methods[m], [field]: value } },
      },
    });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment fees</CardTitle>
          <CardDescription>
            Enter your provider’s and couriers’ contracted rates. The fee is allocated to each
            seller order in proportion to its share of the payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {(['ONLINE', 'BANK_TRANSFER', 'COD'] as const).map((channel) => (
              <div key={channel} className="space-y-1">
                <Label htmlFor={`bearer-${channel}`}>
                  {
                    {
                      ONLINE: 'Online payments',
                      BANK_TRANSFER: 'Bank transfers',
                      COD: 'Cash on delivery',
                    }[channel]
                  }
                  : who pays
                </Label>
                <Select
                  disabled={!editable}
                  value={v.fees.bearer[channel]}
                  onValueChange={(b) =>
                    setV({
                      ...v,
                      fees: { ...v.fees, bearer: { ...v.fees.bearer, [channel]: b as FeeBearer } },
                    })
                  }
                >
                  <SelectTrigger id={`bearer-${channel}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['SELLER', 'MARKETPLACE'] as const).map((b) => (
                      <SelectItem key={b} value={b}>
                        {BEARER_LABELS[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="grid gap-2">
            {PAYMENT_METHODS.map((m) => (
              <div key={m} className="grid grid-cols-[10rem_1fr_1fr] items-center gap-2 text-sm">
                <span>{PAYMENT_METHOD_LABELS[m]}</span>
                <Input
                  aria-label={`${PAYMENT_METHOD_LABELS[m]} fee %`}
                  disabled={!editable}
                  inputMode="decimal"
                  value={v.fees.methods[m].percent}
                  onChange={(e) => setFee(m, 'percent', e.target.value)}
                  placeholder="%"
                />
                <Input
                  aria-label={`${PAYMENT_METHOD_LABELS[m]} fixed fee`}
                  disabled={!editable}
                  inputMode="decimal"
                  value={v.fees.methods[m].fixed}
                  onChange={(e) => setFee(m, 'fixed', e.target.value)}
                  placeholder="₱ fixed"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settlement and payouts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="set-frequency">Schedule</Label>
            <Select
              disabled={!editable}
              value={v.settlement.frequency}
              onValueChange={(f) =>
                setV({
                  ...v,
                  settlement: {
                    ...v.settlement,
                    frequency: f as FinanceSettings['settlement']['frequency'],
                  },
                })
              }
            >
              <SelectTrigger id="set-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SETTLEMENT_FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="set-start">Periods start on</Label>
            <Select
              disabled={!editable}
              value={String(v.settlement.weekStartsOn)}
              onValueChange={(d) =>
                setV({ ...v, settlement: { ...v.settlement, weekStartsOn: Number(d) } })
              }
            >
              <SelectTrigger id="set-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="set-hold">Extra hold after the return window (days)</Label>
            <Input
              id="set-hold"
              disabled={!editable}
              inputMode="numeric"
              value={String(v.settlement.holdDays)}
              onChange={(e) =>
                setV({
                  ...v,
                  settlement: { ...v.settlement, holdDays: Number(e.target.value) || 0 },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="set-min">Minimum payout (₱)</Label>
            <Input
              id="set-min"
              disabled={!editable}
              inputMode="decimal"
              value={v.payouts.minimumAmount}
              onChange={(e) =>
                setV({ ...v, payouts: { ...v.payouts, minimumAmount: e.target.value } })
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              disabled={!editable || !payMongoConfigured}
              checked={v.payouts.payMongoEnabled}
              onCheckedChange={(c) =>
                setV({ ...v, payouts: { ...v.payouts, payMongoEnabled: c === true } })
              }
            />
            Allow sending payouts through PayMongo{' '}
            {payMongoConfigured ? '' : '(not set up: PAYMONGO_WALLET_ACCOUNT_NUMBER)'}
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice issuer</CardTitle>
          <CardDescription>
            The marketplace operator as shown on service invoices and credit notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="iss-name">Registered name</Label>
            <Input
              id="iss-name"
              disabled={!editable}
              value={v.issuer.legalName}
              onChange={(e) => setV({ ...v, issuer: { ...v.issuer, legalName: e.target.value } })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="iss-tin">TIN</Label>
            <Input
              id="iss-tin"
              disabled={!editable}
              value={v.issuer.tin ?? ''}
              onChange={(e) =>
                setV({ ...v, issuer: { ...v.issuer, tin: e.target.value.trim() || null } })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="iss-address">Registered address</Label>
            <Input
              id="iss-address"
              disabled={!editable}
              value={v.issuer.address ?? ''}
              onChange={(e) =>
                setV({ ...v, issuer: { ...v.issuer, address: e.target.value.trim() || null } })
              }
            />
          </div>
        </CardContent>
      </Card>
      {editable ? (
        <Button
          disabled={pending}
          onClick={() =>
            void run('Could not save', 'Finance settings saved', (f) =>
              f.admin.saveSettings(v),
            ).catch(() => undefined)
          }
        >
          Save changes
        </Button>
      ) : null}
    </div>
  );
}
