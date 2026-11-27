import {
  saveBlob,
  toDisplayError,
  useApiClient,
  useEngagement,
  useEngagementAction,
} from '@marketplace/api-client';
import {
  SUPPORT_TICKET_CATEGORY_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
  type SupportTicketStatus,
} from '@marketplace/shared-types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Label,
  LoadingState,
  Textarea,
  toast,
} from '@marketplace/ui';
import type { TicketDetail, TicketSummary } from '@marketplace/validation';
import { LifeBuoyIcon, PaperclipIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

export type TicketScope = 'account' | 'seller' | 'admin';
type Api = ReturnType<typeof useApiClient>['engagement'];
const ticketsOf = (e: Api, scope: TicketScope) =>
  scope === 'account' ? e.account.tickets : scope === 'seller' ? e.seller.tickets : e.admin.tickets;

const VARIANT: Record<SupportTicketStatus, 'warning' | 'secondary' | 'success' | 'outline'> = {
  OPEN: 'warning',
  AWAITING_SELLER: 'warning',
  AWAITING_SUPPORT: 'warning',
  AWAITING_CUSTOMER: 'secondary',
  RESOLVED: 'success',
  CLOSED: 'outline',
};
export function TicketStatusBadge({
  status,
  customer = false,
}: {
  status: SupportTicketStatus;
  customer?: boolean;
}) {
  const label =
    customer && status === 'AWAITING_CUSTOMER'
      ? 'Waiting for you'
      : customer && status === 'AWAITING_SELLER'
        ? 'With the seller'
        : customer && status === 'AWAITING_SUPPORT'
          ? 'With support'
          : SUPPORT_TICKET_STATUS_LABELS[status];
  return <Badge variant={VARIANT[status]}>{label}</Badge>;
}
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(iso));

