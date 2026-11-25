import {
  type AddressDto,
  type AddressInput,
  type AdminOrderDetail,
  adminOrderDetailSchema,
  type AdminOrderList,
  adminOrderListSchema,
  type AdminReviewList,
  adminReviewListSchema,
  type BannerAdminDto,
  bannerAdminListSchema,
  bannerAdminSchema,
  type CartDto,
  type CartLineInput,
  cartSchema,
  type CheckoutQuote,
  checkoutQuoteSchema,
  type CheckoutRequest,
  type CheckoutSettingsInput,
  checkoutSettingsSchema,
  type CommissionRuleInput,
  commissionRuleListSchema,
  type CouponDto,
  type CouponInput,
  type CouponList,
  couponListSchema,
  couponSchema,
  customerAddressListSchema,
  customerAddressSchema,
  type CreateReviewRequest,
  type FeaturedItems,
  featuredItemsSchema,
  type FlashSaleDto,
  type FlashSaleInput,
  type FlashSaleItemInput,
  flashSaleListSchema,
  flashSaleSchema,
  type GuestCartRequest,
  type HomePage,
  homePageSchema,
  type LocationDto,
  locationListSchema,
  type ModerateReviewRequest,
  type MyReviews,
  myReviewsSchema,
  type OrderDetail,
  orderDetailSchema,
  type OrderList,
  orderListSchema,
  type PlaceOrderRequest,
  type PlatformSettings,
  platformSettingsSchema,
  type ProductSearchQueryInput,
  type ProductSearchResult,
  productSearchResultSchema,
  type ReviewList,
  reviewListSchema,
  type SearchSuggestions,
  searchSuggestionSchema,
  type SellerOrderDetail,
  sellerOrderDetailSchema,
  type SellerOrderList,
  sellerOrderListSchema,
  type ShippingRates,
  shippingRatesSchema,
  type StorefrontProduct,
  storefrontProductSchema,
  type UpdateBannerRequest,
  type UpdateCartLineRequest,
  type UpdateCouponRequest,
  type UpdateFlashSaleRequest,
  type UpdateReviewRequest,
  type Wishlist,
  wishlistSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;
type Query = Record<string, string | number | boolean | undefined>;
type ListQuery = { page?: number; pageSize?: number } & Record<
  string,
  string | number | boolean | undefined
>;

const id = (value: string) => encodeURIComponent(value);
const asQuery = (value: object): Query =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
  ) as Query;
const noContent = z.unknown();
const items = <T extends z.ZodType>(schema: T) => z.object({ items: z.array(schema) });

