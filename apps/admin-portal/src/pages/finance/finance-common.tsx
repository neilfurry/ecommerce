import { toDisplayError } from '@marketplace/api-client';
import { Button, ErrorState, Input, Label, LoadingState } from '@marketplace/ui';
import type { ReactNode } from 'react';

export function Loaded<T>({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: T | undefined;
    refetch: () => unknown;
  };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState />;
  if (query.isError || query.data === undefined)
    return (
      <ErrorState
        message={toDisplayError(query.error)?.message ?? 'Could not load this page.'}
        onRetry={() => void query.refetch()}
      />
    );
  return <>{children(query.data)}</>;
}

export function PeriodPicker({
  from,
  to,
  onChange,
  idPrefix = 'period',
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  idPrefix?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-from`}>From</Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-to`}>To</Label>
        <Input
          id={`${idPrefix}-to`}
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
        />
      </div>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (n: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {totalPages}
      </span>
      <Button variant="outline" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  );
}
