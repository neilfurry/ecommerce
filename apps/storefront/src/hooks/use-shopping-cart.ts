import {
  shopKeys,
  toDisplayError,
  useApiClient,
  useGuestCartPreview,
  useServerCart,
  useServerCartMutations,
  useSession,
} from '@marketplace/api-client';
import type { CartDto } from '@marketplace/validation';
import { toast } from '@marketplace/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { guestCart } from '../lib/guest-cart';

/**
 * One cart for the whole storefront: the account's cart when signed in, the browser cart
 * otherwise (priced by the server either way). After sign-in the browser cart is merged
 * into the account once and cleared.
 */
export function useShoppingCart() {
  const session = useSession();
  const signedIn = !!session.data;
  const lines = useSyncExternalStore(guestCart.subscribe, guestCart.get, () => []);
  const server = useServerCart(signedIn);
  const guestBody = { items: lines };
  const guest = useGuestCartPreview(guestBody, !signedIn && !session.isPending && lines.length > 0);
  const mutations = useServerCartMutations();
  const queryClient = useQueryClient();
  const client = useApiClient();

  // Merge the browser cart into the account after signing in.
  const merging = useRef(false);
  useEffect(() => {
    if (!signedIn || lines.length === 0 || merging.current) return;
    merging.current = true;
    client.shop.cart
      .merge({ items: lines })
      .then((cart) => {
        queryClient.setQueryData(shopKeys.cart, cart);
        guestCart.clear();
        // A checkout opened right after sign-in may have been quoted before the merge.
        return queryClient.invalidateQueries({ queryKey: ['shop', 'checkout'] });
      })
      .catch(() => undefined)
      .finally(() => {
        merging.current = false;
      });
  }, [signedIn, lines, client, queryClient]);

  const empty: CartDto = {
    groups: [],
    saved: [],
    itemCount: 0,
    subtotal: '0.00',
    wholesaleSavings: '0.00',
    currency: 'PHP',
    buyerIsWholesale: false,
    ready: false,
  };
  const cart: CartDto | undefined = signedIn
    ? server.data
    : lines.length === 0
      ? empty
      : guest.data;

  const add = useCallback(
    async (variantId: string, quantity: number) => {
      if (signedIn) {
        await mutations.add.mutateAsync({ variantId, quantity });
      } else {
        guestCart.add({ variantId, quantity });
      }
    },
    [signedIn, mutations.add],
  );

  /** `id` is the cart line id (signed in) or the variant id (guest). */
  const update = useCallback(
    async (id: string, change: { quantity?: number; savedForLater?: boolean }) => {
      try {
        if (signedIn) await mutations.update.mutateAsync({ id, body: change });
        else guestCart.update(id, change);
      } catch (error) {
        toast.error(toDisplayError(error)?.message ?? 'Could not update the cart.');
      }
    },
    [signedIn, mutations.update],
  );

  const remove = useCallback(
    async (id: string) => {
      if (signedIn) await mutations.remove.mutateAsync(id);
      else guestCart.remove(id);
    },
    [signedIn, mutations.remove],
  );

  return {
    cart,
    signedIn,
    isLoading: signedIn ? server.isPending : lines.length > 0 && guest.isPending,
    isError: signedIn ? server.isError : guest.isError,
    error: signedIn ? server.error : guest.error,
    /** Items in the cart (not saved for later), for the header badge. */
    count: signedIn
      ? (server.data?.itemCount ?? 0)
      : lines.filter((l) => !l.savedForLater).reduce((n, l) => n + l.quantity, 0),
    busy: mutations.add.isPending || mutations.update.isPending || mutations.remove.isPending,
    add,
    update,
    remove,
  };
}
