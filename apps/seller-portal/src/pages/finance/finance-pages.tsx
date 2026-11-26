import {
  hasPermission,
  toDisplayError,
  useFinanceAction,
  useSellerBankAccounts,
  useSellerDocument,
  useSellerDocuments,
  useSellerFinanceOverview,
  useSellerPayout,
  useSellerPayouts,
  useSellerSettlement,
  useSellerSettlements,
  useSellerTaxProfile,
  useSellerTransactions,
  useSession,
} from '@marketplace/api-client';
import { SELLER_DOCUMENT_LABELS, type SellerDocumentType } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  BalanceCards,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  FinanceDocumentView,
  formatMoney,
  Input,
  Label,
  LoadingState,
  PageHeader,
  PayoutStatusBadge,
  PayoutTimeline,
  periodLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettlementStatement,
  SubledgerTable,
  TestModeBadge,
  toast,
} from '@marketplace/ui';
import type {
  FinanceDocumentList,
  PayoutDto,
  SellerBankAccountDto,
  SettlementDto,
} from '@marketplace/validation';
import { FileTextIcon, LandmarkIcon, WalletIcon } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;
const manilaToday = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const monthStart = () => manilaToday().slice(0, 8) + '01';
const orderLink = (id: string, number: string) => (
  <Link to={`/orders/${id}`} className="font-mono hover:underline">
    {number}
  </Link>
);
const docLink = (id: string, label: string) => (
  <Link to={`/finance/documents/${id}`} className="hover:underline">
    {label}
  </Link>
);
const pageOf = (
  data: { totalItems: number } | undefined,
  page: number,
  setPage: (n: number) => void,
  fetching: boolean,
) =>
  data
    ? {
        page,
        pageSize: PAGE_SIZE,
        totalItems: data.totalItems,
        onPageChange: setPage,
        isFetching: fetching,
      }
    : undefined;

function useCan() {
  const session = useSession();
  return (p: Parameters<typeof hasPermission>[1]) => hasPermission(session.data, p);
}

function useRun() {
  const action = useFinanceAction();
  const run = (title: string, success: string, fn: Parameters<typeof action.mutateAsync>[0]) =>
    action
      .mutateAsync(fn)
      .then((r) => {
        toast.success(success);
        return r;
      })
      .catch((e: unknown) => {
        showError(title, e);
        throw e;
      });
  return { run, pending: action.isPending };
}

function Loading<T>({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState />;
  if (query.isError || !query.data)
    return (
      <ErrorState
        message={toDisplayError(query.error)?.message ?? 'Could not load this page.'}
        onRetry={() => void query.refetch()}
      />
    );
  return <>{children(query.data)}</>;
}

// ---- Overview ----------------------------------------------------------------------------------

/** Balances, this period's sales and deductions, and what is still needed for payouts. */
export function FinanceOverviewPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(manilaToday);
  const overview = useSellerFinanceOverview({ from, to });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Your earnings, deductions and payouts. Balances come from the marketplace ledger."
        actions={
          <Button asChild>
            <Link to="/finance/payouts">Request a payout</Link>
          </Button>
        }
      />
      <Loading query={overview}>
        {(o) => (
          <>
            {!o.bankAccountVerified || !o.taxProfileVerified ? (
              <Alert>
                <AlertTitle>Before your first payout</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {!o.taxProfileVerified ? (
                      <li>
                        Finance verifies your BIR registration (
                        <Link className="underline" to="/finance/tax">
                          tax profile
                        </Link>
                        ).
                      </li>
                    ) : null}
                    {!o.bankAccountVerified ? (
                      <li>
                        Add a bank or e-wallet account and wait for verification (
                        <Link className="underline" to="/finance/bank-accounts">
                          bank accounts
                        </Link>
                        ).
                      </li>
                    ) : null}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <BalanceCards balances={o.balances} />
            <p className="text-sm text-muted-foreground">
              The current settlement period (
              {periodLabel(o.nextSettlement.periodStart, o.nextSettlement.periodEnd)}) is settled
              after it closes. Orders become eligible once delivered and the return window has
              passed with no open return or dispute.
            </p>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales summary</CardTitle>
                <CardDescription>Recognised when the customer’s money is received.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="fin-from">From</Label>
                    <Input
                      id="fin-from"
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fin-to">To</Label>
                    <Input
                      id="fin-to"
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </div>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  <Fact label="Orders" value={String(o.summary.orders)} />
                  <Fact label="Sales" value={formatMoney(o.summary.grossSales)} />
                  <Fact label="Commission" value={formatMoney(o.summary.commission)} />
                  <Fact label="Payment and COD fees" value={formatMoney(o.summary.paymentFees)} />
                  <Fact label="Refunds" value={formatMoney(o.summary.refunds)} />
                  <Fact label="Shipping fees kept" value={formatMoney(o.summary.shippingCredits)} />
                  <Fact label="Net earnings" value={formatMoney(o.summary.netEarnings)} strong />
                </dl>
              </CardContent>
            </Card>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link className="underline" to="/finance/transactions">
                Transactions
              </Link>
              <Link className="underline" to="/finance/settlements">
                Settlement statements
              </Link>
              <Link className="underline" to="/finance/documents">
                Invoices from the marketplace
              </Link>
            </div>
          </>
        )}
      </Loading>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'text-lg font-semibold' : 'font-medium'}>{value}</dd>
    </div>
  );
}

