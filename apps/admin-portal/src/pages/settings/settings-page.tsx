import {
  toDisplayError,
  useAllCategories,
  usePlatformSettings,
  useSettingsMutations,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert } from '@marketplace/auth-ui';
import {
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@marketplace/shared-types';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  ErrorState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@marketplace/ui';
import {
  type CheckoutSettings,
  checkoutSettingsSchema,
  type CommissionRuleDto,
  type ShippingRates,
  shippingRatesSchema,
} from '@marketplace/validation';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { type FieldValues, type Path, useFieldArray, useForm } from 'react-hook-form';
import type { ZodType } from 'zod';
import { showError } from '../../lib/errors';

/** Validates with the shared schema; puts each problem on its field (dotted path). */
function validate<T, F extends FieldValues>(
  schema: ZodType<T>,
  body: unknown,
  setError: (path: Path<F>, message: string) => void,
  map: (path: string) => string = (p) => p,
): T | null {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    setError(map(issue.path.join('.')) as Path<F>, issue.message);
  }
  return null;
}

function SaveButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner className="text-primary-foreground" /> : null}
      Save changes
    </Button>
  );
}

// ---- Checkout -----------------------------------------------------------------------------

interface CheckoutValues {
  paymentWindowMinutes: string;
  paymentMethods: PaymentMethod[];
  charges: {
    code: string;
    label: string;
    type: 'FIXED' | 'PERCENT_OF_ITEMS';
    amount: string;
    paymentMethods: PaymentMethod[];
  }[];
}