/** Storefront: home page, search, product pages, cart, checkout and the customer's account. */
export function createShopClient(request: Request) {
  return {
    home: (signal?: AbortSignal): Promise<HomePage> =>
      request('/storefront/home', { schema: homePageSchema, signal }),
    search: (query: ProductSearchQueryInput, signal?: AbortSignal): Promise<ProductSearchResult> =>
      request('/catalog/products', {
        query: asQuery(query),
        schema: productSearchResultSchema,
        signal,
      }),
    suggest: (q: string, signal?: AbortSignal): Promise<SearchSuggestions> =>
      request('/catalog/suggest', { query: { q }, schema: searchSuggestionSchema, signal }),
    product: (productId: string, signal?: AbortSignal): Promise<StorefrontProduct> =>
      request(`/catalog/products/${id(productId)}`, { schema: storefrontProductSchema, signal }),
    reviews: (
      productId: string,
      query: ListQuery & { rating?: number },
      signal?: AbortSignal,
    ): Promise<ReviewList> =>
      request(`/catalog/products/${id(productId)}/reviews`, {
        query: asQuery(query),
        schema: reviewListSchema,
        signal,
      }),
    locations: async (parentCode?: string, signal?: AbortSignal): Promise<LocationDto[]> =>
      (
        await request('/locations', {
          query: asQuery({ parentCode }),
          schema: locationListSchema,
          signal,
        })
      ).items,

    cart: {
      get: (signal?: AbortSignal): Promise<CartDto> =>
        request('/cart', { schema: cartSchema, signal }),
      add: (body: CartLineInput): Promise<CartDto> =>
        request('/cart/items', { method: 'POST', body, schema: cartSchema }),
      update: (lineId: string, body: UpdateCartLineRequest): Promise<CartDto> =>
        request(`/cart/items/${id(lineId)}`, { method: 'PATCH', body, schema: cartSchema }),
      remove: (lineId: string): Promise<CartDto> =>
        request(`/cart/items/${id(lineId)}`, { method: 'DELETE', schema: cartSchema }),
      merge: (body: GuestCartRequest): Promise<CartDto> =>
        request('/cart/merge', { method: 'POST', body, schema: cartSchema }),
      /** Prices a guest's browser cart. */
      preview: (body: GuestCartRequest, signal?: AbortSignal): Promise<CartDto> =>
        request('/cart/preview', { method: 'POST', body, schema: cartSchema, signal }),
    },

    checkout: {
      quote: (body: CheckoutRequest, signal?: AbortSignal): Promise<CheckoutQuote> =>
        request('/checkout/quote', { method: 'POST', body, schema: checkoutQuoteSchema, signal }),
      /** `idempotencyKey`: one per checkout attempt, reused when retrying the same attempt. */
      place: (body: PlaceOrderRequest, idempotencyKey: string): Promise<OrderDetail> =>
        request('/checkout/orders', {
          method: 'POST',
          body,
          schema: orderDetailSchema,
          headers: { 'Idempotency-Key': idempotencyKey },
        }),
    },

    addresses: {
      list: async (signal?: AbortSignal): Promise<AddressDto[]> =>
        (await request('/account/addresses', { schema: customerAddressListSchema, signal })).items,
      create: (body: AddressInput): Promise<AddressDto> =>
        request('/account/addresses', { method: 'POST', body, schema: customerAddressSchema }),
      update: (addressId: string, body: AddressInput): Promise<AddressDto> =>
        request(`/account/addresses/${id(addressId)}`, {
          method: 'PUT',
          body,
          schema: customerAddressSchema,
        }),
      setDefault: async (addressId: string): Promise<AddressDto[]> =>
        (
          await request(`/account/addresses/${id(addressId)}/default`, {
            method: 'POST',
            schema: customerAddressListSchema,
          })
        ).items,
      remove: (addressId: string): Promise<unknown> =>
        request(`/account/addresses/${id(addressId)}`, { method: 'DELETE', schema: noContent }),
    },

    wishlist: {
      get: (signal?: AbortSignal): Promise<Wishlist> =>
        request('/account/wishlist', { schema: wishlistSchema, signal }),
      add: (productId: string): Promise<Wishlist> =>
        request(`/account/wishlist/${id(productId)}`, { method: 'PUT', schema: wishlistSchema }),
      remove: (productId: string): Promise<Wishlist> =>
        request(`/account/wishlist/${id(productId)}`, { method: 'DELETE', schema: wishlistSchema }),
    },

    myReviews: {
      get: (signal?: AbortSignal): Promise<MyReviews> =>
        request('/account/reviews', { schema: myReviewsSchema, signal }),
      create: (body: CreateReviewRequest): Promise<MyReviews> =>
        request('/account/reviews', { method: 'POST', body, schema: myReviewsSchema }),
      update: (reviewId: string, body: UpdateReviewRequest): Promise<MyReviews> =>
        request(`/account/reviews/${id(reviewId)}`, {
          method: 'PUT',
          body,
          schema: myReviewsSchema,
        }),
    },

    orders: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<OrderList> =>
        request('/account/orders', { query: asQuery(query), schema: orderListSchema, signal }),
      get: (orderId: string, signal?: AbortSignal): Promise<OrderDetail> =>
        request(`/account/orders/${id(orderId)}`, { schema: orderDetailSchema, signal }),
      cancel: (orderId: string, reason: string): Promise<OrderDetail> =>
        request(`/account/orders/${id(orderId)}/cancel`, {
          method: 'POST',
          body: { reason },
          schema: orderDetailSchema,
        }),
    },
  };
}

/** Seller Center: suborders, coupons and flash sale participation. */
export function createSellerShopClient(request: Request) {
  return {
    orders: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<SellerOrderList> =>
        request('/seller/orders', { query: asQuery(query), schema: sellerOrderListSchema, signal }),
      get: (orderId: string, signal?: AbortSignal): Promise<SellerOrderDetail> =>
        request(`/seller/orders/${id(orderId)}`, { schema: sellerOrderDetailSchema, signal }),
    },
    coupons: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<CouponList> =>
        request('/seller/coupons', { query: asQuery(query), schema: couponListSchema, signal }),
      create: (body: CouponInput): Promise<CouponDto> =>
        request('/seller/coupons', { method: 'POST', body, schema: couponSchema }),
      update: (couponId: string, body: UpdateCouponRequest): Promise<CouponDto> =>
        request(`/seller/coupons/${id(couponId)}`, { method: 'PATCH', body, schema: couponSchema }),
    },
    flashSales: {
      list: async (signal?: AbortSignal): Promise<FlashSaleDto[]> =>
        (await request('/seller/flash-sales', { schema: flashSaleListSchema, signal })).items,
      addItem: (saleId: string, body: FlashSaleItemInput): Promise<FlashSaleDto> =>
        request(`/seller/flash-sales/${id(saleId)}/items`, {
          method: 'POST',
          body,
          schema: flashSaleSchema,
        }),
      removeItem: (itemId: string): Promise<FlashSaleDto> =>
        request(`/seller/flash-sales/items/${id(itemId)}`, {
          method: 'DELETE',
          schema: flashSaleSchema,
        }),
    },
  };
}

