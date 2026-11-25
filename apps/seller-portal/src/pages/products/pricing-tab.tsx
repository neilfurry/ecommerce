import {
  hasPermission,
  useCustomerPriceMutations,
  useCustomerPrices,
  usePricePreview,
  useSession,
  useSetPriceTiers,
  useSetProductPricing,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert } from '@marketplace/auth-ui';
import { PRICE_SOURCE_LABELS } from '@marketplace/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  formatMoney,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@marketplace/ui';
import type { PriceQuoteLine, ProductDetail } from '@marketplace/validation';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const ALL = 'all';

/** Product pricing settings, wholesale tiers, customer prices and a price calculator. */
export function PricingTab({ product, editable }: { product: ProductDetail; editable: boolean }) {
  const session = useSession();
  const canPrice = editable && hasPermission(session.data, 'seller.pricing.manage');
  return (
    <div className="space-y-6">
      <PricingSettings product={product} canPrice={canPrice} />
      <TiersEditor product={product} canPrice={canPrice} />
      <CustomerPrices product={product} canPrice={canPrice} />
      <PriceCalculator product={product} />
    </div>
  );
}

function PricingSettings({ product, canPrice }: { product: ProductDetail; canPrice: boolean }) {
  const save = useSetProductPricing();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState({
    minOrderQuantity: String(product.minOrderQuantity),
    maxOrderQuantity: product.maxOrderQuantity ? String(product.maxOrderQuantity) : '',
    wholesaleEnabled: product.wholesaleEnabled,
    wholesaleMinOrderQuantity: String(product.wholesaleMinOrderQuantity),
  });
  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        productId: product.id,
        body: {
          currency: product.currency,
          minOrderQuantity: values.minOrderQuantity,
          maxOrderQuantity: values.maxOrderQuantity || null,
          wholesaleEnabled: values.wholesaleEnabled,
          wholesaleMinOrderQuantity: values.wholesaleMinOrderQuantity,
        },
      });
      toast.success('Pricing settings saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Order quantities and wholesale</h2>
        </CardTitle>
        <CardDescription>
          Retail prices are set on each variant. Wholesale prices apply only to approved wholesale
          customers. Prices are in
          {` ${product.currency}`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormAlert message={error} />
        <fieldset disabled={!canPrice} className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="moq">Minimum order quantity</Label>
            <Input
              id="moq"
              inputMode="numeric"
              value={values.minOrderQuantity}
              onChange={(e) => setValues({ ...values, minOrderQuantity: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="max-qty">Maximum per order (optional)</Label>
            <Input
              id="max-qty"
              inputMode="numeric"
              value={values.maxOrderQuantity}
              onChange={(e) => setValues({ ...values, maxOrderQuantity: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wholesale-moq">Wholesale minimum quantity</Label>
            <Input
              id="wholesale-moq"
              inputMode="numeric"
              value={values.wholesaleMinOrderQuantity}
              onChange={(e) => setValues({ ...values, wholesaleMinOrderQuantity: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-3">
            <Checkbox
              id="wholesale-enabled"
              checked={values.wholesaleEnabled}
              onCheckedChange={(v) => setValues({ ...values, wholesaleEnabled: v === true })}
            />
            <Label htmlFor="wholesale-enabled" className="font-normal">
              Sell this product at wholesale prices to approved wholesale customers
            </Label>
          </div>
        </fieldset>
        {canPrice ? (
          <Button onClick={() => void submit()} disabled={save.isPending}>
            Save settings
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface TierDraft {
  variantId: string;
  minQuantity: string;
  unitPrice: string;
  startsAt: string;
  endsAt: string;
}

function TiersEditor({ product, canPrice }: { product: ProductDetail; canPrice: boolean }) {
  const save = useSetPriceTiers();
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<TierDraft[]>(
    product.priceTiers.map((t) => ({
      variantId: t.variantId ?? ALL,
      minQuantity: String(t.minQuantity),
      unitPrice: t.unitPrice,
      startsAt: t.startsAt?.slice(0, 16) ?? '',
      endsAt: t.endsAt?.slice(0, 16) ?? '',
    })),
  );
  const update = (index: number, patch: Partial<TierDraft>) =>
    setTiers((list) => list.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync({
        productId: product.id,
        body: {
          tiers: tiers.map((t) => ({
            variantId: t.variantId === ALL ? null : t.variantId,
            minQuantity: t.minQuantity,
            unitPrice: t.unitPrice,
            startsAt: t.startsAt ? new Date(t.startsAt).toISOString() : null,
            endsAt: t.endsAt ? new Date(t.endsAt).toISOString() : null,
          })),
        },
      });
      toast.success('Wholesale tiers saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Wholesale price tiers</h2>
        </CardTitle>
        <CardDescription>
          The unit price from a quantity up, e.g. 1+ ₱500, 10+ ₱450, 50+ ₱420, 100+ ₱390. Tiers for
          one variant replace the ones for all variants. Leave the dates empty for tiers that always
          apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormAlert message={error} />
        {!product.wholesaleEnabled ? (
          <p className="text-sm text-muted-foreground">
            Turn on wholesale above for these tiers to apply.
          </p>
        ) : null}
        {tiers.length > 0 ? (
          <Table aria-label="Wholesale tiers">
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead>From quantity</TableHead>
                <TableHead>Unit price (₱)</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((t, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Select
                      value={t.variantId}
                      onValueChange={(v) => update(index, { variantId: v })}
                      disabled={!canPrice}
                    >
                      <SelectTrigger aria-label={`Tier ${index + 1} variant`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>All variants</SelectItem>
                        {product.variants.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Tier ${index + 1} from quantity`}
                      inputMode="numeric"
                      value={t.minQuantity}
                      onChange={(e) => update(index, { minQuantity: e.target.value })}
                      disabled={!canPrice}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Tier ${index + 1} unit price`}
                      inputMode="decimal"
                      value={t.unitPrice}
                      onChange={(e) => update(index, { unitPrice: e.target.value })}
                      disabled={!canPrice}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="datetime-local"
                      aria-label={`Tier ${index + 1} starts`}
                      value={t.startsAt}
                      onChange={(e) => update(index, { startsAt: e.target.value })}
                      disabled={!canPrice}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="datetime-local"
                      aria-label={`Tier ${index + 1} ends`}
                      value={t.endsAt}
                      onChange={(e) => update(index, { endsAt: e.target.value })}
                      disabled={!canPrice}
                    />
                  </TableCell>
                  <TableCell>
                    {canPrice ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove tier ${index + 1}`}
                        onClick={() => setTiers((l) => l.filter((_, i) => i !== index))}
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            No tiers: wholesale customers pay the retail price.
          </p>
        )}
        {canPrice ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setTiers((l) => [
                  ...l,
                  { variantId: ALL, minQuantity: '', unitPrice: '', startsAt: '', endsAt: '' },
                ])
              }
            >
              <PlusIcon /> Add tier
            </Button>
            <Button onClick={() => void submit()} disabled={save.isPending}>
              Save tiers
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CustomerPrices({ product, canPrice }: { product: ProductDetail; canPrice: boolean }) {
  const prices = useCustomerPrices(product.id);
  const { add, remove } = useCustomerPriceMutations(product.id);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{
    customerEmail: string;
    variantId: string;
    minQuantity: string;
    unitPrice: string;
    note: string;
  }>({
    defaultValues: { customerEmail: '', variantId: ALL, minQuantity: '1', unitPrice: '', note: '' },
  });
  const variantChoice = useWatch({ control: form.control, name: 'variantId' });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await add.mutateAsync({
        customerEmail: v.customerEmail,
        variantId: v.variantId === ALL ? null : v.variantId,
        minQuantity: v.minQuantity,
        unitPrice: v.unitPrice,
        note: v.note,
      });
      toast.success('Customer price added');
      form.reset();
    } catch (e) {
      setError(applyApiErrors(form, e) ?? (e as Error).message);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Customer prices</h2>
        </CardTitle>
        <CardDescription>
          A price agreed with one customer (by their account email). It takes precedence over every
          other price for them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(prices.data?.items ?? []).length > 0 ? (
          <Table aria-label="Customer prices">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>From qty</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Valid</TableHead>
                <TableHead>
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.data!.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p>{p.customer.name}</p>
                    <p className="text-xs text-muted-foreground">{p.customer.email}</p>
                  </TableCell>
                  <TableCell>{p.variantTitle ?? 'All variants'}</TableCell>
                  <TableCell>{p.minQuantity}</TableCell>
                  <TableCell>{formatMoney(p.unitPrice, product.currency)}</TableCell>
                  <TableCell className="text-xs">
                    {p.startsAt ? formatDateTime(p.startsAt) : 'Now'} –{' '}
                    {p.endsAt ? formatDateTime(p.endsAt) : 'no end'}
                  </TableCell>
                  <TableCell>
                    {canPrice ? (
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove price for ${p.customer.email}`}
                          >
                            <Trash2Icon />
                          </Button>
                        }
                        title="Remove this customer price?"
                        description={`${p.customer.name} will pay the normal price.`}
                        confirmLabel="Remove"
                        destructive
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync(p.id);
                          } catch (e) {
                            showError('Could not remove', e);
                            throw e;
                          }
                        }}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No customer prices.</p>
        )}
        {canPrice ? (
          <form
            onSubmit={submit}
            noValidate
            className="grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
          >
            <div className="sm:col-span-2 lg:col-span-5">
              <FormAlert message={error} />
            </div>
            <div className="grid gap-1.5 lg:col-span-2">
              <Label htmlFor="cp-email">Customer email</Label>
              <Input
                id="cp-email"
                type="email"
                {...form.register('customerEmail', { required: true })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-variant">Variant</Label>
              <Select value={variantChoice} onValueChange={(v) => form.setValue('variantId', v)}>
                <SelectTrigger id="cp-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All variants</SelectItem>
                  {product.variants.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-min">From quantity</Label>
              <Input id="cp-min" inputMode="numeric" {...form.register('minQuantity')} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-price">Unit price (₱)</Label>
              <Input id="cp-price" inputMode="decimal" {...form.register('unitPrice')} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="cp-note">Note (optional)</Label>
              <Input id="cp-note" {...form.register('note')} />
            </div>
            <Button type="submit" disabled={add.isPending}>
              Add price
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Asks the server what a buyer would pay (the same calculation checkout uses). */
function PriceCalculator({ product }: { product: ProductDetail }) {
  const preview = usePricePreview(product.id);
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [buyer, setBuyer] = useState<'RETAIL' | 'WHOLESALE'>('WHOLESALE');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<PriceQuoteLine | null>(null);
  const run = async () => {
    try {
      setResult(
        await preview.mutateAsync({
          variantId,
          quantity,
          buyer,
          customerEmail: email.trim() || undefined,
        }),
      );
    } catch (e) {
      setResult(null);
      showError('Could not calculate', e);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Price calculator</h2>
        </CardTitle>
        <CardDescription>
          Check what a buyer pays, using the same rules as checkout.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="calc-variant">Variant</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger id="calc-variant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {product.variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="calc-qty">Quantity</Label>
            <Input
              id="calc-qty"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="calc-buyer">Buyer</Label>
            <Select value={buyer} onValueChange={(v) => setBuyer(v as 'RETAIL' | 'WHOLESALE')}>
              <SelectTrigger id="calc-buyer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RETAIL">Retail customer</SelectItem>
                <SelectItem value="WHOLESALE">Wholesale customer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="calc-email">Customer email (optional)</Label>
            <Input
              id="calc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button onClick={() => void run()} disabled={preview.isPending || !variantId}>
            Calculate
          </Button>
        </div>
        {result ? (
          <dl
            className="grid gap-2 rounded-md border p-4 text-sm sm:grid-cols-3"
            aria-live="polite"
          >
            <div>
              <dt className="text-muted-foreground">Unit price</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(result.unitPrice, result.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-lg font-semibold">
                {formatMoney(result.lineTotal, result.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rule applied</dt>
              <dd>
                {PRICE_SOURCE_LABELS[result.source]}
                {result.rule?.minQuantity ? ` (from ${result.rule.minQuantity})` : ''}
              </dd>
            </div>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
