import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddressInput,
  CartDto,
  CartLineInput,
  CheckoutRequest,
  CheckoutSettingsInput,
  CommissionRuleInput,
  CouponInput,
  CreateReviewRequest,
  FlashSaleInput,
  FlashSaleItemInput,
  GuestCartRequest,
  ModerateReviewRequest,
  PlaceOrderRequest,
  ProductSearchQueryInput,
  ShippingRates,
  UpdateBannerRequest,
  UpdateCartLineRequest,
  UpdateCouponRequest,
  UpdateFlashSaleRequest,
  UpdateReviewRequest,
} from '@marketplace/validation';
import { useApiClient } from './react';

type ListQuery = { page?: number; pageSize?: number } & Record<
  string,
  string | number | boolean | undefined
>;

/** Query keys for the storefront, orders and marketing (prefixes allow broad invalidation). */
export const shopKeys = {
  home: ['shop', 'home'] as const,
  search: (query: object) => ['shop', 'search', query] as const,
  suggest: (q: string) => ['shop', 'suggest', q] as const,
  product: (id: string) => ['shop', 'product', id] as const,
  reviews: (id: string, query: object) => ['shop', 'reviews', id, query] as const,
  locations: (parent: string) => ['shop', 'locations', parent] as const,
  cart: ['shop', 'cart'] as const,
  guestCart: (body: object) => ['shop', 'cart', 'guest', body] as const,
  quote: (body: object) => ['shop', 'checkout', 'quote', body] as const,
  addresses: ['account', 'addresses'] as const,
  wishlist: ['account', 'wishlist'] as const,
  myReviews: ['account', 'reviews'] as const,
  orders: ['account', 'orders'] as const,
  orderList: (query: object) => ['account', 'orders', 'list', query] as const,
  order: (id: string) => ['account', 'orders', 'detail', id] as const,
  sellerOrders: (query: object) => ['seller', 'orders', query] as const,
  sellerOrder: (id: string) => ['seller', 'orders', 'detail', id] as const,
  sellerCoupons: (query: object) => ['seller', 'coupons', query] as const,
  sellerFlashSales: ['seller', 'flash-sales'] as const,
  adminOrders: (query: object) => ['admin', 'orders', query] as const,
  adminOrder: (id: string) => ['admin', 'orders', 'detail', id] as const,
  adminSellerOrders: (query: object) => ['admin', 'seller-orders', query] as const,
  adminSellerOrder: (id: string) => ['admin', 'seller-orders', 'detail', id] as const,
  banners: ['admin', 'banners'] as const,
  featured: ['admin', 'featured'] as const,
  adminCoupons: (query: object) => ['admin', 'coupons', query] as const,
  adminFlashSales: ['admin', 'flash-sales'] as const,
  settings: ['admin', 'settings'] as const,
  adminReviews: (query: object) => ['admin', 'reviews', query] as const,
};

// ---- Browsing ------------------------------------------------------------------------------

export function useHomePage() {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.home,
    queryFn: ({ signal }) => client.shop.home(signal),
    staleTime: 60_000,
  });
}

export function useProductSearch(query: ProductSearchQueryInput) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.search(query),
    queryFn: ({ signal }) => client.shop.search(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSearchSuggestions(q: string) {
  const client = useApiClient();
  const term = q.trim();
  return useQuery({
    queryKey: shopKeys.suggest(term),
    queryFn: ({ signal }) => client.shop.suggest(term, signal),
    enabled: term.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useStorefrontProduct(productId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.product(productId ?? ''),
    queryFn: ({ signal }) => client.shop.product(productId!, signal),
    enabled: !!productId,
  });
}

export function useProductReviews(
  productId: string | undefined,
  query: ListQuery & { rating?: number },
) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.reviews(productId ?? '', query),
    queryFn: ({ signal }) => client.shop.reviews(productId!, query, signal),
    enabled: !!productId,
    placeholderData: keepPreviousData,
  });
}

/** One step of the address picker: regions (no parent), then the children of the choice. */
export function useLocations(
  parentCode: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.locations(parentCode ?? 'root'),
    queryFn: ({ signal }) => client.shop.locations(parentCode ?? undefined, signal),
    enabled: (options.enabled ?? true) && parentCode !== null,
    staleTime: 24 * 60 * 60_000,
  });
}

// ---- Cart -------------------------------------------------------------------------------------

/** The signed-in customer's cart (re-priced by the server on every read). */
export function useServerCart(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.cart,
    queryFn: ({ signal }) => client.shop.cart.get(signal),
    enabled,
  });
}

/** A guest's browser cart, priced by the server. */
export function useGuestCartPreview(body: GuestCartRequest, enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.guestCart(body),
    queryFn: ({ signal }) => client.shop.cart.preview(body, signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

function useCartMutation<T>(mutate: (input: T) => Promise<CartDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mutate,
    onSuccess: (cart) => {
      queryClient.setQueryData(shopKeys.cart, cart);
      void queryClient.invalidateQueries({ queryKey: ['shop', 'checkout'] });
    },
  });
}

