import { toDisplayError, useApiClient, useFulfilmentAction } from '@marketplace/api-client';
import {
  MAX_RETURN_IMAGES,
  PAYMENT_METHOD_LABELS,
  RETURN_REASON_LABELS,
  RETURN_REASONS,
  type ReturnReason,
} from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatMoney,
  Input,
  Label,
  NoteList,
  PaymentAttemptBadge,
  PromptDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TestModeBadge,
  Textarea,
  toast,
} from '@marketplace/ui';
import type { OrderDetail } from '@marketplace/validation';
import { CreditCardIcon, LandmarkIcon } from 'lucide-react';
import { useState } from 'react';
import { Countdown } from '../shop/countdown';

type SellerOrder = OrderDetail['sellerOrders'][number];

const fail = (title: string) => (error: unknown) => {
  toast.error(title, { description: toDisplayError(error)?.message });
  throw error;
};

/**
 * Paying for an order waiting for payment: "Pay now" opens the provider's page (the mock's
 * test page locally); bank transfers show where to send the money and take the proof.
 * Whether it is paid is decided by the server (webhook or status check), never by this page.
 */
export function PaymentPanel({ order }: { order: OrderDetail }) {
  const p = order.payment;
  const client = useApiClient();
  const [opening, setOpening] = useState(false);
  const latest = p.attempts[p.attempts.length - 1];
  if (order.status !== 'AWAITING_PAYMENT') return null;
  return (
    <Alert data-testid="payment-panel">
      {order.paymentMethod === 'BANK_TRANSFER' ? (
        <LandmarkIcon aria-hidden="true" />
      ) : (
        <CreditCardIcon aria-hidden="true" />
      )}
      <AlertTitle className="flex flex-wrap items-center gap-2">
        Waiting for {PAYMENT_METHOD_LABELS[order.paymentMethod]} payment
        {latest?.test ? <TestModeBadge label="Test payment — no real money moves" /> : null}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        {order.paymentDueAt ? (
          <p>
            Pay within <Countdown until={order.paymentDueAt} />; unpaid orders are cancelled
            automatically.
          </p>
        ) : null}
        {latest?.status === 'FAILED' && latest.failureMessage ? (
          <p className="text-destructive">Last attempt: {latest.failureMessage}</p>
        ) : null}
        {p.canPay ? (
          <Button
            disabled={opening}
            onClick={() => {
              setOpening(true);
              client.fulfilment.customer
                .pay(order.id)
                .then((r) => window.location.assign(r.checkoutUrl))
                .catch((e: unknown) => {
                  setOpening(false);
                  toast.error('Could not open the payment page', {
                    description: toDisplayError(e)?.message,
                  });
                });
            }}
          >
            Pay {formatMoney(order.grandTotal)} now
          </Button>
        ) : null}
        {p.bankTransfer ? <BankTransfer order={order} /> : null}
      </AlertDescription>
    </Alert>
  );
}

