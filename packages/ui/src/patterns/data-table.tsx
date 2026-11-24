import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '../components/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { cn } from '../lib/utils';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { Pagination } from './pagination';

export interface DataTableColumn<TRow> {
  id: string;
  header: ReactNode;
  cell: (row: TRow) => ReactNode;
  className?: string;
  /** Hide on narrow screens (below the md breakpoint). */
  hideOnMobile?: boolean;
}

export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  rows: TRow[] | undefined;
  getRowId: (row: TRow) => string;
  isLoading: boolean;
  error?: { message: string; requestId?: string } | null;
  onRetry?: () => void;
  empty: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode };
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
    isFetching?: boolean;
  };
  /** Accessible name of the table. */
  label: string;
}

/**
 * Table with built-in loading skeleton, error, empty state and server-side pagination,
 * so every list page in the portals behaves the same way.
 */
export function DataTable<TRow>({
  columns,
  rows,
  getRowId,
  isLoading,
  error,
  onRetry,
  empty,
  pagination,
  label,
}: DataTableProps<TRow>) {
  if (error && !rows) {
    return (
      <ErrorState
        title="Could not load data"
        message={error.message}
        requestId={error.requestId}
        onRetry={onRetry}
      />
    );
  }
  if (!isLoading && rows && rows.length === 0) {
    return <EmptyState {...empty} />;
  }

  const hidden = (column: DataTableColumn<TRow>) =>
    column.hideOnMobile ? 'hidden md:table-cell' : undefined;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <Table aria-label={label} aria-busy={isLoading}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.id} className={cn(hidden(column), column.className)}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || !rows
              ? Array.from({ length: 3 }, (_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    {columns.map((column) => (
                      <TableCell key={column.id} className={hidden(column)}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow key={getRowId(row)}>
                    {columns.map((column) => (
                      <TableCell key={column.id} className={cn(hidden(column), column.className)}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      {pagination && rows ? (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={pagination.onPageChange}
          disabled={pagination.isFetching}
        />
      ) : null}
    </div>
  );
}
