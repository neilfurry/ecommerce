import { useApiClient } from '@marketplace/api-client';
import {
  REFUND_REASON_LABELS,
  SELLER_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from '@marketplace/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  formatMoney,
  Input,
  Label,
  NoteList,
  PaymentAttemptBadge,
  PromptDialog,
  RefundList,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TestModeBadge,
  Textarea,
} from '@marketplace/ui';
import type {
  AdminOrderDetail,
  RefundDto,
  SellerOrderDetail,
  ShipmentDto,
} from '@marketplace/validation';
import { useState } from 'react';
import { Link } from 'react-router';
import { openBlob, showError } from '../../lib/errors';
import { useCan, useRun } from './use-actions';

const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

export function NoteForm({
  onSend,
}: {
  onSend: (body: string, visibility: 'CUSTOMER' | 'SELLER' | 'STAFF') => Promise<unknown>;
}) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'CUSTOMER' | 'SELLER' | 'STAFF'>('STAFF');
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor="staff-note">Add a note</Label>
      <Textarea
        id="staff-note"
        rows={2}
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Select value={visibility} onValueChange={(v) => setVisibility(v as 'STAFF')}>
          <SelectTrigger className="h-8 w-56" aria-label="Who sees it">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="STAFF">Staff only</SelectItem>
            <SelectItem value="SELLER">Seller and staff</SelectItem>
            <SelectItem value="CUSTOMER">Customer, seller and staff</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!body.trim() || pending}
          onClick={() => {
            setPending(true);
            onSend(body.trim(), visibility)
              .then(() => setBody(''))
              .catch(() => undefined)
              .finally(() => setPending(false));
          }}
        >
          Add note
        </Button>
      </div>
    </div>
  );
}