function BankTransfer({ order }: { order: OrderDetail }) {
  const bank = order.payment.bankTransfer!;
  const action = useFulfilmentAction();
  const [file, setFile] = useState<File | null>(null);
  const [bankName, setBankName] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(bank.amount);
  const [when, setWhen] = useState('');
  const proofs = order.payment.attempts.flatMap((a) => a.proofs);
  return (
    <div className="space-y-3 text-foreground">
      <div className="rounded-md border bg-background p-3 text-sm">
        <p>
          Transfer <span className="font-semibold">{formatMoney(bank.amount)}</span> and write{' '}
          <span className="font-mono font-semibold">{bank.reference}</span> as the reference.
        </p>
        <ul className="mt-2 space-y-1">
          {bank.accounts.map((a) => (
            <li key={a.accountNumber}>
              {a.bankName}
              {a.branch ? ` (${a.branch})` : ''} · {a.accountName} ·{' '}
              <span className="font-mono">{a.accountNumber}</span>
            </li>
          ))}
        </ul>
        {bank.instructions ? (
          <p className="mt-2 text-muted-foreground">{bank.instructions}</p>
        ) : null}
      </div>
      {proofs.map((proof) => (
        <p key={proof.id} className="text-sm">
          Proof {proof.referenceNumber} ({formatMoney(proof.amount)}):{' '}
          {proof.status === 'SUBMITTED'
            ? 'being checked by our finance team.'
            : proof.status === 'REJECTED'
              ? `not accepted — ${proof.rejectionReason}`
              : 'accepted.'}
        </p>
      ))}
      {order.payment.canUploadProof ? (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            const form = new FormData();
            form.append('file', file);
            form.append('bankName', bankName.trim());
            form.append('referenceNumber', reference.trim());
            form.append('amount', amount.trim());
            form.append('transferredAt', new Date(when).toISOString());
            action
              .mutateAsync((f) => f.customer.uploadProof(order.id, form))
              .then(() => toast.success('Proof sent; we will confirm your payment soon.'))
              .catch(fail('Could not upload the proof'))
              .catch(() => undefined);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="proof-bank">Your bank or e-wallet</Label>
            <Input
              id="proof-bank"
              required
              minLength={2}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proof-ref">Transaction reference</Label>
            <Input
              id="proof-ref"
              required
              minLength={3}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proof-amount">Amount sent</Label>
            <Input
              id="proof-amount"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proof-when">Date and time of the transfer</Label>
            <Input
              id="proof-when"
              required
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="proof-file">Receipt or screenshot (PDF, JPG or PNG)</Label>
            <Input
              id="proof-file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            type="submit"
            disabled={action.isPending || !file}
            className="sm:col-span-2 sm:justify-self-start"
          >
            Send proof of transfer
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Payment attempts and refunds, for the customer's records. */
export function PaymentHistory({ order }: { order: OrderDetail }) {
  const p = order.payment;
  if (p.attempts.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {p.attempts.map((a) => (
          <p key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs">{a.reference}</span>
            <span className="flex items-center gap-1">
              {a.test ? <TestModeBadge /> : null}
              <PaymentAttemptBadge status={a.status} />
            </span>
          </p>
        ))}
        <p className="flex justify-between">
          <span>Received</span> <span className="font-mono">{formatMoney(p.amountReceived)}</span>
        </p>
        {Number(p.amountRefunded) > 0 ? (
          <p className="flex justify-between">
            <span>Refunded</span> <span className="font-mono">{formatMoney(p.amountRefunded)}</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What the customer can do with one store's part: cancel, ask to cancel, confirm, return. */
export function PackageActions({ order, so }: { order: OrderDetail; so: SellerOrder }) {
  const action = useFulfilmentAction();
  const a = so.actions;
  const run = (title: string, success: string, fn: Parameters<typeof action.mutateAsync>[0]) =>
    action
      .mutateAsync(fn)
      .then(() => toast.success(success))
      .catch(fail(title));
  if (!a.cancel && !a.requestCancellation && !a.confirmReceived && !a.requestReturn) {
    return so.cancellationRequest?.status === 'REQUESTED' ? (
      <p className="text-sm text-muted-foreground">
        You asked the store to cancel; waiting for its answer.
      </p>
    ) : so.cancellationRequest?.status === 'REJECTED' ? (
      <p className="text-sm text-muted-foreground">
        The store declined your cancellation: {so.cancellationRequest.response}
      </p>
    ) : null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {a.cancel ? (
        <PromptDialog
          trigger={
            <Button size="sm" variant="outline">
              Cancel this package
            </Button>
          }
          title={`Cancel the package from ${so.store.name}?`}
          description="Only this store’s items are cancelled. Anything you paid for them is refunded."
          label="Reason"
          confirmLabel="Cancel package"
          destructive
          onSubmit={(text) =>
            run('Could not cancel', 'Package cancelled', (f) => f.customer.cancelPart(so.id, text))
          }
        />
      ) : null}
      {a.requestCancellation ? (
        <PromptDialog
          trigger={
            <Button size="sm" variant="outline">
              Ask to cancel
            </Button>
          }
          title="Ask the store to cancel"
          description="The store is already preparing this package; it decides whether it can still cancel."
          label="Reason"
          minLength={5}
          confirmLabel="Send request"
          onSubmit={(text) =>
            run('Could not send the request', 'Request sent to the store', (f) =>
              f.customer.requestCancellation(so.id, text),
            )
          }
        />
      ) : null}
      {a.confirmReceived ? (
        <Button
          size="sm"
          disabled={action.isPending}
          onClick={() =>
            void run('Could not confirm', 'Thanks for confirming!', (f) =>
              f.customer.confirmReceived(so.id),
            ).catch(() => undefined)
          }
        >
          I received this package
        </Button>
      ) : null}
      {a.requestReturn ? <RequestReturn order={order} so={so} /> : null}
    </div>
  );
}

function RequestReturn({ so }: { order: OrderDetail; so: SellerOrder }) {
  const action = useFulfilmentAction();
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>('DAMAGED');
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState<'FULL_REFUND' | 'REPLACEMENT'>('FULL_REFUND');
  const [images, setImages] = useState<File[]>([]);
  const items = Object.entries(quantities).filter(([, q]) => q > 0);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Return or refund
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a return</DialogTitle>
            <DialogDescription>
              Available until{' '}
              {so.returnWindowEndsAt
                ? new Date(so.returnWindowEndsAt).toLocaleDateString('en-PH')
                : '—'}
              . The store answers first; if you disagree, the marketplace decides.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Items to return</legend>
              {so.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <label htmlFor={`qty-${item.id}`}>{item.productName}</label>
                  <Input
                    id={`qty-${item.id}`}
                    type="number"
                    min={0}
                    max={item.quantity}
                    className="w-20"
                    value={quantities[item.id] ?? 0}
                    onChange={(e) =>
                      setQuantities((q) => ({
                        ...q,
                        [item.id]: Math.max(
                          0,
                          Math.min(item.quantity, Number(e.target.value) || 0),
                        ),
                      }))
                    }
                  />
                </div>
              ))}
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="return-reason">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as ReturnReason)}>
                <SelectTrigger id="return-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {RETURN_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="return-description">What happened?</Label>
              <Textarea
                id="return-description"
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="return-resolution">What would you like?</Label>
              <Select value={resolution} onValueChange={(v) => setResolution(v as 'FULL_REFUND')}>
                <SelectTrigger id="return-resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_REFUND">A refund</SelectItem>
                  <SelectItem value="REPLACEMENT">A replacement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="return-photos">Photos (up to {MAX_RETURN_IMAGES})</Label>
              <Input
                id="return-photos"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setImages([...(e.target.files ?? [])].slice(0, MAX_RETURN_IMAGES))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button
              disabled={action.isPending || items.length === 0 || description.trim().length < 10}
              onClick={() => {
                const form = new FormData();
                form.append(
                  'data',
                  JSON.stringify({
                    sellerOrderId: so.id,
                    items: items.map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
                    reason,
                    description: description.trim(),
                    requestedResolution: resolution,
                  }),
                );
                for (const image of images) form.append('images', image);
                action
                  .mutateAsync((f) => f.customer.returns.create(form))
                  .then(() => {
                    setOpen(false);
                    toast.success('Return requested; the store will answer soon.');
                  })
                  .catch(fail('Could not request the return'))
                  .catch(() => undefined);
              }}
            >
              Request return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Messages on the order (seen by the stores and support). */
export function OrderMessages({ order }: { order: OrderDetail }) {
  const action = useFulfilmentAction();
  const [body, setBody] = useState('');
  const notes = [...order.notes, ...order.sellerOrders.flatMap((so) => so.notes)].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Messages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <NoteList notes={notes} />
        <Label htmlFor="order-message" className="sr-only">
          Message
        </Label>
        <Textarea
          id="order-message"
          rows={2}
          placeholder="Write to the stores and support"
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!body.trim() || action.isPending}
          onClick={() =>
            void action
              .mutateAsync((f) => f.customer.addNote(order.id, { body: body.trim() }))
              .then(() => setBody(''))
              .catch(fail('Could not send the message'))
              .catch(() => undefined)
          }
        >
          Send
        </Button>
      </CardContent>
    </Card>
  );
}
