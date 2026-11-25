import type { OrderStatus } from '@marketplace/shared-types';

export const statusVariant = (status: OrderStatus) =>
  status === 'CANCELLED'
    ? ('secondary' as const)
    : status === 'AWAITING_PAYMENT'
      ? ('outline' as const)
      : ('default' as const);