/** Order-level actions and the payment record (Admin Console › Orders › order). */
export function AdminOrderPanels({ order }: { order: AdminOrderDetail }) {
  const can = useCan();
  const { run, pending } = useRun();
  const p = order.payment;
  const hasOpenOnline = p.attempts.some(
    (a) => a.status === 'PENDING' && a.provider !== 'MANUAL_BANK' && a.provider !== 'COD',
  );
  const notes = [...order.notes, ...order.sellerOrders.flatMap((so) => so.notes)].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <>
      {can('orders.manage') || (can('payments.manage') && hasOpenOnline) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {can('payments.manage') && hasOpenOnline ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  quiet(
                    run('Could not check', 'Checked with the provider', (f) =>
                      f.admin.verifyPayment(order.id),
                    ),
                  )
                }
              >
                Check payment with the provider
              </Button>
            ) : null}
            {can('orders.manage') && ['AWAITING_PAYMENT', 'PLACED'].includes(order.status) ? (
              <PromptDialog
                trigger={<Button variant="destructive">Cancel order</Button>}
                title={`Cancel order ${order.orderNumber}?`}
                description="Every seller order is cancelled, stock is released and anything paid is refunded."
                label="Reason (shown to the customer)"
                confirmLabel="Cancel order"
                destructive
                onSubmit={(text) =>
                  run('Could not cancel', 'Order cancelled', (f) =>
                    f.admin.cancelOrder(order.id, text),
                  )
                }
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {p.attempts.length === 0 ? (
            <p className="text-muted-foreground">No payment record.</p>
          ) : null}
          {p.attempts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {can('payments.read') ? (
                  <Link to={`/payments/${a.id}`} className="font-mono hover:underline">
                    {a.reference}
                  </Link>
                ) : (
                  <span className="font-mono">{a.reference}</span>
                )}{' '}
                <span className="text-muted-foreground">· {a.provider}</span>
              </span>
              <span className="flex items-center gap-1">
                {a.test ? <TestModeBadge /> : null}
                <PaymentAttemptBadge status={a.status} />
              </span>
            </div>
          ))}
          <p className="flex justify-between">
            <span>Received</span>
            <span className="font-mono">{formatMoney(p.amountReceived)}</span>
          </p>
          <p className="flex justify-between">
            <span>Refunded</span>
            <span className="font-mono">{formatMoney(p.amountRefunded)}</span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NoteList notes={notes} />
          {can('orders.manage') ? (
            <NoteForm
              onSend={(body, visibility) =>
                run('Could not add the note', 'Note added', (f) =>
                  f.admin.addOrderNote(order.id, { body, visibility }),
                )
              }
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function RefundForm({ order }: { order: SellerOrderDetail }) {
  const { run } = useRun();
  const [kind, setKind] = useState<'FULL' | 'PARTIAL'>('PARTIAL');
  const [reason, setReason] = useState<'GOODWILL' | 'OTHER' | 'CANCELLATION'>('GOODWILL');
  const [amount, setAmount] = useState('');
  // One key per form: a double submit creates one refund.
  const [key] = useState(() => crypto.randomUUID());
  return (
    <PromptDialog
      trigger={<Button variant="outline">Refund…</Button>}
      title={`Refund seller order ${order.number}`}
      description="Goodwill refunds are the marketplace's cost; other reasons are taken from the seller's payables."
      label="Note (kept with the refund)"
      confirmLabel="Refund"
      onSubmit={(note) =>
        run('Could not refund', 'Refund created', (f) =>
          f.admin.refunds.create({
            sellerOrderId: order.id,
            reason,
            kind,
            ...(kind === 'PARTIAL' ? { amount: Number(amount).toFixed(2) } : {}),
            note,
            idempotencyKey: key,
          }),
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="refund-kind">Amount</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as 'FULL')}>
            <SelectTrigger id="refund-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FULL">Everything still refundable</SelectItem>
              <SelectItem value="PARTIAL">Part of it</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="refund-reason">Reason</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as 'GOODWILL')}>
            <SelectTrigger id="refund-reason">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['GOODWILL', 'OTHER', 'CANCELLATION'] as const).map((r) => (
                <SelectItem key={r} value={r}>
                  {REFUND_REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {kind === 'PARTIAL' ? (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="refund-amount">Amount (₱)</Label>
            <Input
              id="refund-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        ) : null}
      </div>
    </PromptDialog>
  );
}

const STAFF_SHIPMENT_UPDATES: ShipmentStatus[] = [
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURNING',
  'RETURNED',
];

export function StaffShipmentButtons({ shipment }: { shipment: ShipmentDto }) {
  const can = useCan();
  const client = useApiClient();
  const { run, pending } = useRun();
  const [status, setStatus] = useState<ShipmentStatus>('PICKED_UP');
  const open = !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(shipment.status);
  return (
    <>
      {shipment.hasWaybill ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void client.fulfilment.admin.shipping
              .waybill(shipment.id)
              .then((blob) => openBlob(blob, `waybill-${shipment.trackingNumber}.pdf`))
              .catch((e: unknown) => showError('Could not open the label', e))
          }
        >
          Label
        </Button>
      ) : null}
      {can('shipping.manage') && open ? (
        <span className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as ShipmentStatus)}>
            <SelectTrigger className="h-8 w-48" aria-label="Shipment status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_SHIPMENT_UPDATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SHIPMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {shipment.carrier === 'MOCK' ? (
            <Button
              size="sm"
              disabled={pending}
              title="The mock courier sends this status as a signed webhook"
              onClick={() =>
                quiet(
                  run('Could not simulate', 'Courier update simulated', (f) =>
                    f.admin.shipping.simulate(shipment.id, status),
                  ),
                )
              }
            >
              Simulate courier update
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                quiet(
                  run('Could not update', 'Shipment updated', (f) =>
                    f.admin.shipping.update(shipment.id, { status: status as 'PICKED_UP' }),
                  ),
                )
              }
            >
              Record status
            </Button>
          )}
          {shipment.status === 'BOOKED' ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost">
                  Cancel booking
                </Button>
              }
              title="Cancel this booking?"
              description="The seller order goes back to Processing."
              destructive
              onConfirm={() =>
                run('Could not cancel', 'Booking cancelled', (f) =>
                  f.admin.shipping.cancel(shipment.id),
                )
              }
            />
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/** Staff actions on a seller order: cancel, accept or complete, answer a cancellation, refund. */
export function StaffSellerOrderActions({ order }: { order: SellerOrderDetail }) {
  const can = useCan();
  const { run, pending } = useRun();
  const a = order.actions;
  const items = [];
  if (a.answerCancellation) {
    items.push(
      <ConfirmDialog
        key="approve"
        trigger={<Button variant="destructive">Approve the customer’s cancellation</Button>}
        title="Cancel at the customer’s request?"
        description="Stock is released and any payment is refunded."
        destructive
        onConfirm={() =>
          run('Could not cancel', 'Cancelled', (f) =>
            f.admin.answerCancellation(order.id, 'approve'),
          )
        }
      />,
      <PromptDialog
        key="reject"
        trigger={<Button variant="outline">Decline the cancellation request</Button>}
        title="Decline the cancellation request"
        label="Tell the customer why"
        minLength={5}
        confirmLabel="Decline"
        onSubmit={(text) =>
          run('Could not decline', 'Declined', (f) =>
            f.admin.answerCancellation(order.id, 'reject', text),
          )
        }
      />,
    );
  }
  for (const to of a.moveTo) {
    items.push(
      <PromptDialog
        key={to}
        trigger={<Button variant="outline">Move to {SELLER_ORDER_STATUS_LABELS[to]}</Button>}
        title={`Move to ${SELLER_ORDER_STATUS_LABELS[to]}`}
        description="Recorded in the history with your note."
        label="Note"
        confirmLabel="Move"
        onSubmit={(text) =>
          run('Could not move', 'Updated', (f) => f.admin.transition(order.id, to, text))
        }
      />,
    );
  }
  if (a.cancel) {
    items.push(
      <PromptDialog
        key="cancel"
        trigger={<Button variant="destructive">Cancel seller order</Button>}
        title={`Cancel ${order.number}?`}
        description="Stock is released, a booked shipment is cancelled and anything paid is refunded."
        label="Reason (shown to the customer and the seller)"
        confirmLabel="Cancel"
        destructive
        onSubmit={(text) =>
          run('Could not cancel', 'Cancelled', (f) => f.admin.cancelSellerOrder(order.id, text))
        }
      />,
    );
  }
  if (can('refunds.manage') && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus)) {
    items.push(<RefundForm key="refund" order={order} />);
  }
  if (items.length === 0) return null;
  return (
    <>
      {pending ? <span className="sr-only">Working…</span> : null}
      {items}
    </>
  );
}

