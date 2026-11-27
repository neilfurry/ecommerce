import {
  PROMOTION_APPLIES_TO,
  PROMOTION_APPLIES_TO_LABELS,
  type PromotionAppliesTo,
} from '@marketplace/shared-types';
import { Label } from '@marketplace/ui';

export interface TargetOptions {
  products?: { id: string; name: string }[];
  categories?: { id: string; name: string }[];
}

export interface TargetValue {
  appliesTo: PromotionAppliesTo;
  productIds: string[];
  categoryIds: string[];
}

/**
 * Which items a coupon or campaign covers: everything, chosen products or chosen categories
 * (categories include their subcategories). Native controls, so it works with any input.
 */
export function TargetPicker({
  value,
  onChange,
  options,
  disabled,
  error,
}: {
  value: TargetValue;
  onChange: (next: TargetValue) => void;
  options: TargetOptions;
  disabled?: boolean;
  error?: string;
}) {
  const choices = PROMOTION_APPLIES_TO.filter(
    (a) =>
      a === 'ALL' ||
      (a === 'PRODUCTS' && (options.products?.length ?? 0) > 0) ||
      (a === 'CATEGORIES' && (options.categories?.length ?? 0) > 0),
  );
  const list =
    value.appliesTo === 'PRODUCTS'
      ? options.products
      : value.appliesTo === 'CATEGORIES'
        ? options.categories
        : null;
  const selected = value.appliesTo === 'PRODUCTS' ? value.productIds : value.categoryIds;
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(
      value.appliesTo === 'PRODUCTS'
        ? { ...value, productIds: next }
        : { ...value, categoryIds: next },
    );
  };
  return (
    <fieldset className="grid gap-2 sm:col-span-2" disabled={disabled}>
      <Label htmlFor="promotion-applies-to">Applies to</Label>
      <select
        id="promotion-applies-to"
        className="h-9 rounded-md border bg-background px-3 text-sm"
        value={value.appliesTo}
        onChange={(e) => onChange({ ...value, appliesTo: e.target.value as PromotionAppliesTo })}
      >
        {choices.map((a) => (
          <option key={a} value={a}>
            {PROMOTION_APPLIES_TO_LABELS[a]}
          </option>
        ))}
      </select>
      {list ? (
        <div
          className="max-h-40 overflow-y-auto rounded-md border p-2"
          role="group"
          aria-label={PROMOTION_APPLIES_TO_LABELS[value.appliesTo]}
        >
          {list.map((item) => (
            <label key={item.id} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)}
              />
              {item.name}
            </label>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </fieldset>
  );
}
