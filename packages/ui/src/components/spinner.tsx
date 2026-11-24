import { Loader2Icon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

/** Inline loading indicator. Decorative unless given an aria-label. */
export function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  const labelled = Boolean(props['aria-label']);
  return (
    <Loader2Icon
      role={labelled ? 'status' : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn('size-4 animate-spin text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Centered spinner with a message, for a section that is loading. */
export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground',
        className,
      )}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Horizontal determinate progress bar (0–100). */
export function Progress({
  value,
  className,
  label,
}: {
  value: number;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className="h-full bg-primary transition-[width] duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
