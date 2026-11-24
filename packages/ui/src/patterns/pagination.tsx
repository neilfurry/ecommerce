import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '../components/button';
import { cn } from '../lib/utils';

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  /** Disables navigation while the next page loads. */
  disabled?: boolean;
  className?: string;
}

/** Page window around the current page: 1 … 4 5 [6] 7 8 … 20 */
export function pageWindow(page: number, totalPages: number, radius = 1): (number | 'gap')[] {
  if (totalPages <= 1) return [1];
  const pages = new Set([1, totalPages]);
  for (let p = page - radius; p <= page + radius; p += 1) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  sorted.forEach((p, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && p - previous > 1) result.push('gap');
    result.push(p);
  });
  return result;
}

/** Server-side pagination controls with a "Showing x–y of z" summary. */
export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  disabled = false,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const first = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-col items-center gap-3 sm:flex-row sm:justify-between', className)}
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {totalItems === 0 ? 'No results' : `Showing ${first}–${last} of ${totalItems}`}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeftIcon />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, totalPages).map((item, index) =>
            item === 'gap' ? (
              <span key={`gap-${index}`} className="px-1 text-muted-foreground" aria-hidden="true">
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === page ? 'default' : 'ghost'}
                size="sm"
                className="min-w-8"
                onClick={() => onPageChange(item)}
                disabled={disabled}
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
              >
                {item}
              </Button>
            ),
          )}
        </div>
        <span className="px-2 text-sm text-muted-foreground sm:hidden">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}
