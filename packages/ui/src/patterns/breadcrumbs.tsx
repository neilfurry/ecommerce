import { ChevronRightIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { cn } from '../lib/utils';

export interface BreadcrumbItem {
  label: string;
  /** Omit for the current page (rendered as plain text). */
  to?: string;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="inline-flex items-center">
                {item.to && !isLast ? (
                  <Link to={item.to} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={cn(isLast && 'font-medium text-foreground')}
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast ? (
                <li role="presentation" aria-hidden="true">
                  <ChevronRightIcon className="size-3.5" />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
