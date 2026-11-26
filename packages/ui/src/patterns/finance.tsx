import { ledgerKindLabel } from '@marketplace/shared-types';
import type {
  FinanceDocumentDto,
  PayoutDetail,
  PayoutStatus,
  SellerBalancesDto,
  SettlementDetail,
  Subledger,
} from '@marketplace/validation';
import type { ReactNode } from 'react';
import { Badge } from '../components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { formatMoney } from '../lib/money';
import { cn } from '../lib/utils';

/**
 * Phase 6 finance views shared by the Seller Center and the Admin Console. Display only:
 * every amount comes from the API (derived from the ledger), never calculated here.
 */

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(iso));
const date = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(
    new Date(iso),
  );
/** A period's end is exclusive; show its last day. */
export const periodLabel = (start: string, end: string) =>
  `${date(start)} – ${date(new Date(new Date(end).getTime() - 1).toISOString())}`;

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  REVERSED: 'Reversed',
};
const PAYOUT_VARIANTS: Record<PayoutStatus, Variant> = {
  REQUESTED: 'warning',
  APPROVED: 'secondary',
  PROCESSING: 'secondary',
  PAID: 'success',
  FAILED: 'destructive',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  REVERSED: 'destructive',
};

export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  return <Badge variant={PAYOUT_VARIANTS[status]}>{PAYOUT_STATUS_LABELS[status]}</Badge>;
}

/** The negative of a decimal string ("0.00" stays zero). */
const neg = (v: string) => (Number(v) === 0 ? '0.00' : v.startsWith('-') ? v.slice(1) : `-${v}`);

/** Signed amount: negative in red. */
export function Amount({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('font-mono', Number(value) < 0 && 'text-destructive', className)}>
      {formatMoney(value)}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold', Number(value) < 0 && 'text-destructive')}>
        {formatMoney(value)}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Pending, available, reserved, in payout and paid, from the ledger. */
export function BalanceCards({ balances }: { balances: SellerBalancesDto }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Balances">
      <Stat
        label="Pending"
        value={balances.pending}
        hint={
          Number(balances.held) > 0
            ? `${formatMoney(balances.held)} held by open returns or refunds`
            : 'Eligible after delivery and the return window'
        }
      />
      <Stat
        label="Available"
        value={balances.available}
        hint={
          Number(balances.available) < 0
            ? 'Owed to the marketplace; deducted from the next settlements'
            : `Minimum payout ${formatMoney(balances.minimumPayout)}`
        }
      />
      <Stat label="Reserved" value={balances.reserved} hint="Held back by finance" />
      <Stat label="In payout" value={balances.inPayout} hint="Requested, not yet paid" />
      <Stat label="Paid out" value={balances.paid} />
    </div>
  );
}

const ACCOUNT_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  IN_PAYOUT: 'In payout',
};

