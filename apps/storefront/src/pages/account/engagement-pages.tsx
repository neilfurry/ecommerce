import {
  ApiError,
  toDisplayError,
  useEngagement,
  useEngagementAction,
} from '@marketplace/api-client';
import { TicketList, TicketThread } from '@marketplace/auth-ui';
import {
  LOYALTY_TRANSACTION_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_CATEGORY_LABELS,
  type SupportTicketCategory,
} from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  formatMoney,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Textarea,
  toast,
} from '@marketplace/ui';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

const date = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(
    new Date(iso),
  );
const errorMessage = (error: unknown) => toDisplayError(error)?.message ?? 'Something went wrong.';

/** Points balance, the points history (ledger) and the referral code. */
export function RewardsPage() {
  const summary = useEngagement(['account', 'loyalty'], (e, s) => e.account.loyalty(s));
  const [page, setPage] = useState(1);
  const history = useEngagement(['account', 'loyalty', 'history', page], (e, s) =>
    e.account.loyaltyTransactions({ page, pageSize: 20 }, s),
  );
  const referrals = useEngagement(['account', 'referrals'], (e, s) => e.account.referrals(s));
  if (summary.isPending) return <LoadingState />;
  if (!summary.data)
    return (
      <ErrorState message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} />
    );
  const s = summary.data;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy; select the text instead.');
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rewards"
        description={`Earn 1 point for every ₱${Number(s.rules.pesosPerPoint)} paid on completed orders; 1 point = ${formatMoney(s.rules.pointValue)} at checkout (up to ${s.rules.maxRedeemPercent}% of an order).`}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Points balance</CardDescription>
            <CardTitle className="text-3xl" data-testid="points-balance">
              {s.balance.toLocaleString('en-PH')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Worth {formatMoney(s.value)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>On the way</CardDescription>
            <CardTitle className="text-3xl">{s.pending.toLocaleString('en-PH')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Credited when your orders complete
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Expiring in 30 days</CardDescription>
            <CardTitle className="text-3xl">
              {s.expiringSoon.points.toLocaleString('en-PH')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {s.expiringSoon.firstAt
              ? `From ${date(s.expiringSoon.firstAt)}`
              : `Points last ${s.rules.expiryMonths} months`}
          </CardContent>
        </Card>
      </div>
      {referrals.data?.enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite friends</CardTitle>
            <CardDescription>
              When a friend joins with your code and their first order completes, you get{' '}
              {referrals.data.referrerPoints} points and they get {referrals.data.refereePoints}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code
                className="rounded bg-muted px-2 py-1 font-mono text-lg"
                data-testid="referral-code"
              >
                {referrals.data.code}
              </code>
              <Button size="sm" variant="outline" onClick={() => void copy(referrals.data!.link)}>
                Copy invite link
              </Button>
            </div>
            {referrals.data.referrals.length > 0 ? (
              <ul className="divide-y text-sm">
                {referrals.data.referrals.map((r, i) => (
                  <li key={i} className="flex justify-between py-2">
                    <span>
                      {r.name} · joined {date(r.joinedAt)}
                    </span>
                    <Badge variant={r.status === 'REWARDED' ? 'success' : 'secondary'}>
                      {r.status === 'REWARDED'
                        ? 'Rewarded'
                        : r.status === 'PENDING'
                          ? 'Waiting for first order'
                          : 'Not eligible'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Points history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.data && history.data.items.length > 0 ? (
            <ul className="divide-y text-sm" aria-label="Points history">
              {history.data.items.map((t) => (
                <li key={t.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {LOYALTY_TRANSACTION_LABELS[t.type]}: {t.description}
                    <span className="block text-xs text-muted-foreground">
                      {date(t.createdAt)}
                      {t.expiresAt ? ` · expires ${date(t.expiresAt)}` : ''}
                    </span>
                  </span>
                  <span className={t.points < 0 ? 'text-destructive' : 'text-emerald-700'}>
                    {t.points > 0 ? '+' : ''}
                    {t.points}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No points yet. Points are added when an order completes.
            </p>
          )}
          {history.data && history.data.totalPages > 1 ? (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Newer
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= history.data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Older
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** Apply to the affiliate programme, or see the link, earnings and attributed orders. */
export function AffiliatePage() {
  const account = useEngagement(['account', 'affiliate'], (e, s) => e.account.affiliate(s));
  const approved = account.data?.status === 'APPROVED';
  const report = useEngagement(
    ['account', 'affiliate', 'report'],
    (e, s) => e.account.affiliateReport(s),
    { enabled: approved },
  );
  const conversions = useEngagement(
    ['account', 'affiliate', 'conversions'],
    (e, s) => e.account.affiliateConversions({ page: 1, pageSize: 20 }, s),
    { enabled: approved },
  );
  const apply = useEngagementAction();
  const [displayName, setDisplayName] = useState('');
  const [website, setWebsite] = useState('');
  if (account.isPending) return <LoadingState />;
  const notFound = account.error instanceof ApiError && account.error.status === 404;
  if (!account.data && !notFound) return <ErrorState message={errorMessage(account.error)} />;
  if (!account.data)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Affiliate programme"
          description="Share links to products and earn a commission on completed orders."
        />
        <Card>
          <CardContent className="pt-6">
            <form
              className="grid max-w-md gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                apply.mutate(
                  (api) => api.account.applyAffiliate({ displayName, website: website || null }),
                  {
                    onSuccess: () => toast.success('Application sent. We will review it shortly.'),
                    onError: (error) => toast.error(errorMessage(error)),
                  },
                );
              }}
            >
              <Label htmlFor="aff-name">Name shown to the marketplace</Label>
              <Input
                id="aff-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Label htmlFor="aff-site">Website or social page (optional)</Label>
              <Input
                id="aff-site"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://"
              />
              <Button type="submit" disabled={apply.isPending || displayName.trim().length < 2}>
                Apply
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  const a = account.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Affiliate programme"
        description={`Commission: ${a.commissionRate}% of what customers pay for items, earned when their order completes.`}
      />
      {a.status !== 'APPROVED' ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            Status: <Badge variant="secondary">{a.status.toLowerCase()}</Badge>{' '}
            {a.reviewNote ? `· ${a.reviewNote}` : ''}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your link</CardTitle>
              <CardDescription>
                Add <code>?aff={a.code}</code> to any product link, or share this one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <code className="break-all rounded bg-muted px-2 py-1">{a.link}</code>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Clicks', String(a.totals.clicks)],
              ['Orders', String(a.totals.conversions)],
              ['Earned', formatMoney(a.totals.accrued)],
              ['To be paid', formatMoney(a.totals.payable)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          {report.data && report.data.months.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>By month</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th>Month</th>
                      <th>Clicks</th>
                      <th>Orders</th>
                      <th>Sales</th>
                      <th>Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.months.map((m) => (
                      <tr key={m.month} className="border-t">
                        <td className="py-1">{m.month}</td>
                        <td>{m.clicks}</td>
                        <td>{m.conversions}</td>
                        <td>{formatMoney(m.sales)}</td>
                        <td>{formatMoney(m.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Attributed orders</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {(conversions.data?.items ?? []).map((c) => (
                  <li key={c.id} className="flex justify-between py-2">
                    <span>
                      {c.sellerOrderNumber} · {date(c.createdAt)}
                    </span>
                    <span>
                      {formatMoney(c.commissionAmount)}{' '}
                      <Badge variant="outline">{c.status.toLowerCase()}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Help center: my tickets and a form to ask about an order or anything else. */
export function SupportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sellerOrderId = params.get('sellerOrder');
  const [subject, setSubject] = useState(params.get('subject') ?? '');
  const [category, setCategory] = useState<SupportTicketCategory>(
    sellerOrderId ? 'ORDER' : 'OTHER',
  );
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [open, setOpen] = useState(!!sellerOrderId);
  const create = useEngagementAction<{ id: string }>();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      (api) =>
        api.account.openTicket(
          { subject, category, body, ...(sellerOrderId ? { sellerOrderId } : {}) },
          files,
        ),
      {
        onSuccess: (ticket) => void navigate(`/account/support/${ticket.id}`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Help center"
        description="Questions about an order go to that store; anything else goes to marketplace support."
        actions={open ? null : <Button onClick={() => setOpen(true)}>New question</Button>}
      />
      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {sellerOrderId ? 'Ask the store about your order' : 'Ask marketplace support'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid max-w-xl gap-3">
              <Label htmlFor="ticket-subject">Subject</Label>
              <Input
                id="ticket-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <Label htmlFor="ticket-category">Topic</Label>
              <select
                id="ticket-category"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
              >
                {SUPPORT_TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SUPPORT_TICKET_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <Label htmlFor="ticket-body">Message</Label>
              <Textarea
                id="ticket-body"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <input
                type="file"
                multiple
                aria-label="Attach photos or PDFs"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
              />
              <Button
                type="submit"
                disabled={create.isPending || subject.trim().length < 4 || body.trim().length < 5}
              >
                Send
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <TicketList scope="account" basePath="/account/support" />
    </div>
  );
}

export function TicketPage() {
  const { ticketId } = useParams();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Your question"
        actions={
          <Link to="/account/support" className="text-sm underline">
            All questions
          </Link>
        }
      />
      <TicketThread scope="account" ticketId={ticketId!} />
    </div>
  );
}

/** The in-app inbox and which channels to receive. */
export function NotificationsPage() {
  const [page, setPage] = useState(1);
  const inbox = useEngagement(['account', 'notifications', page], (e, s) =>
    e.notifications.list({ page, pageSize: 20 }, s),
  );
  const prefs = useEngagement(['account', 'notification-preferences'], (e, s) =>
    e.notifications.preferences(s),
  );
  const action = useEngagementAction();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        actions={
          inbox.data && inbox.data.unread > 0 ? (
            <Button
              variant="outline"
              onClick={() => action.mutate((e) => e.notifications.markRead({ all: true }))}
            >
              Mark all as read
            </Button>
          ) : null
        }
      />
      {inbox.isPending ? (
        <LoadingState />
      ) : inbox.data && inbox.data.items.length > 0 ? (
        <ul className="divide-y rounded-lg border" aria-label="Notifications">
          {inbox.data.items.map((n) => (
            <li key={n.id} className={`p-3 ${n.readAt ? '' : 'bg-accent/40'}`}>
              <div className="flex justify-between gap-2">
                <p className="font-medium">{n.title}</p>
                <span className="text-xs text-muted-foreground">{date(n.createdAt)}</span>
              </div>
              <p className="text-sm">{n.body}</p>
              <div className="mt-1 flex gap-3 text-sm">
                {n.link ? (
                  <Link
                    to={n.link}
                    className="underline"
                    onClick={() =>
                      !n.readAt && action.mutate((e) => e.notifications.markRead({ ids: [n.id] }))
                    }
                  >
                    Open
                  </Link>
                ) : null}
                {!n.readAt ? (
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => action.mutate((e) => e.notifications.markRead({ ids: [n.id] }))}
                  >
                    Mark as read
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No notifications yet.</p>
      )}
      {inbox.data && inbox.data.totalPages > 1 ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Newer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= inbox.data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Older
          </Button>
        </div>
      ) : null}
      {prefs.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>
              Account and order notices always appear here. Choose what else you receive.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {prefs.data.channels
              .filter((c) => c.channel !== 'IN_APP')
              .map((c) => (
                <label key={c.channel} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) =>
                      action.mutate(
                        (api) =>
                          api.notifications.savePreferences({
                            channels: [{ channel: c.channel, enabled: e.target.checked }],
                          }),
                        {
                          onError: (error) => toast.error(errorMessage(error)),
                        },
                      )
                    }
                  />
                  {NOTIFICATION_CHANNEL_LABELS[c.channel]}
                </label>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
