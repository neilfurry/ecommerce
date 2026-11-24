import type { StoreStatus } from '@marketplace/shared-types';
import { Badge } from '@marketplace/ui';

const LABELS: Record<
  StoreStatus,
  { label: string; variant: 'success' | 'secondary' | 'destructive' }
> = {
  ACTIVE: { label: 'Open', variant: 'success' },
  INACTIVE: { label: 'Hidden', variant: 'secondary' },
  SUSPENDED: { label: 'Suspended', variant: 'destructive' },
};

export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  return <Badge variant={LABELS[status].variant}>{LABELS[status].label}</Badge>;
}
