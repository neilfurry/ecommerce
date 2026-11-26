import {
  COD_COLLECTION_STATUS_LABELS,
  COUPON_TYPE_LABELS,
  ORDER_EVENT_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  SELLER_ORDER_STATUS_LABELS,
  SHIPPING_METHOD_LABELS,
  type SellerOrderStatus,
} from '@marketplace/shared-types';
import type { SellerOrderDetail } from '@marketplace/validation';
import type { ReactNode } from 'react';
import { Badge } from '../components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/card';
import { Separator } from '../components/separator';
import { formatMoney } from '../lib/money';
import { LedgerList, NoteList, RefundList, ReturnStatusBadge, ShipmentList } from './fulfilment';

const VARIANTS: Record<
  SellerOrderStatus,
  'warning' | 'success' | 'secondary' | 'outline' | 'destructive'
> = {
  AWAITING_PAYMENT: 'warning',
  PENDING: 'warning',
  PROCESSING: 'outline',
  READY_FOR_PICKUP: 'outline',
  SHIPPED: 'outline',
  DELIVERY_FAILED: 'destructive',
  RETURNING_TO_SELLER: 'destructive',
  RETURNED_TO_SELLER: 'secondary',
  DELIVERED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
};

/** Status badge for a seller suborder. */
export function SellerOrderStatusBadge({ status }: { status: SellerOrderStatus }) {
  return <Badge variant={VARIANTS[status]}>{SELLER_ORDER_STATUS_LABELS[status]}</Badge>;
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="text-right font-mono">{value}</span>
    </div>
  );
}

const minus = (amount: string) => `−${formatMoney(amount)}`;
const nonZero = (amount: string) => Number(amount) !== 0;

/**
 * Read-only view of one seller suborder: items with their price snapshots, shipping, buyer
 * address, totals and the commission computed at checkout. Shared by Seller Center and the
 * Admin Console; the data comes from the seller-order detail endpoints.
 */
