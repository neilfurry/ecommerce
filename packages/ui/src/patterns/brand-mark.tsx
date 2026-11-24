import type { LucideIcon } from 'lucide-react';
import { ShoppingBagIcon } from 'lucide-react';
import { cn } from '../lib/utils';

/** Square logo tile used in headers and sidebars. */
export function BrandMark({
  icon: Icon = ShoppingBagIcon,
  className,
}: {
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm',
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="size-5" />
    </span>
  );
}
