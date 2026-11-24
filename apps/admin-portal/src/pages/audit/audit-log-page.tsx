import { toDisplayError, useAuditLogs } from '@marketplace/api-client';
import { Badge, DataTable, type DataTableColumn, Input, Label, PageHeader } from '@marketplace/ui';
import type { AuditLogEntry } from '@marketplace/validation';
import { ScrollTextIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 50;

const COLUMNS: DataTableColumn<AuditLogEntry>[] = [
  {
    id: 'time',
    header: 'Time',
    className: 'whitespace-nowrap',
    cell: (e) => formatDateTime(e.createdAt),
  },
  {
    id: 'action',
    header: 'Action',
    cell: (e) => (
      <div className="space-y-1">
        <code className="text-xs">{e.action}</code>
        {e.outcome === 'FAILURE' ? <Badge variant="destructive">Failed</Badge> : null}
      </div>
    ),
  },
  {
    id: 'actor',
    header: 'By',
    cell: (e) =>
      e.actor ? (
        <Link to={`/users/${e.actor.id}`} className="underline-offset-4 hover:underline">
          {e.actor.name}
        </Link>
      ) : (
        <span className="text-muted-foreground">Anonymous</span>
      ),
  },
  {
    id: 'entity',
    header: 'Record',
    hideOnMobile: true,
    cell: (e) =>
      e.entityType ? (
        <span className="text-xs">
          {e.entityType}
          {e.entityId ? (
            <code className="ml-1 break-all text-muted-foreground">{e.entityId}</code>
          ) : null}
        </span>
      ) : null,
  },
  {
    id: 'details',
    header: 'Details',
    hideOnMobile: true,
    cell: (e) => {
      const entries = Object.entries(e.metadata);
      return entries.length === 0 ? null : (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {entries.length} field(s)
          </summary>
          <pre className="mt-1 max-w-80 overflow-x-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(e.metadata, null, 2)}
          </pre>
        </details>
      );
    },
  },
  {
    id: 'ip',
    header: 'IP address',
    hideOnMobile: true,
    className: 'tabular-nums',
    cell: (e) => e.ipAddress ?? '—',
  },
];

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const deferredAction = useDeferredValue(action.trim());
  const logs = useAuditLogs({ page, pageSize: PAGE_SIZE, action: deferredAction || undefined });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every sign-in, account change and approval, newest first. Entries cannot be edited or deleted."
      />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="audit-action">Action</Label>
        <Input
          id="audit-action"
          placeholder="e.g. auth.sign_in or user.suspended"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        label="Audit log"
        columns={COLUMNS}
        rows={logs.data?.items}
        getRowId={(e) => e.id}
        isLoading={logs.isPending}
        error={toDisplayError(logs.error)}
        onRetry={() => void logs.refetch()}
        empty={{ icon: ScrollTextIcon, title: 'No matching entries' }}
        pagination={
          logs.data
            ? {
                page,
                pageSize: PAGE_SIZE,
                totalItems: logs.data.totalItems,
                onPageChange: setPage,
                isFetching: logs.isFetching,
              }
            : undefined
        }
      />
    </div>
  );
}
