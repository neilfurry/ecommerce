import {
  ApiError,
  toDisplayError,
  useAddresses,
  useCheckoutQuote,
  usePlaceOrder,
} from '@marketplace/api-client';
import {
  ONLINE_PAYMENT_METHODS,
  type PaymentMethod,
  type ShippingMethod,
} from '@marketplace/shared-types';
import type { CheckoutQuote, CheckoutRequest } from '@marketplace/validation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  formatMoney,
  Input,
  Label,
  PageHeader,
  Separator,
  Skeleton,
  Textarea,
  toast,
} from '@marketplace/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, ImageIcon, MapPinIcon, StoreIcon, TagIcon, XIcon } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AddressForm } from '../../components/shop/address-form';

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'save';
}) {
  return (
    <div
      className={`flex justify-between gap-4 ${strong ? 'text-base font-semibold' : ''} ${tone === 'save' ? 'text-emerald-700' : ''}`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Totals({ quote }: { quote: CheckoutQuote }) {
  const t = quote.totals;
  return (
    <dl className="space-y-1.5 text-sm" aria-label="Order total">
      <Row label="Items" value={formatMoney(t.itemsSubtotal)} />
      {Number(t.wholesaleSavings) > 0 ? (
        <Row
          label="Wholesale savings (included)"
          value={formatMoney(t.wholesaleSavings)}
          tone="save"
        />
      ) : null}
      {Number(t.couponDiscount) > 0 ? (
        <Row label="Coupon discounts" value={`−${formatMoney(t.couponDiscount)}`} tone="save" />
      ) : null}
      <Row label="Shipping" value={formatMoney(t.shippingFee)} />
      {Number(t.shippingDiscount) > 0 ? (
        <Row label="Shipping discount" value={`−${formatMoney(t.shippingDiscount)}`} tone="save" />
      ) : null}
      {Number(t.chargesTotal) > 0 ? (
        <Row label="Other charges" value={formatMoney(t.chargesTotal)} />
      ) : null}
      <Separator className="my-2" />
      <Row label="Total" value={formatMoney(t.grandTotal)} strong />
      {Number(t.vatAmount) > 0 ? (
        <p className="text-xs text-muted-foreground">
          {quote.vat.included ? 'Includes' : 'Plus'} VAT of {formatMoney(t.vatAmount)}
          {quote.vat.rate !== null
            ? ` (${Number((Number(quote.vat.rate) * 100).toFixed(2))}%)`
            : ''}
          .
        </p>
      ) : null}
    </dl>
  );
}

/**
 * Checkout: address, delivery per seller, coupons, payment. Every amount shown comes from
 * POST /checkout/quote; placing the order sends the same choices and the total shown, which
 * the server only compares with its own calculation.
 */
export function CheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const buyVariant = params.get('buy');
  const buyQuantity = Math.max(1, Number(params.get('qty') ?? '1') || 1);
  const addresses = useAddresses();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [shipping, setShipping] = useState<Record<string, ShippingMethod>>({});
  const [couponCodes, setCouponCodes] = useState<string[]>([]);
  const [couponInput, setCouponInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const place = usePlaceOrder();
  const attempt = useRef<{ key: string; body: string } | null>(null);

  const chosenAddress =
    addressId ?? addresses.data?.find((a) => a.isDefault)?.id ?? addresses.data?.[0]?.id ?? null;
  const body: CheckoutRequest = useMemo(
    () => ({
      ...(buyVariant ? { buyNow: { variantId: buyVariant, quantity: buyQuantity } } : {}),
      addressId: chosenAddress,
      shipping: Object.entries(shipping).map(([sellerId, method]) => ({ sellerId, method })),
      couponCodes,
      paymentMethod,
    }),
    [buyVariant, buyQuantity, chosenAddress, shipping, couponCodes, paymentMethod],
  );
  const quote = useCheckoutQuote(body, !addresses.isPending);
  const q = quote.data;

  const applyCoupon = (event: FormEvent) => {
    event.preventDefault();
    const code = couponInput.trim().toUpperCase();
    if (code && !couponCodes.includes(code)) setCouponCodes([...couponCodes, code]);
    setCouponInput('');
  };

  const placeOrder = async () => {
    if (!q || !chosenAddress) return;
    const payload = {
      ...(buyVariant ? { buyNow: { variantId: buyVariant, quantity: buyQuantity } } : {}),
      addressId: chosenAddress,
      shipping: q.groups.flatMap((g) =>
        g.shipping.selected ? [{ sellerId: g.sellerId, method: g.shipping.selected.method }] : [],
      ),
      couponCodes: q.coupons.filter((c) => c.status === 'APPLIED').map((c) => c.code),
      paymentMethod,
      notes: Object.entries(notes)
        .filter(([, note]) => note.trim())
        .map(([sellerId, note]) => ({ sellerId, note })),
      expectedGrandTotal: q.totals.grandTotal,
    };
    // One key per attempt: retrying the same order reuses it, so it is never placed twice.
    const serialized = JSON.stringify(payload);
    if (!attempt.current || attempt.current.body !== serialized)
      attempt.current = { key: newKey(), body: serialized };
    try {
      const order = await place.mutateAsync({ body: payload, idempotencyKey: attempt.current.key });
      // Online payments continue on the provider's page (the mock's test page locally).
      const checkoutUrl = order.payment.attempts.find((a) => a.checkoutUrl)?.checkoutUrl;
      if (order.status === 'AWAITING_PAYMENT' && checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      void navigate(`/account/orders/${order.id}?placed=1`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CHECKOUT_CHANGED') {
        toast.warning(error.message);
        attempt.current = null;
        await queryClient.invalidateQueries({ queryKey: ['shop', 'checkout'] });
      } else {
        toast.error(toDisplayError(error)?.message ?? 'The order could not be placed.');
      }
    }
  };

  if (addresses.isPending || (quote.isPending && !q)) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-label="Loading checkout">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (quote.isError && !q) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState
          message={toDisplayError(quote.error)?.message ?? 'Checkout could not be loaded.'}
          onRetry={() => void quote.refetch()}
        />
      </div>
    );
  }
  if (!q) return null;
  const empty = q.groups.length === 0;
  const blocking = q.problems.filter((p) => !(p.path === 'addressId' && addingAddress));
  const online = ONLINE_PAYMENT_METHODS.includes(paymentMethod);
  const windowMinutes = q.paymentMethods.find(
    (m) => m.method === paymentMethod,
  )?.paymentWindowMinutes;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Checkout"
        description={buyVariant ? 'Buying one item now.' : 'Review your order from every store.'}
      />
      {empty ? (
        <Alert>
          <AlertTitle>Nothing to check out</AlertTitle>
          <AlertDescription>
            Your cart is empty.{' '}
            <Link to="/search" className="underline">
              Continue shopping
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPinIcon className="size-4" aria-hidden="true" /> Delivery address
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {addresses.data && addresses.data.length > 0 && !addingAddress ? (
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Choose a delivery address</legend>
                    {addresses.data.map((a) => (
                      <label
                        key={a.id}
                        className="flex cursor-pointer gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                      >
                        <input
                          type="radio"
                          name="address"
                          value={a.id}
                          checked={chosenAddress === a.id}
                          onChange={() => setAddressId(a.id)}
                          className="mt-1"
                        />
                        <span className="text-sm">
                          <span className="font-medium">{a.recipientName}</span> · {a.mobile}
                          {a.label ? (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                              {a.label}
                            </span>
                          ) : null}
                          <span className="block text-muted-foreground">{a.formatted}</span>
                        </span>
                      </label>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => setAddingAddress(true)}>
                      Add a new address
                    </Button>
                  </fieldset>
                ) : (
                  <AddressForm
                    submitLabel="Save and deliver here"
                    onSaved={(a) => {
                      setAddressId(a.id);
                      setAddingAddress(false);
                    }}
                  />
                )}
              </CardContent>
            </Card>

            {q.groups.map((group, index) => (
              <Card key={group.sellerId}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      <StoreIcon className="size-4" aria-hidden="true" /> Package {index + 1} of{' '}
                      {q.groups.length}: {group.store.name}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {formatMoney(group.total)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="divide-y">
                    {group.lines.map((line) => (
                      <li key={line.variantId} className="flex gap-3 py-3 first:pt-0">
                        <span className="size-16 shrink-0 overflow-hidden rounded border bg-muted">
                          {line.imageUrl ? (
                            <img src={line.imageUrl} alt="" className="size-full object-cover" />
                          ) : (
                            <ImageIcon
                              className="m-auto mt-5 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-medium">{line.productName}</p>
                          <p className="text-muted-foreground">
                            {line.variantTitle !== 'Default' ? `${line.variantTitle} · ` : ''}
                            {line.quantity} × {formatMoney(line.price.unitPrice)}
                            {line.price.source === 'WHOLESALE_TIER'
                              ? ' (wholesale)'
                              : line.price.source === 'FLASH_SALE'
                                ? ' (flash sale)'
                                : ''}
                          </p>
                        </div>
                        <p className="text-sm font-medium">{formatMoney(line.price.lineTotal)}</p>
                      </li>
                    ))}
                  </ul>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">
                      Delivery{' '}
                      {group.shipping.origin ? (
                        <span className="font-normal text-muted-foreground">
                          from {group.shipping.origin}
                        </span>
                      ) : null}
                    </legend>
                    {group.shipping.options.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Choose an address to see delivery options.
                      </p>
                    ) : (
                      group.shipping.options.map((o) => (
                        <label
                          key={o.method}
                          className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                        >
                          <input
                            type="radio"
                            name={`shipping-${group.sellerId}`}
                            checked={group.shipping.selected?.method === o.method}
                            onChange={() =>
                              setShipping({ ...shipping, [group.sellerId]: o.method })
                            }
                          />
                          <span className="flex-1">
                            <span className="font-medium">{o.label}</span>
                            <span className="block text-muted-foreground">
                              {o.etaMaxDays === 0
                                ? 'Arrives today'
                                : `Arrives in ${o.etaMinDays}–${o.etaMaxDays} days`}{' '}
                              · {o.carrier}
                            </span>
                          </span>
                          <span className="font-medium">{formatMoney(o.fee)}</span>
                        </label>
                      ))
                    )}
                    <p className="text-xs text-muted-foreground">
                      Package weight {(group.shipping.chargeableWeightGrams / 1000).toFixed(1)} kg
                      (the larger of actual and size-based weight).
                    </p>
                  </fieldset>
                  <div className="space-y-1">
                    <Label htmlFor={`note-${group.sellerId}`}>
                      Note to {group.store.name} (optional)
                    </Label>
                    <Textarea
                      id={`note-${group.sellerId}`}
                      rows={2}
                      maxLength={500}
                      value={notes[group.sellerId] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [group.sellerId]: e.target.value })}
                    />
                  </div>
                  {Number(group.sellerDiscount) +
                    Number(group.shipping.sellerDiscount) +
                    Number(group.platformDiscount) >
                  0 ? (
                    <p className="text-sm text-emerald-700">
                      Discounts on this package: −
                      {formatMoney(
                        (
                          Number(group.sellerDiscount) +
                          Number(group.platformDiscount) +
                          Number(group.shipping.sellerDiscount) +
                          Number(group.shipping.platformDiscount)
                        ).toFixed(2),
                      )}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment</CardTitle>
              </CardHeader>
              <CardContent>
                <fieldset className="grid gap-2 sm:grid-cols-2">
                  <legend className="sr-only">Payment method</legend>
                  {q.paymentMethods.map((m) => (
                    <label
                      key={m.method}
                      className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    >
                      <input
                        type="radio"
                        name="payment"
                        checked={paymentMethod === m.method}
                        disabled={!!m.unavailableReason && paymentMethod !== m.method}
                        onChange={() => setPaymentMethod(m.method)}
                      />
                      <span>
                        {m.label}
                        {m.unavailableReason ? (
                          <span className="block text-xs text-muted-foreground">
                            {m.unavailableReason}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
                {online ? (
                  <Alert className="mt-3">
                    <AlertDescription>
                      {paymentMethod === 'BANK_TRANSFER'
                        ? `After placing the order you get the bank details and a reference. Transfer within ${Math.round((windowMinutes ?? 0) / 60)} hours and upload the receipt; unpaid orders are cancelled automatically.`
                        : `After placing the order you pay on the payment provider’s page. Orders not paid within ${windowMinutes} minutes are cancelled automatically.`}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={applyCoupon} className="space-y-2">
                <Label htmlFor="coupon">Coupon code</Label>
                <div className="flex gap-2">
                  <Input
                    id="coupon"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    autoCapitalize="characters"
                    placeholder="e.g. WELCOME100"
                  />
                  <Button type="submit" variant="outline">
                    Apply
                  </Button>
                </div>
              </form>
              {q.coupons.length > 0 ? (
                <ul className="space-y-2" aria-label="Coupons">
                  {q.coupons.map((c) => (
                    <li
                      key={c.code}
                      className="flex items-start gap-2 rounded-md border p-2 text-sm"
                    >
                      {c.status === 'APPLIED' ? (
                        <CheckCircle2Icon
                          className="mt-0.5 size-4 shrink-0 text-emerald-600"
                          aria-hidden="true"
                        />
                      ) : (
                        <TagIcon
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <span className="flex-1">
                        <span className="font-medium">{c.code}</span>
                        {c.status === 'APPLIED' ? (
                          <span className="block text-emerald-700">
                            −{formatMoney(c.amount)} {c.name ? `· ${c.name}` : ''}
                          </span>
                        ) : (
                          <span className="block text-destructive">{c.message}</span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove coupon ${c.code}`}
                        onClick={() => setCouponCodes(couponCodes.filter((x) => x !== c.code))}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Separator />
              <Totals quote={q} />
              {blocking.length > 0 ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {blocking.map((p) => (
                        <li key={`${p.path}-${p.message}`}>{p.message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button
                className="w-full"
                size="lg"
                disabled={
                  blocking.length > 0 ||
                  place.isPending ||
                  quote.isFetching ||
                  !chosenAddress ||
                  addingAddress ||
                  q.coupons.some((c) => c.status === 'NOT_APPLIED')
                }
                onClick={() => void placeOrder()}
              >
                {place.isPending
                  ? 'Placing order…'
                  : `Place order · ${formatMoney(q.totals.grandTotal)}`}
              </Button>
              {q.coupons.some((c) => c.status === 'NOT_APPLIED') ? (
                <p className="text-xs text-muted-foreground">
                  Remove the coupons that cannot be used to continue.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
