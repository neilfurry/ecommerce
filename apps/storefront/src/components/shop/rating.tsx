import { cn } from '@marketplace/ui';
import { StarIcon } from 'lucide-react';

/** Read-only star rating (rounded to half stars visually via width). */
export function Stars({
  value,
  className,
  size = 'sm',
}: {
  value: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const box = size === 'sm' ? 'size-3.5' : 'size-5';
  return (
    <span
      className={cn('relative inline-flex', className)}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      <span className="flex text-muted-foreground/30" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <StarIcon key={i} className={cn(box, 'fill-current')} />
        ))}
      </span>
      <span
        className="absolute inset-0 flex overflow-hidden text-amber-500"
        style={{ width: `${(Math.max(0, Math.min(5, value)) / 5) * 100}%` }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <StarIcon key={i} className={cn(box, 'shrink-0 fill-current')} />
        ))}
      </span>
    </span>
  );
}

/** "4.8 ★ (120)" */
export function RatingSummary({ average, count }: { average: number; count: number }) {
  if (count === 0) return <span className="text-xs text-muted-foreground">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Stars value={average} />
      <span>
        {average.toFixed(1)} ({count})
      </span>
    </span>
  );
}

/** Choose 1–5 stars (keyboard friendly radio group). */
export function StarInput({
  value,
  onChange,
  name = 'rating',
}: {
  value: number;
  onChange: (v: number) => void;
  name?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="peer sr-only"
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          />
          <StarIcon
            aria-hidden="true"
            className={cn(
              'size-7 rounded peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
              n <= value ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/40',
            )}
          />
        </label>
      ))}
    </div>
  );
}