/** Statement of account: the seller payable lines of the ledger. */
export function SubledgerTable({
  data,
  orderLink,
}: {
  data: Subledger;
  orderLink?: (id: string, number: string) => ReactNode;
}) {
  if (data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="hidden md:table-cell">Details</TableHead>
          <TableHead className="hidden sm:table-cell">Balance</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="whitespace-nowrap text-xs">{dateTime(l.occurredAt)}</TableCell>
            <TableCell>
              {ledgerKindLabel(l.kind)}
              {l.sellerOrder ? (
                <span className="block text-xs text-muted-foreground">
                  {orderLink
                    ? orderLink(l.sellerOrder.id, l.sellerOrder.number)
                    : l.sellerOrder.number}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground md:table-cell">
              {l.description}
              <span className="block font-mono">{l.journal.reference}</span>
            </TableCell>
            <TableCell className="hidden text-xs sm:table-cell">
              {ACCOUNT_LABELS[l.account]}
            </TableCell>
            <TableCell className="text-right">
              <Amount value={l.amount} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3 py-1', strong && 'font-semibold')}>
      <dt>{label}</dt>
      <dd>
        <Amount value={value} />
      </dd>
    </div>
  );
}

/** An immutable settlement statement with one line per settled order. */
export function SettlementStatement({
  settlement,
  orderLink,
  documentLink,
}: {
  settlement: SettlementDetail;
  orderLink?: (id: string, number: string) => ReactNode;
  documentLink?: (id: string, label: string) => ReactNode;
}) {
  const s = settlement;
  const withholding = s.withholding as {
    code?: string | null;
    ratePercent?: string;
    basePercent?: string;
    exempt?: boolean;
    reason?: string | null;
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
            <CardDescription>
              {periodLabel(s.periodStart, s.periodEnd)} · {s.ordersCount} order(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="text-sm">
              <Line label="Sales" value={s.grossSales} />
              {Number(s.shippingCredits) !== 0 ? (
                <Line label="Shipping fees" value={s.shippingCredits} />
              ) : null}
              <Line label="Commission" value={neg(s.commission)} />
              {Number(s.paymentFees) !== 0 ? (
                <Line label="Payment and COD fees" value={neg(s.paymentFees)} />
              ) : null}
              {Number(s.refunds) !== 0 ? <Line label="Refunds" value={neg(s.refunds)} /> : null}
              {Number(s.commissionReversals) !== 0 ? (
                <Line label="Commission returned" value={s.commissionReversals} />
              ) : null}
              {Number(s.otherAdjustments) !== 0 ? (
                <Line label="Adjustments" value={s.otherAdjustments} />
              ) : null}
              <Line label="Net settled" value={s.netSettled} strong />
              <Line label="Withholding tax" value={neg(s.withholdingTax)} />
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {withholding.exempt
                ? (withholding.reason ?? 'Exempt from withholding.')
                : withholding.code
                  ? `${withholding.code}: ${Number(withholding.ratePercent)}% of ${Number(withholding.basePercent)}% of ${formatMoney(s.withholdingBase)} (sales net of returns, excluding VAT and shipping).`
                  : 'No withholding rule in force.'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available balance</CardTitle>
            <CardDescription>
              {s.reference}
              {s.journal ? ` · journal ${s.journal.reference}` : ''} · {dateTime(s.createdAt)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="text-sm">
              <Line label="Before this settlement" value={s.openingAvailable} />
              <Line label="After this settlement" value={s.closingAvailable} strong />
            </dl>
            {s.documents.length > 0 ? (
              <div className="mt-3 space-y-1 text-sm">
                <p className="font-medium">Documents</p>
                {s.documents.map((d) => (
                  <p key={d.id}>
                    {documentLink
                      ? documentLink(
                          d.id,
                          `${d.type === 'SERVICE_INVOICE' ? 'Service invoice' : 'Credit note'} ${d.number}`,
                        )
                      : d.number}{' '}
                    · {formatMoney(d.total)}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="hidden text-right md:table-cell">Commission</TableHead>
                <TableHead className="hidden text-right md:table-cell">Fees</TableHead>
                <TableHead className="hidden text-right md:table-cell">Refunds</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.lines.map((l) => (
                <TableRow key={l.sellerOrderId}>
                  <TableCell className="font-mono">
                    {orderLink ? orderLink(l.sellerOrderId, l.orderNumber) : l.orderNumber}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={l.grossSales} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Amount value={neg(l.commission)} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Amount value={neg(l.paymentFees)} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Amount value={neg(l.refunds)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={l.net} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** A marketplace service invoice or credit note, laid out for printing. */
export function FinanceDocumentView({ document: d }: { document: FinanceDocumentDto }) {
  const issuer = d.issuer as { legalName?: string; tin?: string | null; address?: string | null };
  const buyer = d.buyer as {
    name?: string;
    tin?: string | null;
    address?: string | null;
    vatRegistered?: boolean;
  };
  const tax = d.taxSnapshot as { code?: string | null; ratePercent?: string };
  return (
    <article className="mx-auto max-w-3xl space-y-6 rounded-lg border bg-background p-6 print:border-0">
      <header className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">{issuer.legalName}</p>
          {issuer.tin ? <p className="text-sm">TIN {issuer.tin}</p> : null}
          {issuer.address ? (
            <p className="text-sm text-muted-foreground">{issuer.address}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">
            {d.type === 'SERVICE_INVOICE' ? 'Service invoice' : 'Credit note'}
          </p>
          <p className="font-mono">{d.number}</p>
          <p className="text-sm text-muted-foreground">{date(d.issuedAt)}</p>
        </div>
      </header>
      <section className="text-sm">
        <p className="font-medium">Billed to</p>
        <p>{buyer.name}</p>
        {buyer.tin ? (
          <p>TIN {buyer.tin}</p>
        ) : (
          <p className="text-muted-foreground">No TIN on file</p>
        )}
        {buyer.address ? <p className="text-muted-foreground">{buyer.address}</p> : null}
        {d.settlement ? (
          <p className="mt-1 text-muted-foreground">Settlement {d.settlement.reference}</p>
        ) : null}
      </section>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">VAT</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.lines.map((l) => (
            <TableRow key={l.description}>
              <TableCell>{l.description}</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(l.amount)}</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(l.taxAmount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <dl className="ml-auto max-w-xs text-sm">
        <Line label="Subtotal" value={d.subtotal} />
        <Line label={tax.code ? `VAT (${Number(tax.ratePercent)}%)` : 'VAT'} value={d.taxAmount} />
        <Line label="Total" value={d.total} strong />
      </dl>
      <p className="text-xs text-muted-foreground">
        Generated from the marketplace ledger. Use as an official BIR invoice requires the
        operator’s registered invoicing system (ATP/CAS) — see the finance documentation.
      </p>
    </article>
  );
}

/** Who did what to a payout, in order. */
export function PayoutTimeline({ payout }: { payout: PayoutDetail }) {
  return (
    <ol className="space-y-2 text-sm">
      {payout.events.map((e) => (
        <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
          <span>
            <span className="font-medium">
              {e.type
                .replace(/_/g, ' ')
                .toLowerCase()
                .replace(/^\w/, (c) => c.toUpperCase())}
            </span>
            {e.actor ? <span className="text-muted-foreground"> · {e.actor}</span> : null}
            {e.note ? <span className="block text-xs text-muted-foreground">{e.note}</span> : null}
          </span>
          <span className="text-xs text-muted-foreground">{dateTime(e.createdAt)}</span>
        </li>
      ))}
    </ol>
  );
}
