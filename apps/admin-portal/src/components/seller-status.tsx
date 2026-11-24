import { SELLER_STATUS_LABELS, type SellerStatus } from '@marketplace/shared-types';
import { Badge } from '@marketplace/ui';

const VARIANT: Record<
  SellerStatus,
  'secondary' | 'warning' | 'success' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  UNDER_REVIEW: 'warning',
  VERIFIED: 'success',
  REJECTED: 'destructive',
  SUSPENDED: 'destructive',
  CLOSED: 'outline',
};

export function SellerStatusBadge({ status }: { status: SellerStatus }) {
  return <Badge variant={VARIANT[status]}>{SELLER_STATUS_LABELS[status]}</Badge>;
}