/** Admin Console: orders, marketing content, coupons, flash sales, settings and reviews. */
export function createAdminShopClient(request: Request) {
  return {
    orders: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<AdminOrderList> =>
        request('/orders', { query: asQuery(query), schema: adminOrderListSchema, signal }),
      get: (orderId: string, signal?: AbortSignal): Promise<AdminOrderDetail> =>
        request(`/orders/${id(orderId)}`, { schema: adminOrderDetailSchema, signal }),
    },
    sellerOrders: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<SellerOrderList> =>
        request('/seller-orders', { query: asQuery(query), schema: sellerOrderListSchema, signal }),
      get: (orderId: string, signal?: AbortSignal): Promise<SellerOrderDetail> =>
        request(`/seller-orders/${id(orderId)}`, { schema: sellerOrderDetailSchema, signal }),
    },
    banners: {
      list: async (signal?: AbortSignal): Promise<BannerAdminDto[]> =>
        (await request('/storefront/banners', { schema: bannerAdminListSchema, signal })).items,
      /** Multipart: `file` plus the banner fields as text. */
      create: (form: FormData): Promise<BannerAdminDto> =>
        request('/storefront/banners', { method: 'POST', body: form, schema: bannerAdminSchema }),
      update: (bannerId: string, body: UpdateBannerRequest): Promise<BannerAdminDto> =>
        request(`/storefront/banners/${id(bannerId)}`, {
          method: 'PATCH',
          body,
          schema: bannerAdminSchema,
        }),
      replaceImage: (bannerId: string, file: File): Promise<BannerAdminDto> => {
        const form = new FormData();
        form.append('file', file);
        return request(`/storefront/banners/${id(bannerId)}/image`, {
          method: 'PUT',
          body: form,
          schema: bannerAdminSchema,
        });
      },
      remove: (bannerId: string): Promise<unknown> =>
        request(`/storefront/banners/${id(bannerId)}`, { method: 'DELETE', schema: noContent }),
    },
    featured: {
      get: (signal?: AbortSignal): Promise<FeaturedItems> =>
        request('/storefront/featured', { schema: featuredItemsSchema, signal }),
      putProducts: (productIds: string[]): Promise<FeaturedItems> =>
        request('/storefront/featured/products', {
          method: 'PUT',
          body: { productIds },
          schema: featuredItemsSchema,
        }),
      putStores: (storeIds: string[]): Promise<FeaturedItems> =>
        request('/storefront/featured/stores', {
          method: 'PUT',
          body: { storeIds },
          schema: featuredItemsSchema,
        }),
    },
    coupons: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<CouponList> =>
        request('/coupons', { query: asQuery(query), schema: couponListSchema, signal }),
      create: (body: CouponInput): Promise<CouponDto> =>
        request('/coupons', { method: 'POST', body, schema: couponSchema }),
      update: (couponId: string, body: UpdateCouponRequest): Promise<CouponDto> =>
        request(`/coupons/${id(couponId)}`, { method: 'PATCH', body, schema: couponSchema }),
    },
    flashSales: {
      list: async (signal?: AbortSignal): Promise<FlashSaleDto[]> =>
        (await request('/flash-sales', { schema: flashSaleListSchema, signal })).items,
      create: (body: FlashSaleInput): Promise<FlashSaleDto> =>
        request('/flash-sales', { method: 'POST', body, schema: flashSaleSchema }),
      update: (saleId: string, body: UpdateFlashSaleRequest): Promise<FlashSaleDto> =>
        request(`/flash-sales/${id(saleId)}`, { method: 'PATCH', body, schema: flashSaleSchema }),
      setItemStatus: (itemId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<FlashSaleDto> =>
        request(`/flash-sales/items/${id(itemId)}`, {
          method: 'PATCH',
          body: { status },
          schema: flashSaleSchema,
        }),
    },
    settings: {
      get: (signal?: AbortSignal): Promise<PlatformSettings> =>
        request('/settings', { schema: platformSettingsSchema, signal }),
      putCheckout: (body: CheckoutSettingsInput) =>
        request('/settings/checkout', { method: 'PUT', body, schema: checkoutSettingsSchema }),
      putShippingRates: (body: ShippingRates) =>
        request('/settings/shipping-rates', { method: 'PUT', body, schema: shippingRatesSchema }),
      putCommission: async (body: CommissionRuleInput) =>
        (
          await request('/settings/commission-rules', {
            method: 'PUT',
            body,
            schema: commissionRuleListSchema,
          })
        ).items,
      removeCommission: async (ruleId: string) =>
        (
          await request(`/settings/commission-rules/${id(ruleId)}`, {
            method: 'DELETE',
            schema: commissionRuleListSchema,
          })
        ).items,
    },
    reviews: {
      list: (query: ListQuery, signal?: AbortSignal): Promise<AdminReviewList> =>
        request('/reviews', { query: asQuery(query), schema: adminReviewListSchema, signal }),
      moderate: (reviewId: string, body: ModerateReviewRequest): Promise<unknown> =>
        request(`/reviews/${id(reviewId)}`, { method: 'PATCH', body, schema: noContent }),
    },
  };
}

export { items };
