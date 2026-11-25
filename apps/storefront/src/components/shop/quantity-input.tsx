import { Button, cn } from '@marketplace/ui';
import { MinusIcon, PlusIcon } from 'lucide-react';

/** − [ n ] + with keyboard input; never below `min` or above `max`. */
export function QuantityInput({
  value,
  onChange,
  min = 1,
  max,
  label = 'Quantity',
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number | null;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const clamp = (n: number) => Math.max(min, max ? Math.min(max, n) : n);
  return (
    <div className={cn('inline-flex items-center rounded-md border', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-r-none"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <MinusIcon aria-hidden="true" />
      </Button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        className="h-9 w-14 border-x bg-transparent text-center text-sm [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        value={value}
        min={min}
        max={max ?? undefined}
        disabled={disabled}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-l-none"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={disabled || (!!max && value >= max)}
        onClick={() => onChange(clamp(value + 1))}
      >
        <PlusIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