export function SellerOrderView({
  order,
  actions,
  shipmentActions,
  refundActions,
  noteForm,
  returnLink,
}: {
  order: SellerOrderDetail;
  /** What the viewer can do now (accept, cancel, book...), shown above the summary. */
  actions?: ReactNode;
  shipmentActions?: (shipment: SellerOrderDetail['shipments'][number]) => ReactNode;
  refundActions?: (refund: SellerOrderDetail['refunds'][number]) => ReactNode;
  noteForm?: ReactNode;
  returnLink?: (returnId: string) => string;
}) {
  const commissionByItem = new Map(order.commission.items.map((c) => [c.orderItemId, c]));
  const request = order.cancellationRequest;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {request?.status === 'REQUESTED' ? (
          <Card className="border-warning">
            <CardHeader>
              <CardTitle className="text-base">The customer asked to cancel</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>“{request.reason}”</p>
              <p className="text-xs text-muted-foreground">{dateTime(request.createdAt)}</p>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {order.items.map((item) => {
              const commission = commissionByItem.get(item.id);
              return (
                <div key={item.id} className="flex gap-3">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-md border object-cover"
                    />
                  ) : (
                    <div className="size-14 shrink-0 rounded-md border bg-muted" />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.variantTitle} · <span className="font-mono">{item.sku}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} × {formatMoney(item.unitPrice)}
                      {item.unitPrice !== item.regularUnitPrice && (
                        <span className="line-through"> {formatMoney(item.regularUnitPrice)}</span>
                      )}{' '}
                      · {item.priceSource.toLowerCase().replaceAll('_', ' ')}
                    </p>
                    {commission && (
                      <p className="text-xs text-muted-foreground">
                        Commission {commission.ratePercent}% of {formatMoney(commission.base)} ={' '}
                        {formatMoney(commission.amount)}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-mono">{formatMoney(item.lineTotal)}</p>
                    {nonZero(item.sellerDiscount) && (
                      <p className="text-xs text-muted-foreground">
                        Store discount {minus(item.sellerDiscount)}
                      </p>
                    )}
                    {nonZero(item.platformDiscount) && (
                      <p className="text-xs text-muted-foreground">
                        Marketplace discount {minus(item.platformDiscount)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {order.shipping && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shipping</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Row label="Method" value={SHIPPING_METHOD_LABELS[order.shipping.method]} />
              <Row
                label="Carrier"
                value={`${order.shipping.carrier} · ${order.shipping.serviceName}`}
              />
              <Row label="Ships from" value={order.shipping.origin} />
              <Row
                label="Weight (chargeable)"
                value={`${(order.shipping.weightGrams / 1000).toFixed(2)} kg (${(
                  order.shipping.chargeableWeightGrams / 1000
                ).toFixed(2)} kg)`}
              />
              <Row
                label="Estimated delivery"
                value={`${order.shipping.etaMinDays}–${order.shipping.etaMaxDays} days`}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shipments</CardTitle>
          </CardHeader>
          <CardContent>
            <ShipmentList shipments={order.shipments} actions={shipmentActions} />
          </CardContent>
        </Card>

        {order.returns.length > 0 || order.refunds.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Returns and refunds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.returns.map((r) => (
                <p key={r.id} className="flex items-center justify-between text-sm">
                  {returnLink ? (
                    <a href={returnLink(r.id)} className="font-mono hover:underline">
                      {r.number}
                    </a>
                  ) : (
                    <span className="font-mono">{r.number}</span>
                  )}
                  <ReturnStatusBadge status={r.status} />
                </p>
              ))}
              <RefundList refunds={order.refunds} actions={refundActions} />
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages and notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <NoteList notes={order.notes} />
            {noteForm}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {order.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>
                    {ORDER_EVENT_LABELS[e.type]}
                    {e.note ? <span className="text-muted-foreground"> — {e.note}</span> : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{dateTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
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
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <div className="flex items-center justify-between pb-2">
              <SellerOrderStatusBadge status={order.status} />
              <Badge variant="outline">
                {order.buyerType === 'WHOLESALE' ? 'Wholesale' : 'Retail'}
              </Badge>
            </div>
            <Row label="Placed" value={dateTime(order.placedAt)} />
            <Row label="Payment" value={PAYMENT_METHOD_LABELS[order.paymentMethod]} />
            <Row label="Payment status" value={PAYMENT_STATUS_LABELS[order.paymentStatus]} />
            <Separator className="my-2" />
            <Row label="Items" value={formatMoney(order.itemsSubtotal)} />
            {nonZero(order.wholesaleSavings) && (
              <Row
                label="Wholesale savings (included)"
                value={formatMoney(order.wholesaleSavings)}
              />
            )}
            {nonZero(order.sellerDiscount) && (
              <Row label="Store coupon" value={minus(order.sellerDiscount)} />
            )}
            {nonZero(order.platformDiscount) && (
              <Row label="Marketplace coupon" value={minus(order.platformDiscount)} />
            )}
            <Row label="Shipping" value={formatMoney(order.shippingFee)} />
            {nonZero(order.shippingDiscount) && (
              <Row label="Shipping discount" value={minus(order.shippingDiscount)} />
            )}
            {order.charges.map((c) => (
              <Row key={c.code} label={c.label} value={formatMoney(c.amount)} />
            ))}
            <Separator className="my-2" />
            <Row label="Total paid by customer" value={formatMoney(order.total)} strong />
            <Row label="VAT included" value={formatMoney(order.vatAmount)} />
            <Row label="Commission" value={minus(order.commission.amount)} />
            {order.cod ? (
              <>
                <Separator className="my-2" />
                <Row label="Cash to collect" value={formatMoney(order.cod.expectedAmount)} />
                <Row
                  label="Cash on delivery"
                  value={COD_COLLECTION_STATUS_LABELS[order.cod.status]}
                />
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payables</CardTitle>
          </CardHeader>
          <CardContent>
            <LedgerList entries={order.ledger} />
          </CardContent>
        </Card>

        {order.coupons.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Coupons</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {order.coupons.map((c) => (
                <Row
                  key={c.code}
                  label={
                    <>
                      <span className="font-mono">{c.code}</span> ·{' '}
                      {c.scope === 'PLATFORM' ? 'marketplace-funded' : 'store-funded'} ·{' '}
                      {COUPON_TYPE_LABELS[c.type]}
                    </>
                  }
                  value={minus(c.amount)}
                />
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deliver to</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{order.address.recipientName}</p>
            <p className="text-muted-foreground">{order.address.mobile}</p>
            <p>{order.address.formatted}</p>
            <Separator className="my-2" />
            <p className="text-muted-foreground">
              Customer: {order.customer.name} · {order.customer.email}
            </p>
            {order.customerNote && <p>Note: {order.customerNote}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
