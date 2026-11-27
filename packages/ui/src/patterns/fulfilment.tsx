import {
  CARRIER_LABELS,
  PAYMENT_ATTEMPT_STATUS_LABELS,
  type PaymentAttemptStatus,
  REFUND_REASON_LABELS,
  RETURN_REASON_LABELS,
  RETURN_RESOLUTION_LABELS,
  REFUND_STATUS_LABELS,
  type RefundStatus,
  RETURN_STATUS_LABELS,
  type ReturnStatus,
  ledgerKindLabel,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from '@marketplace/shared-types';
import type {
  LedgerEntryDto,
  OrderNoteDto,
  RefundDto,
  ReturnDto,
  ShipmentDto,
} from '@marketplace/validation';
import { FlaskConicalIcon, PackageIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/dialog';
import { Textarea } from '../components/input';
import { Label } from '../components/label';
import { Spinner } from '../components/spinner';
import { formatMoney } from '../lib/money';

type Variant = 'warning' | 'success' | 'secondary' | 'outline' | 'destructive';
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

/** Marks mock or sandbox data: no real money or parcel moved. */
export function TestModeBadge({ label = 'Test' }: { label?: string }) {
  return (
    <Badge variant="warning" className="gap-1" title="Mock or sandbox: nothing real happened">
      <FlaskConicalIcon className="size-3" aria-hidden="true" /> {label}
    </Badge>
  );
}

const SHIPMENT_VARIANTS: Record<ShipmentStatus, Variant> = {
  BOOKED: 'outline',
  PICKED_UP: 'outline',
  IN_TRANSIT: 'outline',
  OUT_FOR_DELIVERY: 'outline',
  DELIVERED: 'success',
  DELIVERY_FAILED: 'destructive',
  RETURNING: 'destructive',
  RETURNED: 'secondary',
  CANCELLED: 'secondary',
};
export const ShipmentStatusBadge = ({ status }: { status: ShipmentStatus }) => (
  <Badge variant={SHIPMENT_VARIANTS[status]}>{SHIPMENT_STATUS_LABELS[status]}</Badge>
);

const PAYMENT_VARIANTS: Record<PaymentAttemptStatus, Variant> = {
  CREATED: 'outline',
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'destructive',
  EXPIRED: 'secondary',
  CANCELLED: 'secondary',
};
export const PaymentAttemptBadge = ({ status }: { status: PaymentAttemptStatus }) => (
  <Badge variant={PAYMENT_VARIANTS[status]}>{PAYMENT_ATTEMPT_STATUS_LABELS[status]}</Badge>
);

const REFUND_VARIANTS: Record<RefundStatus, Variant> = {
  PROCESSING: 'warning',
  AWAITING_PAYOUT: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'destructive',
};
export const RefundStatusBadge = ({ status }: { status: RefundStatus }) => (
  <Badge variant={REFUND_VARIANTS[status]}>{REFUND_STATUS_LABELS[status]}</Badge>
);

const RETURN_VARIANTS: Record<ReturnStatus, Variant> = {
  REQUESTED: 'warning',
  APPROVED: 'outline',
  REJECTED: 'destructive',
  ESCALATED: 'warning',
  RETURN_SHIPPED: 'outline',
  RECEIVED: 'outline',
  RESOLVED: 'success',
  CLOSED: 'secondary',
  CANCELLED: 'secondary',
};
export const ReturnStatusBadge = ({ status }: { status: ReturnStatus }) => (
  <Badge variant={RETURN_VARIANTS[status]}>{RETURN_STATUS_LABELS[status]}</Badge>
);

/** Parcels of a seller order with their tracking history (newest event last). */
export function ShipmentList({
  shipments,
  actions,
}: {
  shipments: ShipmentDto[];
  /** Buttons for one shipment (waybill, cancel, update...). */
  actions?: (shipment: ShipmentDto) => ReactNode;
}) {
  if (shipments.length === 0) {
    return <p className="text-sm text-muted-foreground">No shipment yet.</p>;
  }
  return (
    <ul className="space-y-4">
      {shipments.map((s) => (
        <li
          key={s.id}
          className="space-y-2 rounded-md border p-3"
          aria-label={`Shipment ${s.trackingNumber}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <PackageIcon className="size-4" aria-hidden="true" />
              {s.direction === 'RETURN' ? 'Return parcel · ' : ''}
              {s.carrier === 'SELF' ? s.carrierName : CARRIER_LABELS[s.carrier]}
              <span className="font-mono" data-testid="tracking-number">
                {s.trackingNumber}
              </span>
            </p>
            <span className="flex items-center gap-2">
              {s.test ? <TestModeBadge /> : null}
              <ShipmentStatusBadge status={s.status} />
            </span>
          </div>
          {Number(s.codAmount) > 0 ? (
            <p className="text-xs text-muted-foreground">
              Collect on delivery: {formatMoney(s.codAmount)}
            </p>
          ) : null}
          <ol className="space-y-1 border-l pl-3 text-xs">
            {s.events.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{SHIPMENT_STATUS_LABELS[e.status]}</span>
                {e.description && e.description !== SHIPMENT_STATUS_LABELS[e.status]
                  ? ` — ${e.description}`
                  : ''}
                {e.location ? ` · ${e.location}` : ''}
                <span className="text-muted-foreground"> · {dateTime(e.occurredAt)}</span>
              </li>
            ))}
          </ol>
          {actions ? <div className="flex flex-wrap gap-2">{actions(s)}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export function RefundList({
  refunds,
  actions,
}: {
  refunds: RefundDto[];
  actions?: (r: RefundDto) => ReactNode;
}) {
  if (refunds.length === 0) return <p className="text-sm text-muted-foreground">No refunds.</p>;
  return (
    <ul className="divide-y text-sm">
      {refunds.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div>
            <p className="font-medium">
              <span className="font-mono">{r.reference}</span> · {REFUND_REASON_LABELS[r.reason]}
              {r.kind === 'PARTIAL' ? ' (partial)' : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {dateTime(r.createdAt)} ·{' '}
              {r.method === 'ORIGINAL' ? 'to the original payment' : 'manual payout'}
              {r.payoutReference ? ` · ${r.payoutReference}` : ''}
              {r.failureMessage ? ` · ${r.failureMessage}` : ''}
            </p>
          </div>
          <span className="flex items-center gap-2">
            {r.test ? <TestModeBadge /> : null}
            <RefundStatusBadge status={r.status} />
            <span className="font-mono">{formatMoney(r.amount)}</span>
            {actions?.(r)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NoteList({ notes }: { notes: OrderNoteDto[] }) {
  if (notes.length === 0) return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {notes.map((n) => (
        <li key={n.id} className="rounded-md bg-muted/50 p-2">
          <p className="text-xs text-muted-foreground">
            {n.authorName} · {dateTime(n.createdAt)}
            {n.visibility !== 'CUSTOMER' ? (
              <Badge variant="outline" className="ml-2">
                {n.visibility === 'STAFF' ? 'Staff only' : 'Seller and staff'}
              </Badge>
            ) : null}
          </p>
          <p className="whitespace-pre-wrap">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function LedgerList({ entries }: { entries: LedgerEntryDto[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing posted yet (posted when the money is received).
      </p>
    );
  }
  return (
    <ul className="divide-y text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex justify-between gap-3 py-1.5">
          <span>
            {ledgerKindLabel(e.type)}
            <span className="block text-xs text-muted-foreground">{e.description}</span>
          </span>
          <span className={`font-mono ${Number(e.amount) < 0 ? 'text-destructive' : ''}`}>
            {Number(e.amount) < 0
              ? `−${formatMoney(e.amount.replace('-', ''))}`
              : formatMoney(e.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface PromptDialogProps {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  label: string;
  minLength?: number;
  maxLength?: number;
  confirmLabel: string;
  destructive?: boolean;
  /** Extra fields above the text box. */
  children?: ReactNode;
  /** Optional text: an empty answer is allowed when minLength is 0. */
  onSubmit: (text: string) => Promise<unknown>;
}

/**
 * A dialog asking for a reason or note before a consequential action. Stays open (for a
 * retry) when the action fails; closes when it succeeds.
 */
export function PromptDialog({
  trigger,
  title,
  description,
  label,
  minLength = 3,
  maxLength = 500,
  confirmLabel,
  destructive,
  children,
  onSubmit,
}: PromptDialogProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const fieldId = `prompt-${title.replace(/\W+/g, '-').toLowerCase()}`;
  const submit = async () => {
    setPending(true);
    try {
      await onSubmit(text.trim());
      setOpen(false);
      setText('');
    } catch {
      // The caller shows the error; keep the dialog for a retry.
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          <div className="space-y-2">
            <Label htmlFor={fieldId}>{label}</Label>
            <Textarea
              id={fieldId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={maxLength}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              disabled={text.trim().length < minLength || pending}
              onClick={() => void submit()}
            >
              {pending ? <Spinner className="size-4" /> : null} {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One return: reason, items, photos, decisions, parcels and refunds, with the viewer's
 * actions beside it. Shared by the storefront, Seller Center and the Admin Console.
 */
export function ReturnView({ ret, actions }: { ret: ReturnDto; actions?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {RETURN_REASON_LABELS[ret.reason]} <ReturnStatusBadge status={ret.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap">{ret.description}</p>
            <p className="text-muted-foreground">
              Asked for: {RETURN_RESOLUTION_LABELS[ret.requestedResolution]}
              {ret.resolution ? ` · Decided: ${RETURN_RESOLUTION_LABELS[ret.resolution]}` : ''}
              {ret.refundAmount ? ` (${formatMoney(ret.refundAmount)})` : ''}
            </p>
            <ul className="divide-y">
              {ret.items.map((i) => (
                <li key={i.orderItemId} className="flex justify-between py-1.5">
                  <span>
                    {i.quantity} × {i.productName}
                    {i.variantTitle !== 'Default' ? ` (${i.variantTitle})` : ''}
                  </span>
                  <span className="font-mono">{formatMoney(i.amount)}</span>
                </li>
              ))}
            </ul>
            {ret.images.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {ret.images.map((img, index) => (
                  <a key={img.id} href={img.url} target="_blank" rel="noreferrer">
                    <img
                      src={img.url}
                      alt={`Customer photo ${index + 1}`}
                      className="size-24 rounded border object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}
            {ret.sellerResponse ? <p>Seller: “{ret.sellerResponse}”</p> : null}
            {ret.escalationNote ? (
              <p>Customer, asking the marketplace: “{ret.escalationNote}”</p>
            ) : null}
            {ret.staffDecisionNote ? <p>Marketplace decision: “{ret.staffDecisionNote}”</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parcels</CardTitle>
          </CardHeader>
          <CardContent>
            <ShipmentList shipments={ret.shipments} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <RefundList refunds={ret.refunds} />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        {actions ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next steps</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">{actions}</CardContent>
          </Card>
        ) : null}
        <Card>
          <CardContent className="space-y-1 pt-6 text-sm">
            <p>Requested {dateTime(ret.createdAt)}</p>
            {ret.status === 'REQUESTED' ? (
              <p>Seller answer due {dateTime(ret.sellerDeadline)}</p>
            ) : null}
            {ret.resolvedAt ? <p>Closed {dateTime(ret.resolvedAt)}</p> : null}
            {ret.restocked !== null ? (
              <p>{ret.restocked ? 'Put back in stock' : 'Recorded as damaged'}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
