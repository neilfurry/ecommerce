import { zodResolver } from '@hookform/resolvers/zod';
import {
  hasPermission,
  useSession,
  useSetProductOptions,
  useUpdateVariant,
} from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { MAX_PRODUCT_OPTIONS, SUGGESTED_OPTION_NAMES } from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  formatMoney,
  Input,
  Label,
  toast,
} from '@marketplace/ui';
import {
  type ProductDetail,
  type UpdateVariantRequest,
  updateVariantSchema,
  type VariantDto,
} from '@marketplace/validation';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { showError } from '../../lib/errors';

interface OptionDraft {
  name: string;
  values: string;
}

const split = (values: string) =>
  values
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** Options (Size × Color...) and the variants generated from them. */
export function VariantsTab({ product, editable }: { product: ProductDetail; editable: boolean }) {
  const session = useSession();
  const canPrice = hasPermission(session.data, 'seller.pricing.manage');
  const [editing, setEditing] = useState<VariantDto | null>(null);

  const columns: DataTableColumn<VariantDto>[] = [
    {
      id: 'variant',
      header: 'Variant',
      cell: (v) => (
        <div>
          <p className="font-medium">{v.title}</p>
          <p className="font-mono text-xs text-muted-foreground">{v.sku}</p>
        </div>
      ),
    },
    {
      id: 'price',
      header: 'Price',
      cell: (v) =>
        v.salePrice ? (
          <span>
            {formatMoney(v.salePrice, product.currency)}{' '}
            <s className="text-xs text-muted-foreground">
              {formatMoney(v.regularPrice, product.currency)}
            </s>
          </span>
        ) : (
          formatMoney(v.regularPrice, product.currency)
        ),
    },
    {
      id: 'stock',
      header: 'Available',
      cell: (v) =>
        v.trackInventory ? `${v.stock.available} (${v.stock.reserved} held)` : 'Not tracked',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (v) => (
        <Badge variant={v.status === 'ACTIVE' ? 'success' : 'secondary'}>
          {v.status === 'ACTIVE' ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    ...(editable
      ? [
          {
            id: 'edit',
            header: <span className="sr-only">Actions</span>,
            cell: (v: VariantDto) => (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(v)}
                aria-label={`Edit ${v.title}`}
              >
                <PencilIcon /> Edit
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {editable ? <OptionsEditor product={product} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Variants ({product.variants.length})</h2>
          </CardTitle>
          <CardDescription>Each variant has its own SKU, price and stock.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Variants"
            columns={columns}
            rows={product.variants}
            getRowId={(v) => v.id}
            isLoading={false}
            empty={{ title: 'No variants' }}
          />
        </CardContent>
      </Card>
      {editing ? (
        <VariantDialog
          product={product}
          variant={editing}
          canPrice={canPrice}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function OptionsEditor({ product }: { product: ProductDetail }) {
  const setOptions = useSetProductOptions();
  const [options, setDrafts] = useState<OptionDraft[]>(
    product.options.map((o) => ({ name: o.name, values: o.values.map((v) => v.value).join(', ') })),
  );
  const [skuPrefix, setSkuPrefix] = useState(product.variants[0]?.sku.split('-')[0] ?? 'SKU');
  const [price, setPrice] = useState(product.variants[0]?.regularPrice ?? '');
  const [error, setError] = useState<string | null>(null);

  const combinations = useMemo(
    () => options.reduce((n, o) => n * Math.max(split(o.values).length, 1), 1),
    [options],
  );
  const update = (index: number, patch: Partial<OptionDraft>) =>
    setDrafts((list) => list.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  const save = async () => {
    setError(null);
    try {
      const saved = await setOptions.mutateAsync({
        productId: product.id,
        body: {
          options: options
            .filter((o) => o.name.trim())
            .map((o) => ({ name: o.name.trim(), values: split(o.values) })),
          generate: { skuPrefix, regularPrice: price },
        },
      });
      toast.success(`${saved.variants.length} variant${saved.variants.length === 1 ? '' : 's'}`, {
        description: 'New combinations were created with the price and SKU prefix you gave.',
      });
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      showError('Could not save the options', e);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Options</h2>
        </CardTitle>
        <CardDescription>
          Up to {MAX_PRODUCT_OPTIONS} options, e.g. Size: S, M, L and Color: Red, Blue. Saving
          creates a variant for every combination; variants for removed values are deleted (unless
          they have stock records).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormAlert message={error} />
        <datalist id="option-names">
          {SUGGESTED_OPTION_NAMES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {options.map((option, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor={`option-name-${index}`}>Option {index + 1}</Label>
              <Input
                id={`option-name-${index}`}
                list="option-names"
                value={option.name}
                placeholder="Size"
                onChange={(e) => update(index, { name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`option-values-${index}`}>Values, separated by commas</Label>
              <Input
                id={`option-values-${index}`}
                value={option.values}
                placeholder="S, M, L"
                onChange={(e) => update(index, { values: e.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove option ${index + 1}`}
              onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {options.length < MAX_PRODUCT_OPTIONS ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDrafts((l) => [...l, { name: '', values: '' }])}
          >
            <PlusIcon /> Add option
          </Button>
        ) : null}
        <div className="grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sku-prefix">SKU prefix for new variants</Label>
            <Input
              id="sku-prefix"
              className="font-mono"
              value={skuPrefix}
              onChange={(e) => setSkuPrefix(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">e.g. TEE → TEE-M-RED</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-price">Price for new variants (₱)</Label>
            <Input
              id="new-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={setOptions.isPending}>
            Save options
          </Button>
          <span className="text-sm text-muted-foreground">{combinations} combination(s)</span>
        </div>
      </CardContent>
    </Card>
  );
}

function VariantDialog({
  product,
  variant,
  canPrice,
  onClose,
}: {
  product: ProductDetail;
  variant: VariantDto;
  canPrice: boolean;
  onClose: () => void;
}) {
  const update = useUpdateVariant();
  const [formError, setFormError] = useState<string | null>(null);
  const local = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
  const form = useForm<
    UpdateVariantRequest & { saleStartsAt?: string | null; saleEndsAt?: string | null }
  >({
    resolver: zodResolver(updateVariantSchema) as never,
    defaultValues: {
      sku: variant.sku,
      barcode: variant.barcode,
      regularPrice: variant.regularPrice,
      salePrice: variant.salePrice,
      saleStartsAt: local(variant.saleStartsAt),
      saleEndsAt: local(variant.saleEndsAt),
      trackInventory: variant.trackInventory,
      weightGrams: variant.weightGrams,
      lengthCm: variant.lengthCm,
      widthCm: variant.widthCm,
      heightCm: variant.heightCm,
      status: variant.status,
    },
  });
  const submit = form.handleSubmit(async (raw) => {
    setFormError(null);
    const toIso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
    const values = {
      ...raw,
      barcode: raw.barcode || null,
      salePrice: raw.salePrice || null,
      saleStartsAt: toIso(raw.saleStartsAt),
      saleEndsAt: toIso(raw.saleEndsAt),
      lengthCm: raw.lengthCm || null,
      widthCm: raw.widthCm || null,
      heightCm: raw.heightCm || null,
    };
    const body = canPrice
      ? values
      : Object.fromEntries(
          Object.entries(values).filter(
            ([k]) => !['regularPrice', 'salePrice', 'saleStartsAt', 'saleEndsAt'].includes(k),
          ),
        );
    try {
      await update.mutateAsync({ productId: product.id, variantId: variant.id, body });
      toast.success(`${variant.title} saved`);
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });
  const field = (
    name:
      | 'sku'
      | 'barcode'
      | 'regularPrice'
      | 'salePrice'
      | 'weightGrams'
      | 'lengthCm'
      | 'widthCm'
      | 'heightCm'
      | 'saleStartsAt'
      | 'saleEndsAt',
    label: string,
    options: { type?: string; disabled?: boolean; description?: string; mono?: boolean } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...f}
              type={options.type}
              className={options.mono ? 'font-mono' : undefined}
              value={(f.value as string | number | null | undefined) ?? ''}
              onChange={(e) =>
                f.onChange(
                  name === 'weightGrams'
                    ? e.target.value === ''
                      ? null
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
              disabled={options.disabled}
            />
          </FormControl>
          {options.description ? <FormDescription>{options.description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {variant.title}</DialogTitle>
          <DialogDescription>Price and stock changes do not need approval.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="space-y-4">
            <FormAlert message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              {field('sku', 'SKU', { mono: true })}
              {field('barcode', 'Barcode (optional)', { mono: true })}
            </div>
            <fieldset
              className="grid gap-4 rounded-md border p-4 sm:grid-cols-2"
              disabled={!canPrice}
            >
              <legend className="px-1 text-sm font-medium">
                Price{canPrice ? '' : ' (needs the pricing permission)'}
              </legend>
              {field('regularPrice', 'Regular price (₱)', { disabled: !canPrice })}
              {field('salePrice', 'Sale price (₱, optional)', { disabled: !canPrice })}
              {field('saleStartsAt', 'Sale starts', {
                type: 'datetime-local',
                disabled: !canPrice,
                description: 'Empty: now',
              })}
              {field('saleEndsAt', 'Sale ends', {
                type: 'datetime-local',
                disabled: !canPrice,
                description: 'Empty: until removed',
              })}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-4">
              {field('weightGrams', 'Weight (g)')}
              {field('lengthCm', 'Length (cm)')}
              {field('widthCm', 'Width (cm)')}
              {field('heightCm', 'Height (cm)')}
            </div>
            <div className="flex flex-wrap gap-6">
              <FormField
                control={form.control}
                name="trackInventory"
                render={({ field: f }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={!!f.value}
                        onCheckedChange={(v) => f.onChange(v === true)}
                      />
                    </FormControl>
                    <Label className="font-normal">Track stock</Label>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field: f }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={f.value === 'ACTIVE'}
                        onCheckedChange={(v) => f.onChange(v === true ? 'ACTIVE' : 'INACTIVE')}
                      />
                    </FormControl>
                    <Label className="font-normal">For sale</Label>
                  </FormItem>
                )}
              />
            </div>
            <SubmitButton pending={update.isPending}>Save variant</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
