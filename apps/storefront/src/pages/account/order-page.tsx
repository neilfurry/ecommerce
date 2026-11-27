import {
  toDisplayError,
  useCancelOrder,
  useFulfilmentAction,
  useMyOrder,
} from '@marketplace/api-client';
import {
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Breadcrumbs,
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
  ErrorState,
  formatMoney,
  Label,
  RefundList,
  ReturnStatusBadge,
  SellerOrderStatusBadge,
  ShipmentList,
  Skeleton,
  Textarea,
  toast,
} from '@marketplace/ui';
import { CheckCircle2Icon, ImageIcon, StoreIcon, TruckIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { SellerRatingForm } from '../../components/engagement/seller-rating-form';
import {
  OrderMessages,
  PackageActions,
  PaymentHistory,
  PaymentPanel,
} from '../../components/orders/order-actions';
import { productPath } from '../../lib/paths';
import { statusVariant } from '../../lib/order-status';

function CancelOrder({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useCancelOrder();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Cancel order
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>
              Every store’s part of the order is cancelled. Anything already paid is refunded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || cancel.isPending}
              onClick={() =>
                cancel.mutate(
                  { orderId, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.success('Order cancelled');
                    },
                    onError: (error) =>
                      toast.error(toDisplayError(error)?.message ?? 'Could not cancel.'),
                  },
                )
              }
            >
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function OrderPage() {
  const { orderId } = useParams();
  const [params, setParams] = useSearchParams();
  const order = useMyOrder(orderId);
  const verify = useFulfilmentAction();
  const verified = useRef(false);
  const returning = params.get('payment');
  // Back from the payment page: the server asks the provider; the redirect itself proves nothing.
  useEffect(() => {
    if (!returning || !orderId || verified.current) return;
    verified.current = true;
    verify.mutate((f) => f.customer.verifyPayment(orderId), {
      onSettled: () => {
        params.delete('payment');
        params.delete('cancelled');
        setParams(params, { replace: true });
      },
    });
  }, [returning, orderId, verify, params, setParams]);
  if (order.isPending) return <Skeleton className="h-96" />;
  if (order.isError) {
    return (
      <ErrorState
        message={toDisplayError(order.error)?.message ?? 'The order could not be loaded.'}
        onRetry={() => void order.refetch()}
      />
    );
  }
  const o = order.data;
  const t = o.totals;
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'My orders', to: '/account/orders' }, { label: o.orderNumber }]}
      />
      {params.get('placed') === '1' ? (
        <Alert className="border-emerald-300 bg-emerald-50 text-emerald-900">
          <CheckCircle2Icon aria-hidden="true" />
          <AlertTitle>Thank you! Your order {o.orderNumber} is placed.</AlertTitle>
          <AlertDescription>
            {o.sellerCount > 1
              ? `It was split into ${o.sellerCount} packages, one per store; each store ships its own.`
              : 'We emailed you the details.'}
          </AlertDescription>
        </Alert>
      ) : null}
      {verify.isPending ? (
        <Alert>
          <AlertTitle>Checking your payment with the provider…</AlertTitle>
        </Alert>
      ) : null}
      <PaymentPanel order={o} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Order {o.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Placed{' '}
            {new Date(o.placedAt).toLocaleString('en-PH', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            · {PAYMENT_METHOD_LABELS[o.paymentMethod]} ({PAYMENT_STATUS_LABELS[o.paymentStatus]})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(o.status)} data-testid="order-status">
            {ORDER_STATUS_LABELS[o.status]}
          </Badge>
          {o.cancellable ? <CancelOrder orderId={o.id} /> : null}
        </div>
      </div>
      {o.status === 'CANCELLED' && o.cancelReason ? (
        <p className="text-sm text-muted-foreground">Cancelled: {o.cancelReason}</p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {o.sellerOrders.map((so, i) => (
            <Card key={so.id} aria-label={`Package ${i + 1}: ${so.store.name}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <Link
                    to={`/s/${so.store.slug}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <StoreIcon className="size-4" aria-hidden="true" /> {so.store.name}
                  </Link>
                  <span className="flex items-center gap-2 text-sm font-normal">
                    <span className="text-muted-foreground">{so.number}</span>
                    <span data-testid="package-status">
                      <SellerOrderStatusBadge status={so.status} />
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="divide-y">
                  {so.items.map((item) => (
                    <li key={item.id} className="flex gap-3 py-3 first:pt-0">
                      <span className="size-16 shrink-0 overflow-hidden rounded border bg-muted">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <ImageIcon className="m-5 text-muted-foreground" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        {item.productSlug ? (
                          <Link
                            to={productPath({ id: item.productId, slug: item.productSlug })}
                            className="font-medium hover:underline"
                          >
                            {item.productName}
                          </Link>
                        ) : (
                          <p className="font-medium">{item.productName}</p>
                        )}
                        <p className="text-muted-foreground">
                          {item.variantTitle !== 'Default' ? `${item.variantTitle} · ` : ''}
                          {item.quantity} × {formatMoney(item.unitPrice)}
                          {item.priceSource === 'WHOLESALE_TIER'
                            ? ' (wholesale)'
                            : item.priceSource === 'FLASH_SALE'
                              ? ' (flash sale)'
                              : ''}
                        </p>
                        {['PLACED', 'COMPLETED'].includes(o.status) &&
                        !['CANCELLED', 'RETURNED_TO_SELLER', 'AWAITING_PAYMENT'].includes(
                          so.status,
                        ) &&
                        !item.reviewed ? (
                          <Link
                            to={`/account/reviews?item=${item.id}`}
                            className="text-xs text-primary underline"
                          >
                            Write a review
                          </Link>
                        ) : null}
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium">{formatMoney(item.lineTotal)}</p>
                        {Number(item.sellerDiscount) + Number(item.platformDiscount) > 0 ? (
                          <p className="text-xs text-emerald-700 line-through decoration-transparent">
                            incl. −
                            {formatMoney(
                              (Number(item.sellerDiscount) + Number(item.platformDiscount)).toFixed(
                                2,
                              ),
                            )}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
                {so.shipping ? (
                  <p className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-sm">
                    <TruckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      {so.shipping.serviceName} by {so.shipping.carrier} from {so.shipping.origin} ·{' '}
                      {so.shipping.etaMaxDays === 0
                        ? 'same day'
                        : `${so.shipping.etaMinDays}–${so.shipping.etaMaxDays} days`}{' '}
                      · {formatMoney(so.shipping.fee)}
                      {Number(so.shipping.discount) > 0
                        ? ` (−${formatMoney(so.shipping.discount)})`
                        : ''}
                    </span>
                  </p>
                ) : null}
                {so.customerNote ? (
                  <p className="text-sm text-muted-foreground">Your note: {so.customerNote}</p>
                ) : null}
                <p className="text-right text-sm">
                  Package total <span className="font-semibold">{formatMoney(so.total)}</span>
                </p>
                {so.shipments.length > 0 ? <ShipmentList shipments={so.shipments} /> : null}
                {so.cancelReason && so.status === 'CANCELLED' ? (
                  <p className="text-sm text-muted-foreground">Cancelled: {so.cancelReason}</p>
                ) : null}
                {so.returns.map((r) => (
                  <p key={r.id} className="flex items-center justify-between text-sm">
                    <Link to={`/account/returns/${r.id}`} className="hover:underline">
                      Return {r.number}
                    </Link>
                    <ReturnStatusBadge status={r.status} />
                  </p>
                ))}
                {so.refunds.length > 0 ? <RefundList refunds={so.refunds} /> : null}
                <PackageActions order={o} so={so} />
                {Number(so.promotionDiscount) > 0 || so.promotions.length > 0 ? (
                  <p className="text-sm text-emerald-700">
                    Promotions: {so.promotions.map((p) => p.name).join(', ')}
                  </p>
                ) : null}
                {so.deliveredAt &&
                ['DELIVERED', 'COMPLETED'].includes(so.status) &&
                !so.sellerRated ? (
                  <SellerRatingForm sellerOrderId={so.id} storeName={so.store.name} />
                ) : null}
                <Link
                  to={`/account/support?sellerOrder=${so.id}&subject=${encodeURIComponent(`About order ${so.number}`)}`}
                  className="inline-block text-sm underline"
                >
                  Ask {so.store.name} a question
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt>Items</dt>
                  <dd>{formatMoney(t.itemsSubtotal)}</dd>
                </div>
                {Number(t.couponDiscount) > 0 ? (
                  <div className="flex justify-between text-emerald-700">
                    <dt>Coupons</dt>
                    <dd>−{formatMoney(t.couponDiscount)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt>Shipping</dt>
                  <dd>{formatMoney(t.shippingFee)}</dd>
                </div>
                {Number(t.shippingDiscount) > 0 ? (
                  <div className="flex justify-between text-emerald-700">
                    <dt>Shipping discount</dt>
                    <dd>−{formatMoney(t.shippingDiscount)}</dd>
                  </div>
                ) : null}
                {Number(t.chargesTotal) > 0 ? (
                  <div className="flex justify-between">
                    <dt>Other charges</dt>
                    <dd>{formatMoney(t.chargesTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd data-testid="order-total">{formatMoney(t.grandTotal)}</dd>
                </div>
                <p className="text-xs text-muted-foreground">
                  Includes VAT of {formatMoney(t.vatAmount)}.
                </p>
              </dl>
              {o.coupons.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Coupons: {o.coupons.map((c) => c.code).join(', ')}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <PaymentHistory order={o} />
          <OrderMessages order={o} />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Delivery address</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">
                {o.address.recipientName} · {o.address.mobile}
              </p>
              <p className="text-muted-foreground">{o.address.formatted}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {o.events.map((e, i) => (
                  <li key={i}>
                    <p className="font-medium">{ORDER_EVENT_LABELS[e.type]}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString('en-PH', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