export function useServerCartMutations() {
  const client = useApiClient();
  return {
    add: useCartMutation((input: CartLineInput) => client.shop.cart.add(input)),
    update: useCartMutation((input: { id: string; body: UpdateCartLineRequest }) =>
      client.shop.cart.update(input.id, input.body),
    ),
    remove: useCartMutation((lineId: string) => client.shop.cart.remove(lineId)),
    merge: useCartMutation((input: GuestCartRequest) => client.shop.cart.merge(input)),
  };
}

// ---- Checkout ----------------------------------------------------------------------------------

export function useCheckoutQuote(body: CheckoutRequest, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.quote(body),
    queryFn: ({ signal }) => client.shop.checkout.quote(body, signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePlaceOrder() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: PlaceOrderRequest; idempotencyKey: string }) =>
      client.shop.checkout.place(input.body, input.idempotencyKey),
    onSuccess: (order) => {
      queryClient.setQueryData(shopKeys.order(order.id), order);
      void queryClient.invalidateQueries({ queryKey: shopKeys.cart });
      void queryClient.invalidateQueries({ queryKey: shopKeys.orders });
      void queryClient.invalidateQueries({ queryKey: ['shop', 'product'] });
    },
  });
}

// ---- Account -----------------------------------------------------------------------------------

export function useAddresses(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.addresses,
    queryFn: ({ signal }) => client.shop.addresses.list(signal),
    enabled,
  });
}

export function useAddressMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: shopKeys.addresses });
    void queryClient.invalidateQueries({ queryKey: ['shop', 'checkout'] });
  };
  return {
    create: useMutation({
      mutationFn: (body: AddressInput) => client.shop.addresses.create(body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; body: AddressInput }) =>
        client.shop.addresses.update(input.id, input.body),
      onSuccess: refresh,
    }),
    setDefault: useMutation({
      mutationFn: (addressId: string) => client.shop.addresses.setDefault(addressId),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (addressId: string) => client.shop.addresses.remove(addressId),
      onSuccess: refresh,
    }),
  };
}

export function useWishlist(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.wishlist,
    queryFn: ({ signal }) => client.shop.wishlist.get(signal),
    enabled,
  });
}

export function useToggleWishlist() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: string; saved: boolean }) =>
      input.saved
        ? client.shop.wishlist.remove(input.productId)
        : client.shop.wishlist.add(input.productId),
    onSuccess: (wishlist, input) => {
      queryClient.setQueryData(shopKeys.wishlist, wishlist);
      void queryClient.invalidateQueries({ queryKey: shopKeys.product(input.productId) });
    },
  });
}

export function useMyReviews(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.myReviews,
    queryFn: ({ signal }) => client.shop.myReviews.get(signal),
    enabled,
  });
}

export function useReviewMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: shopKeys.myReviews });
    void queryClient.invalidateQueries({ queryKey: ['shop'] });
    void queryClient.invalidateQueries({ queryKey: shopKeys.orders });
  };
  return {
    create: useMutation({
      mutationFn: (body: CreateReviewRequest) => client.shop.myReviews.create(body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; body: UpdateReviewRequest }) =>
        client.shop.myReviews.update(input.id, input.body),
      onSuccess,
    }),
  };
}

export function useMyOrders(query: ListQuery, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.orderList(query),
    queryFn: ({ signal }) => client.shop.orders.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMyOrder(orderId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.order(orderId ?? ''),
    queryFn: ({ signal }) => client.shop.orders.get(orderId!, signal),
    enabled: !!orderId,
  });
}

export function useCancelOrder() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderId: string; reason: string }) =>
      client.shop.orders.cancel(input.orderId, input.reason),
    onSuccess: (order) => {
      queryClient.setQueryData(shopKeys.order(order.id), order);
      void queryClient.invalidateQueries({ queryKey: shopKeys.orders });
    },
  });
}

// ---- Seller Center ---------------------------------------------------------------------------

export function useSellerOrders(query: ListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.sellerOrders(query),
    queryFn: ({ signal }) => client.seller.shop.orders.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSellerOrder(orderId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.sellerOrder(orderId ?? ''),
    queryFn: ({ signal }) => client.seller.shop.orders.get(orderId!, signal),
    enabled: !!orderId,
  });
}

export function useSellerCoupons(query: ListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.sellerCoupons(query),
    queryFn: ({ signal }) => client.seller.shop.coupons.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSellerCouponMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => void queryClient.invalidateQueries({ queryKey: ['seller', 'coupons'] });
  return {
    create: useMutation({
      mutationFn: (body: CouponInput) => client.seller.shop.coupons.create(body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; body: UpdateCouponRequest }) =>
        client.seller.shop.coupons.update(input.id, input.body),
      onSuccess,
    }),
  };
}

export function useSellerFlashSales() {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.sellerFlashSales,
    queryFn: ({ signal }) => client.seller.shop.flashSales.list(signal),
  });
}