/** Finance actions on a refund (manual payout, retry, resend). */
export function RefundButtons({ refund }: { refund: RefundDto }) {
  const can = useCan();
  const { run, pending } = useRun();
  if (!can('refunds.manage')) return null;
  return (
    <>
      {refund.status === 'AWAITING_PAYOUT' ? (
        <PromptDialog
          trigger={<Button size="sm">Mark paid out</Button>}
          title={`Refund ${refund.reference} paid out`}
          description={`${formatMoney(refund.amount)} sent to the customer outside the payment provider.`}
          label="Bank or e-wallet reference of the payout"
          confirmLabel="Mark paid"
          onSubmit={(text) =>
            run('Could not save', 'Refund completed', (f) =>
              f.admin.refunds.markPaid(refund.id, text),
            )
          }
        />
      ) : null}
      {refund.status === 'FAILED' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            quiet(
              run('Could not retry', 'Refund sent again', (f) => f.admin.refunds.retry(refund.id)),
            )
          }
        >
          Retry
        </Button>
      ) : null}
      {refund.status === 'PROCESSING' && refund.method === 'ORIGINAL' && refund.failureMessage ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            quiet(
              run('Could not resend', 'Sent to the provider', (f) =>
                f.admin.refunds.resend(refund.id),
              ),
            )
          }
        >
          Send again
        </Button>
      ) : null}
    </>
  );
}

export function RefundsCard({ refunds }: { refunds: RefundDto[] }) {
  return <RefundList refunds={refunds} actions={(r) => <RefundButtons refund={r} />} />;
}
