import {
  toDisplayError,
  useAllCategories,
  useEngagement,
  useEngagementAction,
} from '@marketplace/api-client';
import { CampaignManager, ReportsDashboard, TicketList, TicketThread } from '@marketplace/auth-ui';
import {
  LOYALTY_TRANSACTION_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ErrorState,
  formatMoney,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Textarea,
  toast,
} from '@marketplace/ui';
import {
  type AffiliateAccountDto,
  type AffiliateSettings,
  affiliateSettingsSchema,
  type LoyaltySettings,
  loyaltySettingsSchema,
  type NotificationDeliveryDto,
  type NotificationTemplateDto,
} from '@marketplace/validation';
import { BellIcon, CoinsIcon, HandshakeIcon } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { showError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 20;

const ADMIN_REPORT_TABS = [
  { name: 'sales', label: 'Sales' },
  { name: 'products', label: 'Products' },
  { name: 'categories', label: 'Categories' },
  { name: 'sellers', label: 'Sellers' },
  { name: 'customers', label: 'Customers' },
  { name: 'payments', label: 'Payments' },
  { name: 'refunds', label: 'Refunds' },
];

/** Marketplace analytics: GMV, revenue, commission, orders, customers, sellers and more. */
export function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Live figures from orders, payments, refunds and the ledger. Dates are Philippine time."
      />
      <ReportsDashboard scope="admin" tabs={ADMIN_REPORT_TABS} />
    </div>
  );
}

/** Marketplace campaigns (automatic promotions, marketplace-funded). */
export function CampaignsPage() {
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE };
  const campaigns = useEngagement(['admin', 'campaigns', query], (e, s) =>
    e.admin.campaigns(query, s),
  );
  const categories = useAllCategories();
  const action = useEngagementAction();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Flash-sale-style automatic deals: percent or amount off, bundles, buy X get Y, free shipping and seasonal campaigns."
      />
      <CampaignManager
        campaigns={campaigns}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        canManage
        showSeller
        canEdit={(c) => c.scope === 'PLATFORM'}
        fundedBy="the marketplace"
        targets={{
          categories: (categories.data?.categories ?? []).map((c) => ({
            id: c.id,
            name: c.path.join(' › '),
          })),
        }}
        mutations={{
          create: (body) => action.mutateAsync((e) => e.admin.createCampaign(body)),
          update: (id, body) => action.mutateAsync((e) => e.admin.updateCampaign(id, body)),
          pending: action.isPending,
        }}
      />
    </div>
  );
}

// ---- Loyalty --------------------------------------------------------------------------------