/** Ticket list for customers, seller teams and support staff. */
export function TicketList({
  scope,
  basePath,
  filter,
}: {
  scope: TicketScope;
  basePath: string;
  filter?: Record<string, string>;
}) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<'true' | 'false' | ''>('true');
  const query = { page, pageSize: 20, ...(open ? { open } : {}), ...filter };
  const tickets = useEngagement([scope, 'tickets', query], (e, s) =>
    ticketsOf(e, scope).list(query, s),
  );
  const columns: DataTableColumn<TicketSummary>[] = [
    {
      id: 'subject',
      header: 'Ticket',
      cell: (t) => (
        <div>
          <Link to={`${basePath}/${t.id}`} className="font-medium hover:underline">
            {t.subject}
          </Link>
          <p className="text-xs text-muted-foreground">
            {t.number} · {SUPPORT_TICKET_CATEGORY_LABELS[t.category]}
            {t.sellerOrderNumber ? ` · ${t.sellerOrderNumber}` : ''}
          </p>
        </div>
      ),
    },
    ...(scope !== 'account'
      ? [
          {
            id: 'customer',
            header: 'Customer',
            hideOnMobile: true,
            cell: (t: TicketSummary) => t.customer.name,
          },
        ]
      : []),
    ...(scope === 'admin'
      ? [
          {
            id: 'store',
            header: 'Store',
            hideOnMobile: true,
            cell: (t: TicketSummary) => t.store?.name ?? 'Marketplace',
          },
        ]
      : []),
    {
      id: 'status',
      header: 'Status',
      cell: (t) => <TicketStatusBadge status={t.status} customer={scope === 'account'} />,
    },
    { id: 'last', header: 'Last message', hideOnMobile: true, cell: (t) => when(t.lastMessageAt) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="group" aria-label="Show">
        {(
          [
            ['true', 'Open'],
            ['false', 'Resolved and closed'],
            ['', 'All'],
          ] as const
        ).map(([v, label]) => (
          <Button
            key={label}
            size="sm"
            variant={open === v ? 'default' : 'outline'}
            onClick={() => {
              setOpen(v);
              setPage(1);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <DataTable
        label="Tickets"
        columns={columns}
        rows={tickets.data?.items}
        getRowId={(t) => t.id}
        isLoading={tickets.isPending}
        error={toDisplayError(tickets.error)}
        onRetry={() => void tickets.refetch()}
        empty={{
          icon: LifeBuoyIcon,
          title: 'No tickets',
          description: 'Questions and problems appear here.',
        }}
        pagination={
          tickets.data
            ? {
                page,
                pageSize: 20,
                totalItems: tickets.data.totalItems,
                onPageChange: setPage,
                isFetching: tickets.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}

/** One ticket: the conversation, attachments, reply box and the viewer's actions. */
export function TicketThread({ scope, ticketId }: { scope: TicketScope; ticketId: string }) {
  const client = useApiClient();
  const ticket = useEngagement([scope, 'ticket', ticketId], (e, s) =>
    ticketsOf(e, scope).get(ticketId, s),
  );
  const action = useEngagementAction<TicketDetail>();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  if (ticket.isPending) return <LoadingState />;
  if (ticket.error || !ticket.data)
    return (
      <ErrorState
        message={toDisplayError(ticket.error)?.message ?? 'Ticket not found.'}
        onRetry={() => void ticket.refetch()}
      />
    );
  const t = ticket.data;
  const run = (fn: (e: Api) => Promise<TicketDetail>, done: string) =>
    action.mutate(fn, {
      onSuccess: () => toast.success(done),
      onError: (error) => toast.error(toDisplayError(error)?.message ?? 'Something went wrong.'),
    });
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    action.mutate((api) => ticketsOf(api, scope).reply(t.id, { body, internal }, files), {
      onSuccess: () => {
        setBody('');
        setFiles([]);
        setInternal(false);
      },
      onError: (error) => toast.error(toDisplayError(error)?.message ?? 'Could not send.'),
    });
  };
  const download = async (attachmentId: string, name: string) => {
    try {
      saveBlob(await ticketsOf(client.engagement, scope).attachment(t.id, attachmentId), name);
    } catch (error) {
      toast.error(toDisplayError(error)?.message ?? 'Could not download the file.');
    }
  };
  const act = (a: 'RESOLVE' | 'CLOSE' | 'REOPEN' | 'JOIN' | 'TAKE_OVER', done: string) =>
    run((api) => ticketsOf(api, scope).act(t.id, { action: a }), done);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <Card>
        <CardHeader>
          <CardTitle>{t.subject}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t.number} · {SUPPORT_TICKET_CATEGORY_LABELS[t.category]}
            {t.sellerOrderNumber ? ` · Order ${t.sellerOrderNumber}` : ''}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3" aria-label="Conversation">
            {t.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-3 ${m.internal ? 'border-dashed bg-muted/50' : ''} ${m.authorRole === 'SYSTEM' ? 'text-sm text-muted-foreground' : ''}`}
              >
                <p className="text-xs text-muted-foreground">
                  {m.authorName} · {when(m.createdAt)}
                  {m.internal ? ' · Internal note' : ''}
                </p>
                <p className="mt-1 whitespace-pre-line">{m.body}</p>
                {m.attachments.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <li key={a.id}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void download(a.id, a.name)}
                        >
                          <PaperclipIcon /> {a.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          {t.can.reply ? (
            <form onSubmit={send} className="space-y-2">
              <Label htmlFor="ticket-reply">Reply</Label>
              <Textarea
                id="ticket-reply"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
              />
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  aria-label="Attach files"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
                />
                {t.can.internalNote ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                    />
                    Internal note (the customer does not see it)
                  </label>
                ) : null}
                <Button
                  type="submit"
                  className="ml-auto"
                  disabled={action.isPending || !body.trim()}
                >
                  Send
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">This ticket is closed.</p>
          )}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <TicketStatusBadge status={t.status} customer={scope === 'account'} />
          {scope !== 'account' ? <p>Customer: {t.customer.name}</p> : null}
          <p>Store: {t.store?.name ?? 'Marketplace support'}</p>
          {t.assignedTo ? <p>Assigned to: {t.assignedTo.name}</p> : null}
          {t.supportJoined && scope !== 'admin' ? (
            <p>Marketplace support is in this conversation.</p>
          ) : null}
          <div className="flex flex-col gap-2 pt-2">
            {t.can.join ? (
              <Button variant="outline" onClick={() => act('JOIN', 'Joined')}>
                Join conversation
              </Button>
            ) : null}
            {t.can.takeOver ? (
              <Button variant="outline" onClick={() => act('TAKE_OVER', 'Ticket taken over')}>
                Take over
              </Button>
            ) : null}
            {t.can.resolve ? (
              <Button variant="outline" onClick={() => act('RESOLVE', 'Marked as resolved')}>
                Mark as resolved
              </Button>
            ) : null}
            {t.can.close ? (
              <Button variant="outline" onClick={() => act('CLOSE', 'Ticket closed')}>
                Close ticket
              </Button>
            ) : null}
            {t.can.reopen ? (
              <Button variant="outline" onClick={() => act('REOPEN', 'Ticket reopened')}>
                Reopen
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
