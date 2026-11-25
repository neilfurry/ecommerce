import { useWarehouses } from '@marketplace/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@marketplace/ui';

import { ALL_WAREHOUSES } from './constants';

export function WarehouseSelect({
  value,
  onChange,
  id,
  includeAll,
  activeOnly,
  label = 'Warehouse',
}: {
  value: string;
  onChange: (id: string) => void;
  id: string;
  includeAll?: boolean;
  activeOnly?: boolean;
  label?: string;
}) {
  const warehouses = useWarehouses();
  const list = (warehouses.data?.warehouses ?? []).filter(
    (w) => !activeOnly || w.status === 'ACTIVE',
  );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue placeholder="Choose a warehouse" />
      </SelectTrigger>
      <SelectContent>
        {includeAll ? <SelectItem value={ALL_WAREHOUSES}>All warehouses</SelectItem> : null}
        {list.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name} ({w.code}){w.status === 'INACTIVE' ? ' · inactive' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
