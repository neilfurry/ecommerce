import { HttpStatus } from '@nestjs/common';
import type { AuthenticatedUser, SellerStatus } from '@marketplace/shared-types';
import { ApiException } from '../errors/api.exception';

export interface SellerScope {
  sellerId: string;
  memberId: string;
  isOwner: boolean;
  status: SellerStatus;
}

/**
 * The seller a Seller Center request acts for. Every seller-scoped query filters by the
 * returned sellerId, which comes from the user's active membership, never from the request,
 * so one seller can never reach another seller's data.
 */
export function sellerScope(user: AuthenticatedUser): SellerScope {
  if (!user.sellerId || !user.seller) {
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'This action is for seller accounts in the Seller Center.',
    );
  }
  return {
    sellerId: user.seller.id,
    memberId: user.seller.memberId,
    isOwner: user.seller.isOwner,
    status: user.seller.status,
  };
}
