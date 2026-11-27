import { toDisplayError } from '@marketplace/api-client';
import { CAMPAIGN_TYPE_LABELS, CAMPAIGN_TYPES, type CampaignType } from '@marketplace/shared-types';
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
  formatMoney,
  Input,
  Label,
  toast,
} from '@marketplace/ui';
import {
  type CampaignDto,
  type CampaignInput,
  campaignInputSchema,
  type UpdateCampaignRequest,
  updateCampaignSchema,
} from '@marketplace/validation';
import { MegaphoneIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { FormAlert, SubmitButton } from './pages';
import { TargetPicker, type TargetOptions, type TargetValue } from './promotion-targets';

export interface CampaignMutations {
  create: (body: CampaignInput) => Promise<unknown>;
  update: (id: string, body: UpdateCampaignRequest) => Promise<unknown>;
  pending: boolean;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

/** "Buy 1, take 1", "15% off"... for the list. */
export function describeCampaign(
  c: Pick<
    CampaignDto,
    'type' | 'value' | 'minQuantity' | 'buyQuantity' | 'getQuantity' | 'minSpend' | 'maxDiscount'
  >,
) {
  const pct = `${Number(c.value)}%`;
  switch (c.type) {
    case 'PERCENTAGE_OFF':
      return `${pct} off${c.maxDiscount ? ` (up to ${formatMoney(c.maxDiscount)} per item)` : ''}`;
    case 'FIXED_OFF':
      return `${formatMoney(c.value)} off each`;
    case 'BUNDLE':
      return `${pct} off when buying ${c.minQuantity}+`;
    case 'BUY_X_GET_Y':
      return c.buyQuantity === 1 && c.getQuantity === 1 && Number(c.value) === 100
        ? 'Buy 1, take 1'
        : `Buy ${c.buyQuantity}, get ${c.getQuantity} at ${pct} off`;
    case 'FREE_SHIPPING':
      return Number(c.minSpend) > 0
        ? `Free shipping over ${formatMoney(c.minSpend)}`
        : 'Free shipping';
  }
}

interface Values {
  name: string;
  description: string;
  season: string;
  type: CampaignType;
  value: string;
  maxDiscount: string;
  minQuantity: string;
  buyQuantity: string;
  getQuantity: string;
  minSpend: string;
  startsAt: string;
  endsAt: string;
  status: 'ACTIVE' | 'INACTIVE';
  priority: string;
}

function CampaignDialog({
  campaign,
  mutations,
  fundedBy,
  targets,
  onClose,
}: {
  campaign: CampaignDto | null;
  mutations: CampaignMutations;
  fundedBy: string;
  targets: TargetOptions;
  onClose: () => void;
}) {
  const start = new Date();
  const [v, setV] = useState<Values>({
    name: campaign?.name ?? '',
    description: campaign?.description ?? '',
    season: campaign?.season ?? '',
    type: campaign?.type ?? 'PERCENTAGE_OFF',
    value: campaign?.value ?? '',
    maxDiscount: campaign?.maxDiscount ?? '',
    minQuantity: String(campaign?.minQuantity ?? 2),
    buyQuantity: String(campaign?.buyQuantity ?? 1),
    getQuantity: String(campaign?.getQuantity ?? 1),
    minSpend: campaign?.minSpend ?? '0',
    startsAt: toLocalInput(campaign?.startsAt ?? start.toISOString()),
    endsAt: toLocalInput(
      campaign?.endsAt ?? new Date(start.getTime() + 7 * 86_400_000).toISOString(),
    ),
    status: campaign?.status ?? 'ACTIVE',
    priority: String(campaign?.priority ?? 0),
  });
  const [target, setTarget] = useState<TargetValue>({
    appliesTo: campaign?.appliesTo ?? 'ALL',
    productIds: campaign?.products.map((p) => p.id) ?? [],
    categoryIds: campaign?.categories.map((c) => c.id) ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const body = {
      name: v.name,
      description: v.description.trim() || null,
      season: v.season.trim() || null,
      value: v.type === 'FREE_SHIPPING' ? '0' : v.value,
      maxDiscount:
        ['PERCENTAGE_OFF', 'BUNDLE', 'FREE_SHIPPING'].includes(v.type) && v.maxDiscount
          ? v.maxDiscount
          : null,
      minQuantity: v.type === 'BUNDLE' ? Number(v.minQuantity) : 1,
      buyQuantity: v.type === 'BUY_X_GET_Y' ? Number(v.buyQuantity) : null,
      getQuantity: v.type === 'BUY_X_GET_Y' ? Number(v.getQuantity) : null,
      minSpend: v.minSpend || '0',
      startsAt: toIso(v.startsAt),
      endsAt: toIso(v.endsAt),
      status: v.status,
      priority: Number(v.priority || 0),
      ...target,
    };
    const parsed = campaign
      ? updateCampaignSchema.safeParse(body)
      : campaignInputSchema.safeParse({ ...body, type: v.type });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      if (campaign) await mutations.update(campaign.id, parsed.data as UpdateCampaignRequest);
      else await mutations.create(parsed.data as CampaignInput);
      toast.success(campaign ? 'Campaign saved' : 'Campaign created');
      onClose();
    } catch (error) {
      setFormError(toDisplayError(error)?.message ?? 'Could not save the campaign.');
    }
  };

  const field = (
    k: keyof Values,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="grid gap-1">
      <Label htmlFor={`campaign-${k}`}>{label}</Label>
      <Input
        id={`campaign-${k}`}
        value={v[k]}
        onChange={set(k)}
        aria-invalid={!!errors[k]}
        {...props}
      />
      {errors[k] ? <p className="text-sm text-destructive">{errors[k]}</p> : null}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{campaign ? `Edit ${campaign.name}` : 'New campaign'}</DialogTitle>
          <DialogDescription>
            Applied automatically at checkout (no code), funded by {fundedBy}. Each item gets at
            most one item promotion: the best of a flash sale or a campaign. Coupons apply on top.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormAlert message={formError} />
          </div>
          {field('name', 'Name')}
          {field('season', 'Season label (optional)', { placeholder: 'e.g. 11.11, Christmas' })}
          <div className="grid gap-1">
            <Label htmlFor="campaign-type">Type</Label>
            <select
              id="campaign-type"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={v.type}
              disabled={!!campaign}
              onChange={(e) => setV({ ...v, type: e.target.value as CampaignType })}
            >
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CAMPAIGN_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {v.type !== 'FREE_SHIPPING'
            ? field('value', v.type === 'FIXED_OFF' ? 'Amount off each (₱)' : 'Percent off', {
                inputMode: 'decimal',
              })
            : null}
          {v.type === 'BUNDLE'
            ? field('minQuantity', 'Minimum items', { inputMode: 'numeric' })
            : null}
          {v.type === 'BUY_X_GET_Y' ? field('buyQuantity', 'Buy', { inputMode: 'numeric' }) : null}
          {v.type === 'BUY_X_GET_Y' ? field('getQuantity', 'Get', { inputMode: 'numeric' }) : null}
          {['PERCENTAGE_OFF', 'BUNDLE', 'FREE_SHIPPING'].includes(v.type)
            ? field('maxDiscount', 'Maximum discount (₱, optional)', { inputMode: 'decimal' })
            : null}
          {v.type === 'FREE_SHIPPING'
            ? field('minSpend', 'Minimum spend (₱)', { inputMode: 'decimal' })
            : null}
          {field('startsAt', 'Starts', { type: 'datetime-local' })}
          {field('endsAt', 'Ends', { type: 'datetime-local' })}
          {field('priority', 'Priority (ties)', { inputMode: 'numeric' })}
          <div className="grid gap-1">
            <Label htmlFor="campaign-status">Status</Label>
            <select
              id="campaign-status"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={v.status}
              onChange={(e) => setV({ ...v, status: e.target.value as Values['status'] })}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Paused</option>
            </select>
          </div>
          <TargetPicker
            value={target}
            onChange={setTarget}
            options={targets}
            error={errors.productIds ?? errors.categoryIds}
          />
          <div className="sm:col-span-2">
            <SubmitButton pending={mutations.pending}>
              {campaign ? 'Save' : 'Create campaign'}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function phase(c: CampaignDto): { label: string; variant: 'success' | 'secondary' | 'outline' } {
  const now = Date.now();
  if (c.status === 'INACTIVE') return { label: 'Paused', variant: 'secondary' };
  if (new Date(c.endsAt).getTime() <= now) return { label: 'Ended', variant: 'secondary' };
  if (new Date(c.startsAt).getTime() > now) return { label: 'Scheduled', variant: 'outline' };
  return { label: 'Live', variant: 'success' };
}

/** Campaign list with create and edit dialogs (Seller Center and Admin Console). */
export function CampaignManager({
  campaigns,
  page,
  pageSize,
  onPageChange,
  mutations,
  canManage,
  fundedBy,
  targets = {},
  showSeller = false,
  canEdit = () => true,
}: {
  campaigns: {
    data: { items: CampaignDto[]; totalItems: number } | undefined;
    isPending: boolean;
    isFetching: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  mutations: CampaignMutations;
  canManage: boolean;
  fundedBy: string;
  targets?: TargetOptions;
  showSeller?: boolean;
  canEdit?: (c: CampaignDto) => boolean;
}) {
  const [editing, setEditing] = useState<CampaignDto | 'new' | null>(null);
  const columns: DataTableColumn<CampaignDto>[] = [
    {
      id: 'name',
      header: 'Campaign',
      cell: (c) => (
        <div>
          <p className="font-medium">{c.name}</p>
          <p className="text-xs text-muted-foreground">
            {CAMPAIGN_TYPE_LABELS[c.type]}
            {c.season ? ` · ${c.season}` : ''}
          </p>
        </div>
      ),
    },
    ...(showSeller
      ? [
          {
            id: 'seller',
            header: 'Funded by',
            hideOnMobile: true,
            cell: (c: CampaignDto) => c.seller?.businessName ?? 'Marketplace',
          },
        ]
      : []),
    {
      id: 'deal',
      header: 'Deal',
      cell: (c) => (
        <div>
          <p>{describeCampaign(c)}</p>
          <p className="text-xs text-muted-foreground">
            {c.appliesTo === 'ALL'
              ? 'All items'
              : c.appliesTo === 'PRODUCTS'
                ? `${c.products.length} product(s)`
                : c.categories.map((x) => x.name).join(', ')}
          </p>
        </div>
      ),
    },
    {
      id: 'dates',
      header: 'Runs',
      hideOnMobile: true,
      cell: (c) =>
        `${new Date(c.startsAt).toLocaleDateString('en-PH')} – ${new Date(c.endsAt).toLocaleDateString('en-PH')}`,
    },
    {
      id: 'usage',
      header: 'Orders',
      cell: (c) => `${c.usage.orders} · ${formatMoney(c.usage.discount)}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => {
        const p = phase(c);
        return <Badge variant={p.variant}>{p.label}</Badge>;
      },
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: (c: CampaignDto) =>
              canEdit(c) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${c.name}`}
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
            <PlusIcon /> New campaign
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Campaigns"
        columns={columns}
        rows={campaigns.data?.items}
        getRowId={(c) => c.id}
        isLoading={campaigns.isPending}
        error={toDisplayError(campaigns.error)}
        onRetry={() => void campaigns.refetch()}
        empty={{
          icon: MegaphoneIcon,
          title: 'No campaigns yet',
          description:
            'Campaigns are automatic deals: bundles, buy 1 take 1, free shipping and more.',
        }}
        pagination={
          campaigns.data
            ? {
                page,
                pageSize,
                totalItems: campaigns.data.totalItems,
                onPageChange,
                isFetching: campaigns.isFetching,
              }
            : undefined
        }
      />
      {editing ? (
        <CampaignDialog
          campaign={editing === 'new' ? null : editing}
          mutations={mutations}
          fundedBy={fundedBy}
          targets={targets}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
