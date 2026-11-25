import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@marketplace/shared-types';
import { Badge } from '@marketplace/ui';

const VARIANTS: Record<
  ProductStatus,
  'success' | 'secondary' | 'destructive' | 'warning' | 'outline'
> = {
  DRAFT: 'outline',
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'success',
  REJECTED: 'destructive',
  INACTIVE: 'secondary',
  ARCHIVED: 'secondary',
};

export function ProductStatusBadge({
  status,
  takenDown,
}: {
  status: ProductStatus;
  takenDown?: boolean;
}) {
  if (takenDown && status === 'INACTIVE') return <Badge variant="destructive">Taken down</Badge>;
  return <Badge variant={VARIANTS[status]}>{PRODUCT_STATUS_LABELS[status]}</Badge>;
}