// ---- Transactions --------------------------------------------------------------------------------

const ACCOUNTS = {
  ALL: 'All balances',
  PENDING: 'Pending',
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  IN_PAYOUT: 'In payout',
} as const;

export function TransactionsPage() {
  const [account, setAccount] = useState<keyof typeof ACCOUNTS>('ALL');
  const [page, setPage] = useState(1);
  const lines = useSellerTransactions({
    account: account === 'ALL' ? undefined : account,
    page,
    pageSize: PAGE_SIZE,
  });
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Transactions' }]} />
      <PageHeader
        title="Transactions"
        description="Every sale, deduction, settlement and payout that changed your balances."
      />
      <div className="sm:w-56">
        <Select
          value={account}
          onValueChange={(v) => {
            setAccount(v as keyof typeof ACCOUNTS);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Balance">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACCOUNTS).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Loading query={lines}>
        {(data) => (
          <Card>
            <CardContent className="pt-6">
              <SubledgerTable data={data} orderLink={orderLink} />
              {data.totalPages > 1 ? (
                <div className="mt-4 flex justify-between text-sm">
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <span>
                    Page {page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page >= data.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </Loading>
    </div>
  );
}

// ---- Settlements ---------------------------------------------------------------------------------

export function SettlementsPage() {
  const [page, setPage] = useState(1);
  const list = useSellerSettlements({ page, pageSize: PAGE_SIZE });
  const columns: DataTableColumn<SettlementDto>[] = [
    {
      id: 'period',
      header: 'Period',
      cell: (s) => (
        <Link to={`/finance/settlements/${s.id}`} className="font-medium hover:underline">
          {periodLabel(s.periodStart, s.periodEnd)}
          <span className="block font-mono text-xs text-muted-foreground">{s.reference}</span>
        </Link>
      ),
    },
    { id: 'orders', header: 'Orders', hideOnMobile: true, cell: (s) => s.ordersCount },
    {
      id: 'sales',
      header: 'Sales',
      hideOnMobile: true,
      cell: (s) => <span className="font-mono">{formatMoney(s.grossSales)}</span>,
    },
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
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Settlements' }]} />
      <PageHeader
        title="Settlement statements"
        description="Each settlement moves eligible orders from pending to your available balance."
      />
      <DataTable
        label="Settlements"
        columns={columns}
        rows={list.data?.items}
        getRowId={(s) => s.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{
          icon: WalletIcon,
          title: 'No settlements yet',
          description: 'Delivered orders are settled after the return window.',
        }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
    </div>
  );
}

export function SettlementPage() {
  const { settlementId } = useParams();
  const settlement = useSellerSettlement(settlementId);
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Settlements', to: '/finance/settlements' },
          { label: settlement.data?.reference ?? 'Statement' },
        ]}
      />
      <Loading query={settlement}>
        {(s) => (
          <>
            <PageHeader
              title={`Statement ${s.reference}`}
              description={periodLabel(s.periodStart, s.periodEnd)}
            />
            <SettlementStatement settlement={s} orderLink={orderLink} documentLink={docLink} />
          </>
        )}
      </Loading>
    </div>
  );
}

// ---- Documents -------------------------------------------------------------------------------------

export function DocumentsPage() {
  const [page, setPage] = useState(1);
  const list = useSellerDocuments({ page, pageSize: PAGE_SIZE });
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
    { id: 'date', header: 'Issued', hideOnMobile: true, cell: (d) => formatDateTime(d.issuedAt) },
    {
      id: 'vat',
      header: 'VAT',
      hideOnMobile: true,
      cell: (d) => <span className="font-mono">{formatMoney(d.taxAmount)}</span>,
    },
    {
      id: 'total',
      header: 'Total',
      cell: (d) => <span className="font-mono">{formatMoney(d.total)}</span>,
    },
  ];
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Invoices' }]} />
      <PageHeader
        title="Invoices from the marketplace"
        description="Service invoices for commission and fees, and credit notes for commission returned on refunds."
      />
      <DataTable
        label="Documents"
        columns={columns}
        rows={list.data?.items}
        getRowId={(d) => d.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{ icon: FileTextIcon, title: 'No invoices yet' }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
    </div>
  );
}

export function DocumentPage() {
  const { documentId } = useParams();
  const doc = useSellerDocument(documentId);
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Invoices', to: '/finance/documents' },
          { label: doc.data?.number ?? 'Document' },
        ]}
      />
      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <Loading query={doc}>{(d) => <FinanceDocumentView document={d} />}</Loading>
    </div>
  );
}

