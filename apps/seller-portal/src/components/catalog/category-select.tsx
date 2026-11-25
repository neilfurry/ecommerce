import { useCategories } from '@marketplace/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@marketplace/ui';

/** Active categories, indented by level; the value is the category id. */
export function CategorySelect({
  value,
  onChange,
  id,
  disabled,
  invalid,
}: {
  value: string | undefined;
  onChange: (categoryId: string) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const categories = useCategories();
  const list = categories.data?.categories ?? [];
  return (
    <Select
      value={value ?? ''}
      onValueChange={onChange}
      disabled={disabled || categories.isPending}
    >
      <SelectTrigger id={id} aria-invalid={invalid || undefined}>
        <SelectValue placeholder={categories.isPending ? 'Loading…' : 'Choose a category'} />
      </SelectTrigger>
      <SelectContent>
        {list.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span style={{ paddingLeft: `${c.depth * 1}rem` }}>
              {c.depth > 0 ? `${c.name}` : c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