export function useSellerFlashSaleMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () =>
    void queryClient.invalidateQueries({ queryKey: shopKeys.sellerFlashSales });
  return {
    addItem: useMutation({
      mutationFn: (input: { saleId: string; body: FlashSaleItemInput }) =>
        client.seller.shop.flashSales.addItem(input.saleId, input.body),
      onSuccess,
    }),
    removeItem: useMutation({
      mutationFn: (itemId: string) => client.seller.shop.flashSales.removeItem(itemId),
      onSuccess,
    }),
  };
}

// ---- Admin Console ------------------------------------------------------------------------------

export function useAdminOrders(query: ListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminOrders(query),
    queryFn: ({ signal }) => client.admin.shop.orders.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminOrder(orderId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminOrder(orderId ?? ''),
    queryFn: ({ signal }) => client.admin.shop.orders.get(orderId!, signal),
    enabled: !!orderId,
  });
}

/** Seller suborders across all sellers (Admin Console). */
export function useAdminSellerOrders(query: ListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminSellerOrders(query),
    queryFn: ({ signal }) => client.admin.shop.sellerOrders.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminSellerOrder(orderId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminSellerOrder(orderId ?? ''),
    queryFn: ({ signal }) => client.admin.shop.sellerOrders.get(orderId!, signal),
    enabled: !!orderId,
  });
}

export function useBanners() {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.banners,
    queryFn: ({ signal }) => client.admin.shop.banners.list(signal),
  });
}

export function useBannerMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: shopKeys.banners });
    void queryClient.invalidateQueries({ queryKey: shopKeys.home });
  };
  return {
    create: useMutation({
      mutationFn: (form: FormData) => client.admin.shop.banners.create(form),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; body: UpdateBannerRequest }) =>
        client.admin.shop.banners.update(input.id, input.body),
      onSuccess,
    }),
    replaceImage: useMutation({
      mutationFn: (input: { id: string; file: File }) =>
        client.admin.shop.banners.replaceImage(input.id, input.file),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (bannerId: string) => client.admin.shop.banners.remove(bannerId),
      onSuccess,
    }),
  };
}

export function useFeatured() {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.featured,
    queryFn: ({ signal }) => client.admin.shop.featured.get(signal),
  });
}

export function useFeaturedMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = (data: unknown) => queryClient.setQueryData(shopKeys.featured, data);
  return {
    putProducts: useMutation({
      mutationFn: (ids: string[]) => client.admin.shop.featured.putProducts(ids),
      onSuccess,
    }),
    putStores: useMutation({
      mutationFn: (ids: string[]) => client.admin.shop.featured.putStores(ids),
      onSuccess,
    }),
  };
}

export function useAdminCoupons(query: ListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminCoupons(query),
    queryFn: ({ signal }) => client.admin.shop.coupons.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminCouponMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
  return {
    create: useMutation({
      mutationFn: (body: CouponInput) => client.admin.shop.coupons.create(body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; body: UpdateCouponRequest }) =>
        client.admin.shop.coupons.update(input.id, input.body),
      onSuccess,
    }),
  };
}

export function useAdminFlashSales() {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminFlashSales,
    queryFn: ({ signal }) => client.admin.shop.flashSales.list(signal),
  });
}

export function useAdminFlashSaleMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () =>
    void queryClient.invalidateQueries({ queryKey: shopKeys.adminFlashSales });
  return {
    create: useMutation({
      mutationFn: (body: FlashSaleInput) => client.admin.shop.flashSales.create(body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; body: UpdateFlashSaleRequest }) =>
        client.admin.shop.flashSales.update(input.id, input.body),
      onSuccess,
    }),
    setItemStatus: useMutation({
      mutationFn: (input: { itemId: string; status: 'ACTIVE' | 'INACTIVE' }) =>
        client.admin.shop.flashSales.setItemStatus(input.itemId, input.status),
      onSuccess,
    }),
  };
}

export function usePlatformSettings() {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.settings,
    queryFn: ({ signal }) => client.admin.shop.settings.get(signal),
  });
}

export function useSettingsMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => void queryClient.invalidateQueries({ queryKey: shopKeys.settings });
  return {
    checkout: useMutation({
      mutationFn: (body: CheckoutSettingsInput) => client.admin.shop.settings.putCheckout(body),
      onSuccess,
    }),
    shippingRates: useMutation({
      mutationFn: (body: ShippingRates) => client.admin.shop.settings.putShippingRates(body),
      onSuccess,
    }),
    putCommission: useMutation({
      mutationFn: (body: CommissionRuleInput) => client.admin.shop.settings.putCommission(body),
      onSuccess,
    }),
    removeCommission: useMutation({
      mutationFn: (ruleId: string) => client.admin.shop.settings.removeCommission(ruleId),
      onSuccess,
    }),
  };
}

export function useAdminReviews(query: ListQuery) {
  const client = useApiClient();
  return useQuery({
    queryKey: shopKeys.adminReviews(query),
    queryFn: ({ signal }) => client.admin.shop.reviews.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useModerateReview() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: ModerateReviewRequest }) =>
      client.admin.shop.reviews.moderate(input.id, input.body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] }),
  });
}