function LoyaltySettingsCard() {
  const settings = useEngagement(['admin', 'loyalty-settings'], (e, s) =>
    e.admin.loyaltySettings(s),
  );
  const action = useEngagementAction();
  const [draft, setDraft] = useState<LoyaltySettings | null>(null);
  if (settings.isPending) return <LoadingState />;
  if (!settings.data)
    return <ErrorState message={toDisplayError(settings.error)?.message ?? 'Could not load.'} />;
  const v = draft ?? settings.data;
  const num = (k: keyof LoyaltySettings, label: string) => (
    <div className="grid gap-1">
      <Label htmlFor={`loyalty-${k}`}>{label}</Label>
      <Input
        id={`loyalty-${k}`}
        inputMode="decimal"
        value={String(v[k])}
        onChange={(e) =>
          setDraft({
            ...v,
            [k]: typeof v[k] === 'number' ? Number(e.target.value) : e.target.value,
          })
        }
      />
    </div>
  );
  const save = () => {
    const parsed = loyaltySettingsSchema.safeParse(v);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? 'Check the values');
    action.mutate((e) => e.admin.saveLoyaltySettings(parsed.data), {
      onSuccess: () => {
        setDraft(null);
        toast.success('Loyalty settings saved');
      },
      onError: (error) => showError('Could not save', error),
    });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Points rules</CardTitle>
        <CardDescription>
          Points are earned when an order completes (after the return window) and spent at checkout
          as a marketplace-funded discount. Refunds take earned points back proportionally.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setDraft({ ...v, enabled: e.target.checked })}
          />
          Loyalty points are on
        </label>
        {num('pesosPerPoint', 'Pesos per point earned')}
        {num('pointValue', 'Value of one point (₱)')}
        {num('maxRedeemPercent', 'Points can pay up to (% of items)')}
        {num('expiryMonths', 'Points expire after (months)')}
        <div className="grid gap-1">
          <Label htmlFor="referrer-points">Referral bonus: referrer</Label>
          <Input
            id="referrer-points"
            inputMode="numeric"
            value={String(v.referral.referrerPoints)}
            onChange={(e) =>
              setDraft({
                ...v,
                referral: { ...v.referral, referrerPoints: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="referee-points">Referral bonus: new customer</Label>
          <Input
            id="referee-points"
            inputMode="numeric"
            value={String(v.referral.refereePoints)}
            onChange={(e) =>
              setDraft({ ...v, referral: { ...v.referral, refereePoints: Number(e.target.value) } })
            }
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={v.referral.enabled}
            onChange={(e) =>
              setDraft({ ...v, referral: { ...v.referral, enabled: e.target.checked } })
            }
          />
          Customer referrals are on
        </label>
        <div className="sm:col-span-3">
          <Button onClick={save} disabled={!draft || action.isPending}>
            Save rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdjustDialog({
  userId,
  name,
  onClose,
}: {
  userId: string;
  name: string;
  onClose: () => void;
}) {
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const action = useEngagementAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    action.mutate((api) => api.admin.adjustPoints(userId, { points: Number(points), reason }), {
      onSuccess: () => {
        toast.success('Points adjusted');
        onClose();
      },
      onError: (error) => showError('Could not adjust', error),
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust points for {name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <Label htmlFor="adjust-points">Points (negative to take away)</Label>
          <Input
            id="adjust-points"
            inputMode="numeric"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
          <Label htmlFor="adjust-reason">Reason</Label>
          <Textarea id="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" disabled={action.isPending || !points || reason.trim().length < 5}>
            Adjust
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Loyalty rules, customer balances and the points ledger. */
export function LoyaltyPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ userId: string; name: string } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const query = { page, pageSize: PAGE_SIZE, search: search.trim() || undefined };
  const accounts = useEngagement(['admin', 'loyalty-accounts', query], (e, s) =>
    e.admin.loyaltyAccounts(query, s),
  );
  const history = useEngagement(
    ['admin', 'loyalty-transactions', selected?.userId],
    (e, s) => e.admin.loyaltyTransactions(selected!.userId, { page: 1, pageSize: 50 }, s),
    { enabled: !!selected },
  );
  type Row = NonNullable<typeof accounts.data>['items'][number];
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'customer',
      header: 'Customer',
      cell: (a) => (
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => setSelected({ userId: a.userId, name: a.name })}
        >
          <p className="font-medium">{a.name}</p>
          <p className="text-xs text-muted-foreground">{a.email}</p>
        </button>
      ),
    },
    { id: 'balance', header: 'Balance', cell: (a) => a.balance.toLocaleString('en-PH') },
    {
      id: 'earned',
      header: 'Earned to date',
      hideOnMobile: true,
      cell: (a) => a.lifetimeEarned.toLocaleString('en-PH'),
    },
    {
      id: 'updated',
      header: 'Last change',
      hideOnMobile: true,
      cell: (a) => formatDateTime(a.updatedAt),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Loyalty points"
        description="Rules, balances and the append-only points ledger (posted to accounts 2410 / 5050)."
      />
      <LoyaltySettingsCard />
      <Input
        placeholder="Search customers"
        aria-label="Search customers"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <DataTable
        label="Loyalty accounts"
        columns={columns}
        rows={accounts.data?.items}
        getRowId={(a) => a.userId}
        isLoading={accounts.isPending}
        error={toDisplayError(accounts.error)}
        empty={{
          icon: CoinsIcon,
          title: 'No points yet',
          description: 'Accounts appear when customers earn points.',
        }}
        pagination={
          accounts.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: accounts.data.totalItems,
                onPageChange: setPage,
              }
            : undefined
        }
      />
      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>{selected.name}: points history</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdjusting(true)}
              className="w-fit"
            >
              Adjust points
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(history.data?.items ?? []).map((t) => (
                <li key={t.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {LOYALTY_TRANSACTION_LABELS[t.type]} · {t.description}
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                    </span>
                  </span>
                  <span className={t.points < 0 ? 'text-destructive' : ''}>
                    {t.points > 0 ? '+' : ''}
                    {t.points} ({t.balanceAfter})
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {adjusting && selected ? (
        <AdjustDialog {...selected} onClose={() => setAdjusting(false)} />
      ) : null}
    </div>
  );
}

// ---- Affiliates -----------------------------------------------------------------------------

function AffiliateSettingsCard() {
  const settings = useEngagement(['admin', 'affiliate-settings'], (e, s) =>
    e.admin.affiliateSettings(s),
  );
  const action = useEngagementAction();
  const [draft, setDraft] = useState<AffiliateSettings | null>(null);
  if (!settings.data) return null;
  const v = draft ?? settings.data;
  const save = () => {
    const parsed = affiliateSettingsSchema.safeParse(v);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? 'Check the values');
    action.mutate((e) => e.admin.saveAffiliateSettings(parsed.data), {
      onSuccess: () => {
        setDraft(null);
        toast.success('Affiliate settings saved');
      },
      onError: (error) => showError('Could not save', error),
    });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Programme settings</CardTitle>
        <CardDescription>
          Commission accrues when an attributed seller order completes; payouts are recorded by
          finance.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setDraft({ ...v, enabled: e.target.checked })}
          />
          Affiliate programme is on
        </label>
        <div className="grid gap-1">
          <Label htmlFor="aff-rate">Default commission (%)</Label>
          <Input
            id="aff-rate"
            value={v.defaultCommissionRate}
            onChange={(e) => setDraft({ ...v, defaultCommissionRate: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="aff-days">Link remembered for (days)</Label>
          <Input
            id="aff-days"
            value={String(v.cookieDays)}
            onChange={(e) => setDraft({ ...v, cookieDays: Number(e.target.value) })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="aff-min">Minimum payout (₱)</Label>
          <Input
            id="aff-min"
            value={v.minPayout}
            onChange={(e) => setDraft({ ...v, minPayout: e.target.value })}
          />
        </div>
        <div className="sm:col-span-3">
          <Button onClick={save} disabled={!draft || action.isPending}>
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Affiliate accounts: review, commission rates, conversions and payouts. */
export function AffiliatesPage() {
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE };
  const list = useEngagement(['admin', 'affiliates', query], (e, s) =>
    e.admin.affiliates(query, s),
  );
  const action = useEngagementAction();
  const decide = (a: AffiliateAccountDto, status: 'APPROVED' | 'SUSPENDED' | 'REJECTED') =>
    action.mutate((e) => e.admin.reviewAffiliate(a.id, { status }), {
      onSuccess: () => toast.success(`${a.displayName}: ${status.toLowerCase()}`),
      onError: (error) => showError('Could not update', error),
    });
  const pay = (a: AffiliateAccountDto) =>
    action.mutate((e) => e.admin.recordAffiliatePayout(a.id, { method: 'Bank transfer' }), {
      onSuccess: () => toast.success(`Payout of ${formatMoney(a.totals.payable)} recorded`),
      onError: (error) => showError('Could not record the payout', error),
    });
  const columns: DataTableColumn<AffiliateAccountDto>[] = [
    {
      id: 'name',
      header: 'Affiliate',
      cell: (a) => (
        <div>
          <p className="font-medium">{a.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {a.code} · {a.user.email}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (a) => (
        <Badge
          variant={
            a.status === 'APPROVED' ? 'success' : a.status === 'PENDING' ? 'warning' : 'secondary'
          }
        >
          {a.status.toLowerCase()}
        </Badge>
      ),
    },
    { id: 'rate', header: 'Rate', cell: (a) => `${a.commissionRate}%` },
    {
      id: 'clicks',
      header: 'Clicks / orders',
      hideOnMobile: true,
      cell: (a) => `${a.totals.clicks} / ${a.totals.conversions}`,
    },
    { id: 'sales', header: 'Sales', hideOnMobile: true, cell: (a) => formatMoney(a.totals.sales) },
    { id: 'payable', header: 'Payable', cell: (a) => formatMoney(a.totals.payable) },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (a) => (
        <div className="flex flex-wrap gap-1">
          {a.status !== 'APPROVED' ? (
            <Button size="sm" variant="outline" onClick={() => decide(a, 'APPROVED')}>
              Approve
            </Button>
          ) : null}
          {a.status === 'APPROVED' ? (
            <Button size="sm" variant="outline" onClick={() => decide(a, 'SUSPENDED')}>
              Suspend
            </Button>
          ) : null}
          {a.status === 'PENDING' ? (
            <Button size="sm" variant="ghost" onClick={() => decide(a, 'REJECTED')}>
              Reject
            </Button>
          ) : null}
          {Number(a.totals.payable) > 0 ? (
            <Button size="sm" onClick={() => pay(a)}>
              Record payout
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Affiliates"
        description="Commissions are auditable: each comes from one seller order, with its base and rate frozen, and is posted to accounts 5060 / 2420."
      />
      <AffiliateSettingsCard />
      <DataTable
        label="Affiliates"
        columns={columns}
        rows={list.data?.items}
        getRowId={(a) => a.id}
        isLoading={list.isPending}
        error={toDisplayError(list.error)}
        empty={{
          icon: HandshakeIcon,
          title: 'No affiliates yet',
          description: 'Customers apply from their account.',
        }}
        pagination={
          list.data
            ? { page, pageSize: PAGE_SIZE, totalItems: list.data.totalItems, onPageChange: setPage }
            : undefined
        }
      />
    </div>
  );
}

// ---- Support --------------------------------------------------------------------------------

export function SupportTicketsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Support tickets"
        description="Every ticket: general inquiries and order tickets handled by sellers. Join or take over when needed."
      />
      <TicketList scope="admin" basePath="/support" />
    </div>
  );
}

export function SupportTicketPage() {
  const { ticketId } = useParams();
  return (
    <div className="space-y-6">
      <PageHeader title="Support ticket" />
      <TicketThread scope="admin" ticketId={ticketId!} />
    </div>
  );
}

// ---- Notifications --------------------------------------------------------------------------

function TemplateEditor({
  template,
  event,
  channel,
  onClose,
}: {
  template: NotificationTemplateDto | null;
  event: string;
  channel: NotificationChannel;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [enabled, setEnabled] = useState(template?.enabled ?? true);
  const action = useEngagementAction();
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    action.mutate(
      (api) => api.admin.saveTemplate(event, channel, { subject: subject || null, body, enabled }),
      {
        onSuccess: () => {
          toast.success('Template saved');
          onClose();
        },
        onError: (error) => showError('Could not save the template', error),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {event} · {NOTIFICATION_CHANNEL_LABELS[channel]}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          {channel !== 'SMS' ? (
            <>
              <Label htmlFor="template-subject">{channel === 'EMAIL' ? 'Subject' : 'Title'}</Label>
              <Input
                id="template-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </>
          ) : null}
          <Label htmlFor="template-body">Message</Label>
          <Textarea
            id="template-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Variables: {(template?.variables ?? []).map((v) => `{{${v}}}`).join(' ')}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Send on this channel
          </label>
          <Button type="submit" disabled={action.isPending}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Notification templates per event and channel, and the delivery log. */
export function NotificationsPage() {
  const templates = useEngagement(['admin', 'templates'], (e, s) => e.admin.templates(s));
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE };
  const deliveries = useEngagement(['admin', 'deliveries', query], (e, s) =>
    e.admin.deliveries(query, s),
  );
  const [editing, setEditing] = useState<{ event: string; channel: NotificationChannel } | null>(
    null,
  );
  if (templates.isPending) return <LoadingState />;
  if (!templates.data)
    return <ErrorState message={toDisplayError(templates.error)?.message ?? 'Could not load.'} />;
  const find = (event: string, channel: NotificationChannel) =>
    templates.data.items.find((t) => t.event === event && t.channel === channel) ?? null;
  const deliveryColumns: DataTableColumn<NotificationDeliveryDto>[] = [
    { id: 'when', header: 'When', cell: (d) => formatDateTime(d.createdAt) },
    { id: 'event', header: 'Event', cell: (d) => d.event },
    { id: 'channel', header: 'Channel', cell: (d) => NOTIFICATION_CHANNEL_LABELS[d.channel] },
    {
      id: 'status',
      header: 'Status',
      cell: (d) => (
        <Badge
          variant={
            d.status === 'SENT' ? 'success' : d.status === 'FAILED' ? 'destructive' : 'secondary'
          }
        >
          {d.status.toLowerCase()}
        </Badge>
      ),
    },
    { id: 'to', header: 'To', hideOnMobile: true, cell: (d) => d.destination ?? '—' },
    {
      id: 'detail',
      header: 'Detail',
      hideOnMobile: true,
      cell: (d) => d.detail ?? d.provider ?? '',
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Events are written with each change and delivered by the worker: in-app, email (Mailpit locally), SMS (mock until credentials are set) and push."
      />
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Event</th>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <th key={c}>{NOTIFICATION_CHANNEL_LABELS[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.data.events.map((ev) => (
                <tr key={ev.code} className="border-t">
                  <td className="py-2">{ev.label}</td>
                  {NOTIFICATION_CHANNELS.map((c) => {
                    const t = find(ev.code, c);
                    if (c === 'EMAIL' && ev.builtInEmail)
                      return (
                        <td key={c} className="text-xs text-muted-foreground">
                          Built-in email
                        </td>
                      );
                    return (
                      <td key={c}>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${ev.label} ${NOTIFICATION_CHANNEL_LABELS[c]}`}
                          onClick={() => setEditing({ event: ev.code, channel: c })}
                        >
                          {t ? (t.enabled ? 'On' : 'Off') : 'Add'}
                        </Button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <DataTable
        label="Deliveries"
        columns={deliveryColumns}
        rows={deliveries.data?.items}
        getRowId={(d) => d.id}
        isLoading={deliveries.isPending}
        error={toDisplayError(deliveries.error)}
        empty={{
          icon: BellIcon,
          title: 'Nothing delivered yet',
          description: 'Deliveries appear once the worker processes events.',
        }}
        pagination={
          deliveries.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: deliveries.data.totalItems,
                onPageChange: setPage,
              }
            : undefined
        }
      />
      {editing ? (
        <TemplateEditor
          {...editing}
          template={
            find(editing.event, editing.channel) ?? {
              id: '',
              event: editing.event,
              channel: editing.channel,
              subject: null,
              body: '',
              enabled: true,
              updatedAt: '',
              variables:
                templates.data.events.find((e) => e.code === editing.event)?.variables ?? [],
            }
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
