import { toDisplayError } from '@marketplace/api-client';
import {
  COUPON_TYPE_LABELS,
  COUPON_TYPES,
  type CouponType,
  type PromotionStatus,
} from '@marketplace/shared-types';
import {
  Badge,
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@marketplace/ui';
import {
  type CouponDto,
  type CouponInput,
  couponInputSchema,
  type UpdateCouponRequest,
  updateCouponSchema,
} from '@marketplace/validation';
import { PencilIcon, PlusIcon, TicketPercentIcon } from 'lucide-react';
import { useState } from 'react';
import { type Path, useForm, useWatch } from 'react-hook-form';
import type { ZodType } from 'zod';
import { applyApiErrors } from './form-errors';
import { FormAlert, SubmitButton } from './pages';
import { TargetPicker, type TargetOptions, type TargetValue } from './promotion-targets';

/** Form fields as typed into the inputs; converted to the API shape on submit. */
interface CouponFormValues {
  code: string;
  name: string;
  description: string;
  type: CouponType;
  value: string;
  maxDiscount: string;
  minSpend: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perCustomerLimit: string;
  status: PromotionStatus;
  firstOrderOnly: boolean;
}

/** ISO → the value a datetime-local input shows (in the browser's time zone). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

function defaults(coupon: CouponDto | null): CouponFormValues {
  const now = new Date();
  const inAMonth = new Date(now.getTime() + 30 * 24 * 3600_000);
  return {
    code: coupon?.code ?? '',
    name: coupon?.name ?? '',
    description: coupon?.description ?? '',
    type: coupon?.type ?? 'PERCENTAGE',
    value: coupon?.value ?? '',
    maxDiscount: coupon?.maxDiscount ?? '',
    minSpend: coupon?.minSpend ?? '0',
    startsAt: toLocalInput(coupon?.startsAt ?? now.toISOString()),
    endsAt: toLocalInput(coupon?.endsAt ?? inAMonth.toISOString()),
    usageLimit: coupon?.usageLimit ? String(coupon.usageLimit) : '',
    perCustomerLimit: String(coupon?.perCustomerLimit ?? 1),
    status: coupon?.status ?? 'ACTIVE',
    firstOrderOnly: coupon?.firstOrderOnly ?? false,
  };
}

/** Validates with the shared schema; puts each problem on its field. */
function check<T>(
  schema: ZodType<T>,
  body: unknown,
  setError: (field: Path<CouponFormValues>, message: string) => void,
): T | null {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    setError(String(issue.path[0] ?? 'name') as Path<CouponFormValues>, issue.message);
  }
  return null;
}

export interface CouponMutations {
  create: (body: CouponInput) => Promise<unknown>;
  update: (id: string, body: UpdateCouponRequest) => Promise<unknown>;
  pending: boolean;
}

