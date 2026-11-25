import {
  type BrandDto,
  type BrandList,
  brandListSchema,
  type BrandListQuery,
  brandSchema,
  type CategoryAttributes,
  categoryAttributesSchema,
  type CategoryDto,
  type CategoryList,
  categoryListSchema,
  categorySchema,
  type CreateBrandRequest,
  type CreateCategoryRequest,
  type CreateProductRequest,
  type CreateTransferRequest,
  type CreateWarehouseRequest,
  type CustomerPriceDto,
  type CustomerPriceInput,
  customerPriceListSchema,
  type DevReserveRequest,
  type InventoryOverview,
  inventoryOverviewSchema,
  type InventorySummary,
  inventorySummarySchema,
  type MovementList,
  movementListSchema,
  type MovementListQuery,
  type MovementResult,
  movementResultSchema,
  type PricePreviewRequest,
  type PriceQuote,
  type PriceQuoteLine,
  priceQuoteLineSchema,
  type PriceQuoteRequest,
  priceQuoteSchema,
  type ProductDetail,
  productDetailSchema,
  type ProductList,
  productListSchema,
  type ProductListQuery,
  type ProductPricingRequest,
  type PutCategoryAttributesRequest,
  type PutPriceTiersRequest,
  type RecordMovementRequest,
  type ReservationDto,
  type ReservationList,
  reservationListSchema,
  reservationSchema,
  type ReviewBrandRequest,
  type ReviewProductRequest,
  type SetProductOptionsRequest,
  type StockLevelDto,
  type StockLevelList,
  stockLevelListSchema,
  type StockLevelListQuery,
  stockLevelSchema,
  type TransferDto,
  type TransferList,
  transferListSchema,
  transferSchema,
  type UpdateBrandRequest,
  type UpdateCategoryRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  type UpdateWarehouseRequest,
  type WarehouseList,
  warehouseListSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;
type Query = Record<string, string | number | boolean | undefined>;

const id = (value: string) => encodeURIComponent(value);
const asQuery = (value: object): Query => value as Query;

/** Categories, brands, public catalog and price quotes (any app). */
export function createCatalogClient(request: Request) {
  return {
    categories: (signal?: AbortSignal): Promise<CategoryList> =>
      request('/categories', { schema: categoryListSchema, signal }),
    categoryAttributes: (categoryId: string, signal?: AbortSignal): Promise<CategoryAttributes> =>
      request(`/categories/${id(categoryId)}/attributes`, {
        schema: categoryAttributesSchema,
        signal,
      }),
    brands: (query: Partial<BrandListQuery>, signal?: AbortSignal): Promise<BrandList> =>
      request('/brands', { query: asQuery(query), schema: brandListSchema, signal }),
    /** The server's price for the signed-in customer; only ids and quantities are sent. */
    quote: (body: PriceQuoteRequest): Promise<PriceQuote> =>
      request('/pricing/quote', { method: 'POST', body, schema: priceQuoteSchema }),
  };
}

/** Seller Center: products, pricing and inventory of the signed-in seller. */
export function createSellerCatalogClient(request: Request) {
  const product = (productId: string, suffix = '') => `/products/${id(productId)}${suffix}`;
  const detail = { schema: productDetailSchema };
  return {
    requestBrand: (body: CreateBrandRequest): Promise<BrandDto> =>
      request('/brands/requests', { method: 'POST', body, schema: brandSchema }),
    products: {
      list: (query: Partial<ProductListQuery>, signal?: AbortSignal): Promise<ProductList> =>
        request('/products/mine', { query: asQuery(query), schema: productListSchema, signal }),
      get: (productId: string, signal?: AbortSignal): Promise<ProductDetail> =>
        request(product(productId), { ...detail, signal }),
      create: (body: CreateProductRequest): Promise<ProductDetail> =>
        request('/products', { method: 'POST', body, ...detail }),
      update: (productId: string, body: UpdateProductRequest): Promise<ProductDetail> =>
        request(product(productId), { method: 'PATCH', body, ...detail }),
      setOptions: (productId: string, body: SetProductOptionsRequest): Promise<ProductDetail> =>
        request(product(productId, '/options'), { method: 'PUT', body, ...detail }),
      updateVariant: (
        productId: string,
        variantId: string,
        body: UpdateVariantRequest,
      ): Promise<ProductDetail> =>
        request(product(productId, `/variants/${id(variantId)}`), {
          method: 'PATCH',
          body,
          ...detail,
        }),
      action: (
        productId: string,
        action: 'submit' | 'deactivate' | 'activate' | 'archive' | 'restore',
      ): Promise<ProductDetail> =>
        request(product(productId, `/${action}`), { method: 'POST', ...detail }),
      addImage: (
        productId: string,
        file: File,
        fields: { altText?: string; variantId?: string } = {},
      ): Promise<ProductDetail> => {
        const form = new FormData();
        if (fields.altText) form.append('altText', fields.altText);
        if (fields.variantId) form.append('variantId', fields.variantId);
        form.append('file', file);
        return request(product(productId, '/images'), { method: 'POST', body: form, ...detail });
      },
      replaceImage: (productId: string, imageId: string, file: File): Promise<ProductDetail> => {
        const form = new FormData();
        form.append('file', file);
        return request(product(productId, `/images/${id(imageId)}/file`), {
          method: 'PUT',
          body: form,
          ...detail,
        });
      },
      updateImage: (
        productId: string,
        imageId: string,
        body: { altText?: string | null; variantId?: string | null },
      ): Promise<ProductDetail> =>
        request(product(productId, `/images/${id(imageId)}`), { method: 'PATCH', body, ...detail }),
      reorderImages: (productId: string, imageIds: string[]): Promise<ProductDetail> =>
        request(product(productId, '/images/order'), {
          method: 'PUT',
          body: { imageIds },
          ...detail,
        }),
      removeImage: (productId: string, imageId: string): Promise<ProductDetail> =>
        request(product(productId, `/images/${id(imageId)}`), { method: 'DELETE', ...detail }),
      setPricing: (productId: string, body: ProductPricingRequest): Promise<ProductDetail> =>
        request(product(productId, '/pricing'), { method: 'PUT', body, ...detail }),
      setTiers: (productId: string, body: PutPriceTiersRequest): Promise<ProductDetail> =>
        request(product(productId, '/price-tiers'), { method: 'PUT', body, ...detail }),
      customerPrices: (
        productId: string,
        signal?: AbortSignal,
      ): Promise<{ items: CustomerPriceDto[] }> =>
        request(product(productId, '/customer-prices'), {
          schema: customerPriceListSchema,
          signal,
        }),
      addCustomerPrice: (
        productId: string,
        body: CustomerPriceInput,
      ): Promise<{ items: CustomerPriceDto[] }> =>
        request(product(productId, '/customer-prices'), {
          method: 'POST',
          body,
          schema: customerPriceListSchema,
        }),
      removeCustomerPrice: (
        productId: string,
        priceId: string,
      ): Promise<{ items: CustomerPriceDto[] }> =>
        request(product(productId, `/customer-prices/${id(priceId)}`), {
          method: 'DELETE',
          schema: customerPriceListSchema,
        }),
      previewPrice: (productId: string, body: PricePreviewRequest): Promise<PriceQuoteLine> =>
        request(product(productId, '/price-preview'), {
          method: 'POST',
          body,
          schema: priceQuoteLineSchema,
        }),
    },
    inventory: {
      summary: (signal?: AbortSignal): Promise<InventorySummary> =>
        request('/inventory/summary', { schema: inventorySummarySchema, signal }),
      warehouses: (signal?: AbortSignal): Promise<WarehouseList> =>
        request('/inventory/warehouses', { schema: warehouseListSchema, signal }),
      createWarehouse: (body: CreateWarehouseRequest): Promise<WarehouseList> =>
        request('/inventory/warehouses', { method: 'POST', body, schema: warehouseListSchema }),
      updateWarehouse: (
        warehouseId: string,
        body: UpdateWarehouseRequest,
      ): Promise<WarehouseList> =>
        request(`/inventory/warehouses/${id(warehouseId)}`, {
          method: 'PATCH',
          body,
          schema: warehouseListSchema,
        }),
      makeDefault: (warehouseId: string): Promise<WarehouseList> =>
        request(`/inventory/warehouses/${id(warehouseId)}/default`, {
          method: 'POST',
          schema: warehouseListSchema,
        }),
      stock: (query: Partial<StockLevelListQuery>, signal?: AbortSignal): Promise<StockLevelList> =>
        request('/inventory/stock', {
          query: asQuery({ ...query, lowStock: query.lowStock ? 'true' : undefined }),
          schema: stockLevelListSchema,
          signal,
        }),
      setThreshold: (
        stockLevelId: string,
        lowStockThreshold: number | null,
      ): Promise<StockLevelDto> =>
        request(`/inventory/stock/${id(stockLevelId)}/threshold`, {
          method: 'PUT',
          body: { lowStockThreshold },
          schema: stockLevelSchema,
        }),
      record: (body: RecordMovementRequest): Promise<MovementResult> =>
        request('/inventory/movements', { method: 'POST', body, schema: movementResultSchema }),
      movements: (query: Partial<MovementListQuery>, signal?: AbortSignal): Promise<MovementList> =>
        request('/inventory/movements', {
          query: asQuery(query),
          schema: movementListSchema,
          signal,
        }),
      transfer: (body: CreateTransferRequest): Promise<TransferDto> =>
        request('/inventory/transfers', { method: 'POST', body, schema: transferSchema }),
      transfers: (
        query: { page?: number; pageSize?: number },
        signal?: AbortSignal,
      ): Promise<TransferList> =>
        request('/inventory/transfers', {
          query: asQuery(query),
          schema: transferListSchema,
          signal,
        }),
      reservations: (
        query: { page?: number; pageSize?: number; status?: string },
        signal?: AbortSignal,
      ): Promise<ReservationList> =>
        request('/inventory/reservations', {
          query: asQuery(query),
          schema: reservationListSchema,
          signal,
        }),
    },
  };
}

/** Admin Console: categories, brands, product review and the inventory overview. */
export function createAdminCatalogClient(request: Request) {
  const detail = { schema: productDetailSchema };
  return {
    categories: {
      all: (signal?: AbortSignal): Promise<CategoryList> =>
        request('/categories/all', { schema: categoryListSchema, signal }),
      create: (body: CreateCategoryRequest): Promise<CategoryDto> =>
        request('/categories', { method: 'POST', body, schema: categorySchema }),
      update: (categoryId: string, body: UpdateCategoryRequest): Promise<CategoryDto> =>
        request(`/categories/${id(categoryId)}`, { method: 'PATCH', body, schema: categorySchema }),
      remove: (categoryId: string) =>
        request(`/categories/${id(categoryId)}`, { method: 'DELETE', schema: z.unknown() }).then(
          () => undefined,
        ),
      setAttributes: (
        categoryId: string,
        body: PutCategoryAttributesRequest,
      ): Promise<CategoryDto> =>
        request(`/categories/${id(categoryId)}/attributes`, {
          method: 'PUT',
          body,
          schema: categorySchema,
        }),
      setImage: (categoryId: string, file: File): Promise<CategoryDto> => {
        const form = new FormData();
        form.append('file', file);
        return request(`/categories/${id(categoryId)}/image`, {
          method: 'PUT',
          body: form,
          schema: categorySchema,
        });
      },
      removeImage: (categoryId: string): Promise<CategoryDto> =>
        request(`/categories/${id(categoryId)}/image`, {
          method: 'DELETE',
          schema: categorySchema,
        }),
    },
    brands: {
      create: (body: CreateBrandRequest): Promise<BrandDto> =>
        request('/brands', { method: 'POST', body, schema: brandSchema }),
      update: (brandId: string, body: UpdateBrandRequest): Promise<BrandDto> =>
        request(`/brands/${id(brandId)}`, { method: 'PATCH', body, schema: brandSchema }),
      review: (brandId: string, body: ReviewBrandRequest): Promise<BrandDto> =>
        request(`/brands/${id(brandId)}/review`, { method: 'POST', body, schema: brandSchema }),
    },
    products: {
      list: (query: Partial<ProductListQuery>, signal?: AbortSignal): Promise<ProductList> =>
        request('/products', { query: asQuery(query), schema: productListSchema, signal }),
      get: (productId: string, signal?: AbortSignal): Promise<ProductDetail> =>
        request(`/products/${id(productId)}`, { ...detail, signal }),
      review: (productId: string, body: ReviewProductRequest): Promise<ProductDetail> =>
        request(`/products/${id(productId)}/review`, { method: 'POST', body, ...detail }),
      takeDown: (productId: string, reason: string): Promise<ProductDetail> =>
        request(`/products/${id(productId)}/take-down`, {
          method: 'POST',
          body: { reason },
          ...detail,
        }),
    },
    inventoryOverview: (
      query: { page?: number; pageSize?: number; search?: string },
      signal?: AbortSignal,
    ): Promise<InventoryOverview> =>
      request('/inventory/overview', {
        query: asQuery(query),
        schema: inventoryOverviewSchema,
        signal,
      }),
    /** Development tools: the reservation flow checkout will use. */
    devReservations: {
      reserve: (body: DevReserveRequest): Promise<{ reservations: ReservationDto[] }> =>
        request('/dev/inventory/reservations', {
          method: 'POST',
          body,
          schema: z.object({ reservations: z.array(reservationSchema) }),
        }),
    },
  };
}