// ---- Bank accounts ----------------------------------------------------------------------------------

const BANK_STATUS: Record<
  SellerBankAccountDto['status'],
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }
> = {
  PENDING_VERIFICATION: { label: 'Being verified', variant: 'warning' },
  VERIFIED: { label: 'Verified', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  DISABLED: { label: 'Disabled', variant: 'outline' },
};

export function BankAccountsPage() {
  const accounts = useSellerBankAccounts();
  const can = useCan();
  const { run } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Bank accounts' }]} />
      <PageHeader
        title="Bank accounts"
        description="Where payouts go. Account numbers are stored encrypted; only the last four digits are shown."
        actions={
          can('seller.payouts.manage') ? (
            <Button onClick={() => setOpen(true)}>Add account</Button>
          ) : undefined
        }
      />
      <Loading query={accounts}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bank account yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.items.map((a) => (
                <Card key={a.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {a.institutionName}
                      <Badge variant={BANK_STATUS[a.status].variant}>
                        {BANK_STATUS[a.status].label}
                      </Badge>
                      {a.isDefault ? <Badge variant="outline">Default</Badge> : null}
                    </CardTitle>
                    <CardDescription>
                      {a.accountName} · <span className="font-mono">{a.accountNumberMasked}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {a.reviewNote ? <p className="text-muted-foreground">{a.reviewNote}</p> : null}
                    {a.status !== 'DISABLED' && can('seller.payouts.manage') ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="outline" size="sm">
                            Disable
                          </Button>
                        }
                        title="Disable this account?"
                        description="Payouts can no longer be sent to it. Add a new account to change details."
                        confirmLabel="Disable"
                        destructive
                        onConfirm={() =>
                          run('Could not disable the account', 'Account disabled', (f) =>
                            f.seller.disableBankAccount(a.id),
                          )
                        }
                      />
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        }
      </Loading>
      <AddBankAccountDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AddBankAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { run, pending } = useRun();
  const [values, setValues] = useState({
    institutionName: '',
    institutionCode: '',
    accountName: '',
    accountNumber: '',
  });
  const set = (k: keyof typeof values) => (e: ChangeEvent<HTMLInputElement>) =>
    setValues({ ...values, [k]: e.target.value });
  const submit = () =>
    run('Could not add the account', 'Account added; finance will verify it', (f) =>
      f.seller.addBankAccount({
        institutionName: values.institutionName,
        institutionCode: values.institutionCode.trim()
          ? values.institutionCode.trim().toUpperCase()
          : null,
        accountName: values.accountName,
        accountNumber: values.accountNumber.replace(/\s/g, ''),
        makeDefault: true,
      }),
    )
      .then(() => {
        onOpenChange(false);
        setValues({ institutionName: '', institutionCode: '', accountName: '', accountNumber: '' });
      })
      .catch(() => undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a bank or e-wallet account</DialogTitle>
          <DialogDescription>
            The account name must match your registered business or owner name.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="bank-name">Bank or e-wallet</Label>
            <Input
              id="bank-name"
              value={values.institutionName}
              onChange={set('institutionName')}
              placeholder="BDO Unibank"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bank-bic">BIC / SWIFT code (optional)</Label>
            <Input
              id="bank-bic"
              value={values.institutionCode}
              onChange={set('institutionCode')}
              placeholder="BNORPHMM"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bank-holder">Account name</Label>
            <Input id="bank-holder" value={values.accountName} onChange={set('accountName')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bank-number">Account number</Label>
            <Input
              id="bank-number"
              inputMode="numeric"
              autoComplete="off"
              value={values.accountNumber}
              onChange={set('accountNumber')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            Add account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Payouts -------------------------------------------------------------------------------------

export function PayoutsPage() {
  const [page, setPage] = useState(1);
  const list = useSellerPayouts({ page, pageSize: PAGE_SIZE });
  const overview = useSellerFinanceOverview({});
  const can = useCan();
  const [open, setOpen] = useState(false);
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
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Payouts' }]} />
      <PageHeader
        title="Payouts"
        description="Request your available balance; finance approves and transfers it."
        actions={
          can('seller.payouts.manage') ? (
            <Button
              onClick={() => setOpen(true)}
              disabled={!overview.data || Number(overview.data.balances.withdrawable) <= 0}
            >
              Request a payout
            </Button>
          ) : undefined
        }
      />
      {overview.data ? <BalanceCards balances={overview.data.balances} /> : null}
      <DataTable
        label="Payouts"
        columns={columns}
        rows={list.data?.items}
        getRowId={(p) => p.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        onRetry={() => void list.refetch()}
        empty={{ icon: LandmarkIcon, title: 'No payouts yet' }}
        pagination={pageOf(list.data, page, setPage, list.isFetching)}
      />
      {overview.data ? (
        <RequestPayoutDialog
          open={open}
          onOpenChange={setOpen}
          available={overview.data.balances.withdrawable}
          minimum={overview.data.balances.minimumPayout}
        />
      ) : null}
    </div>
  );
}

function RequestPayoutDialog({
  open,
  onOpenChange,
  available,
  minimum,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  available: string;
  minimum: string;
}) {
  const accounts = useSellerBankAccounts();
  const verified = accounts.data?.items.filter((a) => a.status === 'VERIFIED') ?? [];
  const { run, pending } = useRun();
  const [amount, setAmount] = useState(available);
  const [accountId, setAccountId] = useState<string>('');
  // One key per opened form: a double submit or retry creates one payout.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const chosen = accountId || verified.find((a) => a.isDefault)?.id || verified[0]?.id || '';
  const submit = () =>
    run('Could not request the payout', 'Payout requested', (f) =>
      f.seller.requestPayout({ amount, bankAccountId: chosen, idempotencyKey: key }),
    )
      .then(() => {
        onOpenChange(false);
        setKey(crypto.randomUUID());
      })
      .catch(() => undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a payout</DialogTitle>
          <DialogDescription>
            Available: {formatMoney(available)} · minimum {formatMoney(minimum)}.
          </DialogDescription>
        </DialogHeader>
        {verified.length === 0 ? (
          <p className="text-sm">
            You need a verified bank account.{' '}
            <Link className="underline" to="/finance/bank-accounts">
              Add one
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="payout-amount">Amount</Label>
              <Input
                id="payout-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="payout-account">Pay to</Label>
              <Select value={chosen} onValueChange={setAccountId}>
                <SelectTrigger id="payout-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {verified.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.institutionName} {a.accountNumberMasked}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || verified.length === 0}>
            Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutPage() {
  const { payoutId } = useParams();
  const payout = useSellerPayout(payoutId);
  const can = useCan();
  const { run } = useRun();
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Finance', to: '/finance' },
          { label: 'Payouts', to: '/finance/payouts' },
          { label: payout.data?.reference ?? 'Payout' },
        ]}
      />
      <Loading query={payout}>
        {(p) => (
          <>
            <PageHeader
              title={`Payout ${p.reference}`}
              description={`${formatMoney(p.amount)} to ${p.destination.institutionName} ${p.destination.accountNumberMasked}`}
              actions={
                p.status === 'REQUESTED' && can('seller.payouts.manage') ? (
                  <ConfirmDialog
                    trigger={<Button variant="outline">Cancel request</Button>}
                    title="Cancel this payout request?"
                    description="The amount goes back to your available balance."
                    confirmLabel="Cancel request"
                    destructive
                    onConfirm={() =>
                      run('Could not cancel', 'Payout cancelled', (f) =>
                        f.seller.cancelPayout(p.id),
                      )
                    }
                  />
                ) : undefined
              }
            />
            <div className="flex items-center gap-2">
              <PayoutStatusBadge status={p.status} />
              {p.failureReason ? (
                <span className="text-sm text-destructive">{p.failureReason}</span>
              ) : null}
            </div>
            {p.transferReference ? (
              <p className="text-sm">
                Transfer reference <span className="font-mono">{p.transferReference}</span>
              </p>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">History</CardTitle>
              </CardHeader>
              <CardContent>
                <PayoutTimeline payout={p} />
              </CardContent>
            </Card>
          </>
        )}
      </Loading>
    </div>
  );
}

// ---- Tax profile -----------------------------------------------------------------------------------

export function TaxProfilePage() {
  const profile = useSellerTaxProfile();
  const can = useCan();
  const { run, pending } = useRun();
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Finance', to: '/finance' }, { label: 'Tax profile' }]} />
      <PageHeader
        title="Tax profile"
        description="Your BIR registration. The marketplace withholds tax on remittances as the BIR requires unless an accepted sworn declaration exempts you."
      />
      <Loading query={profile}>
        {(t) => (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Registration
                  {t.verifiedAt ? (
                    <Badge variant="success">Verified</Badge>
                  ) : (
                    <Badge variant="warning">Not verified yet</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  TIN and VAT registration are edited in your business profile.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  TIN: <span className="font-mono">{t.tin ?? 'not provided'}</span>
                </p>
                <p>{t.vatRegistered ? 'VAT-registered' : 'Not VAT-registered'}</p>
                <div className="space-y-1">
                  <Label htmlFor="tax-name">
                    Registered name (as on the BIR Certificate of Registration)
                  </Label>
                  <Input
                    id="tax-name"
                    value={name ?? t.taxRegisteredName ?? ''}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!can('seller.profile.manage')}
                  />
                </div>
                {can('seller.profile.manage') ? (
                  <Button
                    disabled={pending || !(name ?? '').trim()}
                    onClick={() =>
                      void run('Could not save', 'Saved; finance will check it again', (f) =>
                        f.seller.updateTaxName((name ?? '').trim()),
                      ).catch(() => undefined)
                    }
                  >
                    Save
                  </Button>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Withholding and documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {t.withholdingExemptUntil
                    ? `Exempt from withholding until ${t.withholdingExemptUntil}.`
                    : 'Tax is withheld from your settlements (see each statement).'}
                </p>
                {t.withholdingExemptNote ? (
                  <p className="text-muted-foreground">{t.withholdingExemptNote}</p>
                ) : null}
                <p className="font-medium">Uploaded</p>
                {t.documents.length === 0 ? (
                  <p className="text-muted-foreground">
                    None. Upload your CoR (and any sworn declaration) in Verification.
                  </p>
                ) : null}
                <ul>
                  {t.documents.map((d) => (
                    <li key={d.id}>
                      {SELLER_DOCUMENT_LABELS[d.type as SellerDocumentType] ?? d.type}
                    </li>
                  ))}
                </ul>
                <Link className="underline" to="/verification">
                  Upload documents
                </Link>
              </CardContent>
            </Card>
          </div>
        )}
      </Loading>
    </div>
  );
}

// ---- Sales invoice on an order --------------------------------------------------------------------

/** The seller records its own sales invoice for an order (the seller is the seller of record). */
export function SalesInvoiceCard({
  orderId,
  invoice,
  editable,
}: {
  orderId: string;
  invoice: { number: string; date: string } | null;
  editable: boolean;
}) {
  const { run, pending } = useRun();
  const [number, setNumber] = useState(invoice?.number ?? '');
  const [date, setDate] = useState(invoice?.date ?? manilaToday());
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your sales invoice</CardTitle>
        <CardDescription>
          You issue the invoice to the customer; record its number here for your records and the
          marketplace’s.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="inv-number">Invoice number</Label>
          <Input
            id="inv-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={!editable}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-date">Date</Label>
          <Input
            id="inv-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!editable}
          />
        </div>
        {editable ? (
          <Button
            disabled={pending || !number.trim()}
            onClick={() =>
              void run('Could not save the invoice', 'Invoice recorded', (f) =>
                f.seller.setSalesInvoice(orderId, {
                  sellerInvoiceNumber: number.trim(),
                  sellerInvoiceDate: date,
                }),
              ).catch(() => undefined)
            }
          >
            Save
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