function CouponDialog({
  coupon,
  mutations,
  fundedBy,
  targets,
  onClose,
}: {
  coupon: CouponDto | null;
  mutations: CouponMutations;
  fundedBy: string;
  targets: TargetOptions;
  onClose: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [target, setTarget] = useState<TargetValue>({
    appliesTo: coupon?.appliesTo ?? 'ALL',
    productIds: coupon?.products.map((p) => p.id) ?? [],
    categoryIds: coupon?.categories.map((c) => c.id) ?? [],
  });
  const [targetError, setTargetError] = useState<string | undefined>();
  const form = useForm<CouponFormValues>({ defaultValues: defaults(coupon) });
  const type = useWatch({ control: form.control, name: 'type' });
  const editing = coupon !== null;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    form.clearErrors();
    const setError = (field: Path<CouponFormValues>, message: string) =>
      form.setError(field, { message });
    const common = {
      name: v.name,
      description: v.description.trim() || null,
      endsAt: toIso(v.endsAt),
      usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
      perCustomerLimit: Number(v.perCustomerLimit),
      status: v.status,
      firstOrderOnly: v.firstOrderOnly,
      ...target,
    };
    setTargetError(undefined);
    if (
      target.appliesTo !== 'ALL' &&
      (target.appliesTo === 'PRODUCTS' ? target.productIds : target.categoryIds).length === 0
    ) {
      setTargetError('Choose at least one');
      return;
    }
    try {
      if (coupon) {
        const body = check(updateCouponSchema, common, setError);
        if (!body) return;
        await mutations.update(coupon.id, body);
      } else {
        const body = check(
          couponInputSchema,
          {
            ...common,
            code: v.code,
            type: v.type,
            value: v.type === 'FREE_SHIPPING' ? '0' : v.value,
            maxDiscount: v.type === 'PERCENTAGE' && v.maxDiscount ? v.maxDiscount : null,
            minSpend: v.minSpend || '0',
            startsAt: toIso(v.startsAt),
          },
          setError,
        );
        if (!body) return;
        await mutations.create(body as CouponInput);
      }
      toast.success(editing ? 'Coupon saved' : 'Coupon created');
      onClose();
    } catch (error) {
      setFormError(applyApiErrors(form, error) ?? toDisplayError(error)?.message ?? null);
    }
  });

  const text = (
    name: Exclude<Path<CouponFormValues>, 'firstOrderOnly'>,
    label: string,
    options: {
      type?: string;
      description?: string;
      disabled?: boolean;
      inputMode?: 'decimal' | 'numeric';
      className?: string;
    } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={options.className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={String(field.value)}
              type={options.type ?? 'text'}
              inputMode={options.inputMode}
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${coupon.code}` : 'New coupon'}</DialogTitle>
          <DialogDescription>
            Discounts from this coupon are funded by {fundedBy}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormAlert message={formError} />
            </div>
            {text('code', 'Code', {
              disabled: editing,
              description: 'Letters and numbers customers type at checkout',
            })}
            {text('name', 'Name')}
            {text('description', 'Description (optional)', { className: 'sm:col-span-2' })}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {COUPON_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {COUPON_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {type !== 'FREE_SHIPPING'
              ? text('value', type === 'PERCENTAGE' ? 'Percent off' : 'Amount off (₱)', {
                  disabled: editing,
                  inputMode: 'decimal',
                })
              : null}
            {type === 'PERCENTAGE'
              ? text('maxDiscount', 'Maximum discount (₱, optional)', {
                  disabled: editing,
                  inputMode: 'decimal',
                })
              : null}
            {text('minSpend', 'Minimum spend (₱)', { disabled: editing, inputMode: 'decimal' })}
            {text('startsAt', 'Starts', { type: 'datetime-local', disabled: editing })}
            {text('endsAt', 'Ends', { type: 'datetime-local' })}
            {text('usageLimit', 'Total uses (optional)', {
              inputMode: 'numeric',
              description: 'Leave empty for no limit',
            })}
            {text('perCustomerLimit', 'Uses per customer', { inputMode: 'numeric' })}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Paused</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <TargetPicker
              value={target}
              onChange={setTarget}
              options={targets}
              error={targetError}
            />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" {...form.register('firstOrderOnly')} />
              First order only (customers with no earlier order)
            </label>
            <div className="sm:col-span-2">
              <SubmitButton pending={mutations.pending}>
                {editing ? 'Save' : 'Create coupon'}
              </SubmitButton>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function describeValue(c: CouponDto) {
  if (c.type === 'FREE_SHIPPING') return 'Free shipping';
  const off =
    c.type === 'PERCENTAGE'
      ? `${Number(c.value)}% off${c.maxDiscount ? ` (up to ${formatMoney(c.maxDiscount)})` : ''}`
      : `${formatMoney(c.value)} off`;
  const base = Number(c.minSpend) > 0 ? `${off}, min. ${formatMoney(c.minSpend)}` : off;
  const scope =
    c.appliesTo === 'PRODUCTS'
      ? ` · ${c.products.length} product(s)`
      : c.appliesTo === 'CATEGORIES'
        ? ` · ${c.categories.map((x) => x.name).join(', ')}`
        : '';
  return `${base}${scope}${c.firstOrderOnly ? ' · first order' : ''}`;
}

function couponPhase(c: CouponDto): {
  label: string;
  variant: 'success' | 'secondary' | 'outline';
} {
  const now = Date.now();
  if (c.status === 'INACTIVE') return { label: 'Paused', variant: 'secondary' };
  if (new Date(c.endsAt).getTime() <= now) return { label: 'Ended', variant: 'secondary' };
  if (new Date(c.startsAt).getTime() > now) return { label: 'Scheduled', variant: 'outline' };
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit)
    return { label: 'Used up', variant: 'secondary' };
  return { label: 'Live', variant: 'success' };
}

/**
 * Coupon list with create and edit dialogs. Used by Seller Center (store-funded coupons) and
 * the Admin Console (marketplace-funded coupons); the caller supplies data and mutations.
 */
export function CouponManager({
  coupons,
  page,
  pageSize,
  onPageChange,
  mutations,
  canManage,
  fundedBy,
  showSeller = false,
  canEdit = () => true,
  targets = {},
}: {
  coupons: {
    data: { items: CouponDto[]; totalItems: number } | undefined;
    isPending: boolean;
    isFetching: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  mutations: CouponMutations;
  canManage: boolean;
  fundedBy: string;
  showSeller?: boolean;
  /** Whether this user may edit the coupon (staff edit only marketplace coupons). */
  canEdit?: (coupon: CouponDto) => boolean;
  /** Products / categories a coupon can be restricted to. */
  targets?: TargetOptions;
}) {
  const [editing, setEditing] = useState<CouponDto | 'new' | null>(null);
  const columns: DataTableColumn<CouponDto>[] = [
    {
      id: 'code',
      header: 'Code',
      cell: (c) => (
        <div>
          <p className="font-mono font-medium">{c.code}</p>
          <p className="text-xs text-muted-foreground">{c.name}</p>
        </div>
      ),
    },
    ...(showSeller
      ? [
          {
            id: 'seller',
            header: 'Funded by',
            hideOnMobile: true,
            cell: (c: CouponDto) => c.seller?.businessName ?? 'Marketplace',
          },
        ]
      : []),
    { id: 'value', header: 'Discount', cell: describeValue },
    {
      id: 'dates',
      header: 'Runs',
      hideOnMobile: true,
      cell: (c) =>
        `${new Date(c.startsAt).toLocaleDateString('en-PH')} – ${new Date(c.endsAt).toLocaleDateString('en-PH')}`,
    },
    {
      id: 'used',
      header: 'Used',
      cell: (c) => `${c.usedCount}${c.usageLimit !== null ? ` / ${c.usageLimit}` : ''}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => {
        const phase = couponPhase(c);
        return <Badge variant={phase.variant}>{phase.label}</Badge>;
      },
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (c: CouponDto) =>
              canEdit(c) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${c.code}`}
                  onClick={() => setEditing(c)}
                >
                  <PencilIcon />
                </Button>
              ) : null,
          },
        ]
      : []),
  ];
  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <PlusIcon /> New coupon
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Coupons"
        columns={columns}
        rows={coupons.data?.items}
        getRowId={(c) => c.id}
        isLoading={coupons.isPending}
        error={toDisplayError(coupons.error)}
        onRetry={() => void coupons.refetch()}
        empty={{
          icon: TicketPercentIcon,
          title: 'No coupons yet',
          description: 'Coupons give customers a discount code to use at checkout.',
        }}
        pagination={
          coupons.data
            ? {
                page,
                pageSize,
                totalItems: coupons.data.totalItems,
                onPageChange,
                isFetching: coupons.isFetching,
              }
            : undefined
        }
      />
      {editing ? (
        <CouponDialog
          coupon={editing === 'new' ? null : editing}
          mutations={mutations}
          fundedBy={fundedBy}
          targets={targets}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