function CheckoutForm({ settings }: { settings: CheckoutSettings }) {
  const { checkout } = useSettingsMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CheckoutValues>({
    defaultValues: {
      paymentWindowMinutes: String(settings.paymentWindowMinutes),
      paymentMethods: settings.paymentMethods,
      charges: settings.charges,
    },
  });
  const charges = useFieldArray({ control: form.control, name: 'charges' });

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    form.clearErrors();
    const body = validate<CheckoutSettings, CheckoutValues>(
      checkoutSettingsSchema,
      {
        charges: v.charges.map((c) => ({ ...c, code: c.code.trim().toUpperCase() })),
        paymentWindowMinutes: v.paymentWindowMinutes,
        paymentMethods: v.paymentMethods,
      },
      (path, message) => form.setError(path, { message }),
      (p) => p,
    );
    if (!body) return;
    try {
      await checkout.mutateAsync(body);
      toast.success('Checkout settings saved');
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} noValidate className="space-y-6">
        <FormAlert message={formError} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax</CardTitle>
            <CardDescription>
              Taxes come from versioned tax rules by seller registration (VAT-registered or not),
              managed in{' '}
              <Link className="underline" to="/finance/taxes">
                Finance › Taxes
              </Link>
              . Listed prices include the tax when the rule says so.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment</CardTitle>
            <CardDescription>
              Online methods create orders waiting for payment that hold stock until the window
              ends. Payment collection is connected in a later phase.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="paymentMethods"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Offered at checkout</FormLabel>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {PAYMENT_METHODS.map((m) => (
                      <Label key={m} className="flex items-center gap-2 font-normal">
                        <Checkbox
                          checked={field.value.includes(m)}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked
                                ? PAYMENT_METHODS.filter((x) => x === m || field.value.includes(x))
                                : field.value.filter((x) => x !== m),
                            )
                          }
                        />
                        {PAYMENT_METHOD_LABELS[m]}
                        {(ONLINE_PAYMENT_METHODS as readonly string[]).includes(m) ? (
                          <span className="text-xs text-muted-foreground">(online)</span>
                        ) : null}
                      </Label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paymentWindowMinutes"
              render={({ field }) => (
                <FormItem className="sm:max-w-xs">
                  <FormLabel>Payment window (minutes)</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" {...field} />
                  </FormControl>
                  <FormDescription>5 to 60. Unpaid orders are then cancelled.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Other charges</CardTitle>
            <CardDescription>
              Added to each seller’s part of an order, e.g. a COD handling fee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {charges.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extra charges.</p>
            ) : null}
            {charges.fields.map((row, index) => (
              <div key={row.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-12">
                <FormField
                  control={form.control}
                  name={`charges.${index}.code`}
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`charges.${index}.label`}
                  render={({ field }) => (
                    <FormItem className="sm:col-span-3">
                      <FormLabel>Label</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`charges.${index}.type`}
                  render={({ field }) => (
                    <FormItem className="sm:col-span-3">
                      <FormLabel>Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="FIXED">Fixed (₱)</SelectItem>
                          <SelectItem value="PERCENT_OF_ITEMS">% of items</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`charges.${index}.amount`}
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex items-end sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Remove charge"
                    onClick={() => charges.remove(index)}
                  >
                    <Trash2Icon /> Remove
                  </Button>
                </div>
                <FormField
                  control={form.control}
                  name={`charges.${index}.paymentMethods`}
                  render={({ field }) => (
                    <FormItem className="sm:col-span-12">
                      <FormLabel>Only for (none ticked: every method)</FormLabel>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {PAYMENT_METHODS.map((m) => (
                          <Label key={m} className="flex items-center gap-2 font-normal">
                            <Checkbox
                              checked={field.value.includes(m)}
                              onCheckedChange={(checked) =>
                                field.onChange(
                                  checked
                                    ? [...field.value, m]
                                    : field.value.filter((x) => x !== m),
                                )
                              }
                            />
                            {PAYMENT_METHOD_LABELS[m]}
                          </Label>
                        ))}
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={charges.fields.length >= 10}
              onClick={() =>
                charges.append({
                  code: '',
                  label: '',
                  type: 'FIXED',
                  amount: '0',
                  paymentMethods: [],
                })
              }
            >
              <PlusIcon /> Add a charge
            </Button>
          </CardContent>
        </Card>
        <SaveButton pending={checkout.isPending} />
      </form>
    </Form>
  );
}

// ---- Shipping rates -----------------------------------------------------------------------

interface RateValues {
  sameCity: string;
  sameRegion: string;
  sameIslandGroup: string;
  otherIslandGroup: string;
  perAdditionalKg: string;
  volumetricDivisor: string;
  expressMultiplier: string;
  sameDayFee: string;
}

const RATE_FIELDS: [keyof RateValues, string, string?][] = [
  ['sameCity', 'Same city (₱, first kg)'],
  ['sameRegion', 'Same region (₱, first kg)'],
  ['sameIslandGroup', 'Same island group (₱, first kg)', 'Luzon, Visayas or Mindanao'],
  ['otherIslandGroup', 'Other island group (₱, first kg)'],
  ['perAdditionalKg', 'Each additional kg (₱)'],
  ['volumetricDivisor', 'Volumetric divisor (cm³ per kg)', 'Usually 3500'],
  ['expressMultiplier', 'Express multiplier', 'e.g. 1.6 for 60% more'],
  ['sameDayFee', 'Same-day fee (₱)', 'Same city only; leave empty to not offer'],
];

function ShippingForm({ rates }: { rates: ShippingRates }) {
  const { shippingRates } = useSettingsMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RateValues>({
    defaultValues: {
      ...rates.base,
      perAdditionalKg: rates.perAdditionalKg,
      volumetricDivisor: String(rates.volumetricDivisor),
      expressMultiplier: rates.expressMultiplier,
      sameDayFee: rates.sameDayFee ?? '',
    },
  });
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    form.clearErrors();
    const body = validate<ShippingRates, RateValues>(
      shippingRatesSchema,
      {
        base: {
          sameCity: v.sameCity,
          sameRegion: v.sameRegion,
          sameIslandGroup: v.sameIslandGroup,
          otherIslandGroup: v.otherIslandGroup,
        },
        perAdditionalKg: v.perAdditionalKg,
        volumetricDivisor: v.volumetricDivisor,
        expressMultiplier: v.expressMultiplier,
        sameDayFee: v.sameDayFee.trim() || null,
      },
      (path, message) => form.setError(path, { message }),
      (p) => p.replace(/^base\./, ''),
    );
    if (!body) return;
    try {
      await shippingRates.mutateAsync(body);
      toast.success('Shipping rates saved');
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Shipping rates</CardTitle>
        <CardDescription>
          Used by the development shipping provider. The fee uses the heavier of the actual and
          volumetric weight. A real courier integration replaces this table later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormAlert message={formError} />
            </div>
            {RATE_FIELDS.map(([name, label, description]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" {...field} />
                    </FormControl>
                    {description ? <FormDescription>{description}</FormDescription> : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <div className="sm:col-span-2">
              <SaveButton pending={shippingRates.isPending} />
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ---- Commission ---------------------------------------------------------------------------

const DEFAULT_RULE = 'default';

function Commission({ rules }: { rules: CommissionRuleDto[] }) {
  const { putCommission, removeCommission } = useSettingsMutations();
  const categories = useAllCategories();
  const [categoryId, setCategoryId] = useState(DEFAULT_RULE);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const n = Number(rate);
    if (!/^\d+(\.\d{1,2})?$/.test(rate.trim()) || n > 100) {
      setError('Enter a percentage from 0 to 100, with at most 2 decimals');
      return;
    }
    try {
      await putCommission.mutateAsync({
        categoryId: categoryId === DEFAULT_RULE ? null : categoryId,
        ratePercent: rate.trim(),
      });
      toast.success('Commission rate saved');
      setRate('');
    } catch (e) {
      setError(toDisplayError(e)?.message ?? 'Could not save.');
    }
  };

  const sorted = [...rules].sort((a, b) =>
    a.category === null
      ? -1
      : b.category === null
        ? 1
        : a.category.path.join('/').localeCompare(b.category.path.join('/')),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Commission</CardTitle>
        <CardDescription>
          Charged on each item’s price after store discounts. A category’s rate applies to its
          subcategories unless they have their own; otherwise the default rate applies. Orders keep
          the rate in force when they were placed. Seller, product and fixed-amount rules,
          exemptions and scheduled changes are in{' '}
          <Link className="underline" to="/finance/commission">
            Finance › Commission
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ul className="divide-y rounded-md border">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>{r.category ? r.category.path.join(' › ') : 'Default (all categories)'}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono">{Number(r.ratePercent)}%</span>
                {r.category ? (
                  <ConfirmDialog
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${r.category.name} rate`}
                      >
                        <Trash2Icon />
                      </Button>
                    }
                    title={`Remove the ${r.category.name} rate?`}
                    description="Its products then use the parent category’s rate or the default."
                    confirmLabel="Remove"
                    onConfirm={async () => {
                      try {
                        await removeCommission.mutateAsync(r.id);
                      } catch (e) {
                        showError('Could not remove the rate', e);
                        throw e;
                      }
                    }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="commission-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="commission-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_RULE}>Default (all categories)</SelectItem>
                {(categories.data?.categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.path.join(' › ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="commission-rate">Rate (%)</Label>
            <Input
              id="commission-rate"
              inputMode="decimal"
              value={rate}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <Button onClick={() => void save()} disabled={putCommission.isPending}>
            Set rate
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Checkout, tax, shipping and commission settings. */
export function SettingsPage() {
  const settings = usePlatformSettings();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Marketplace settings"
        description="Changes apply to checkouts from now on. Placed orders keep the amounts they were placed with."
      />
      {settings.isPending ? (
        <LoadingState />
      ) : settings.isError ? (
        <ErrorState
          message={toDisplayError(settings.error)?.message ?? 'Could not load the settings.'}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <Tabs defaultValue="checkout">
          <TabsList aria-label="Settings section">
            <TabsTrigger value="checkout">Checkout and tax</TabsTrigger>
            <TabsTrigger value="shipping">Shipping</TabsTrigger>
            <TabsTrigger value="commission">Commission</TabsTrigger>
          </TabsList>
          <TabsContent value="checkout">
            <CheckoutForm settings={settings.data.checkout} />
          </TabsContent>
          <TabsContent value="shipping">
            <ShippingForm rates={settings.data.shippingRates} />
          </TabsContent>
          <TabsContent value="commission">
            <Commission rules={settings.data.commissionRules} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
