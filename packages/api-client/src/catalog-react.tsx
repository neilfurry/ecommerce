import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  BrandListQuery,
  CreateBrandRequest,
  CreateCategoryRequest,
  CreateProductRequest,
  CreateTransferRequest,
  CreateWarehouseRequest,
  CustomerPriceInput,
  MovementListQuery,
  PricePreviewRequest,
  ProductDetail,
  ProductListQuery,
  ProductPricingRequest,
  PutCategoryAttributesRequest,
  PutPriceTiersRequest,
  RecordMovementRequest,
  ReviewBrandRequest,
  ReviewProductRequest,
  SetProductOptionsRequest,
  StockLevelListQuery,
  UpdateBrandRequest,
  UpdateCategoryRequest,
  UpdateProductRequest,
  UpdateVariantRequest,
  UpdateWarehouseRequest,
} from '@marketplace/validation';
import { useApiClient } from './react';

/** Query keys for catalog, pricing and inventory (prefixes allow broad invalidation). */
export const catalogKeys = {
  categories: ['catalog', 'categories'] as const,
  allCategories: ['catalog', 'categories', 'all'] as const,
  categoryAttributes: (id: string) => ['catalog', 'category-attributes', id] as const,
  brands: (query: object) => ['catalog', 'brands', query] as const,
  brandsAll: ['catalog', 'brands'] as const,
  sellerProducts: ['seller', 'products'] as const,
  sellerProductList: (query: object) => ['seller', 'products', 'list', query] as const,
  sellerProduct: (id: string) => ['seller', 'products', 'detail', id] as const,
  customerPrices: (id: string) => ['seller', 'products', 'customer-prices', id] as const,
  inventory: ['seller', 'inventory'] as const,
  inventorySummary: ['seller', 'inventory', 'summary'] as const,
  warehouses: ['seller', 'inventory', 'warehouses'] as const,
  stock: (query: object) => ['seller', 'inventory', 'stock', query] as const,
  movements: (query: object) => ['seller', 'inventory', 'movements', query] as const,
  transfers: (query: object) => ['seller', 'inventory', 'transfers', query] as const,
  reservations: (query: object) => ['seller', 'inventory', 'reservations', query] as const,
  adminProducts: ['admin', 'products'] as const,
  adminProductList: (query: object) => ['admin', 'products', 'list', query] as const,
  adminProduct: (id: string) => ['admin', 'products', 'detail', id] as const,
  inventoryOverview: (query: object) => ['admin', 'inventory-overview', query] as const,
};

// ---- Shared ----------------------------------------------------------------------------------

export function useCategories() {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.categories,
    queryFn: ({ signal }) => client.catalog.categories(signal),
    staleTime: 5 * 60_000,
  });
}

export function useCategoryAttributes(categoryId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.categoryAttributes(categoryId ?? ''),
    queryFn: ({ signal }) => client.catalog.categoryAttributes(categoryId!, signal),
    enabled: !!categoryId,
    staleTime: 60_000,
  });
}

export function useBrands(query: Partial<BrandListQuery>, options: { enabled?: boolean } = {}) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.brands(query),
    queryFn: ({ signal }) => client.catalog.brands(query, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

// ---- Seller products --------------------------------------------------------------------------

export function useMyProducts(query: Partial<ProductListQuery>) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.sellerProductList(query),
    queryFn: ({ signal }) => client.seller.products.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSellerProduct(productId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.sellerProduct(productId ?? ''),
    queryFn: ({ signal }) => client.seller.products.get(productId!, signal),
    enabled: !!productId,
  });
}

/** Every product mutation returns the product: cache it and refresh lists. */
function useProductMutation<TVariables>(mutate: (variables: TVariables) => Promise<ProductDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mutate,
    onSuccess: (product) => {
      queryClient.setQueryData(catalogKeys.sellerProduct(product.id), product);
      void queryClient.invalidateQueries({ queryKey: ['seller', 'products', 'list'] });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.inventory });
    },
  });
}

export function useCreateProduct() {
  const client = useApiClient();
  return useProductMutation((body: CreateProductRequest) => client.seller.products.create(body));
}

export function useUpdateProduct() {
  const client = useApiClient();
  return useProductMutation(
    ({ productId, body }: { productId: string; body: UpdateProductRequest }) =>
      client.seller.products.update(productId, body),
  );
}

export function useSetProductOptions() {
  const client = useApiClient();
  return useProductMutation(
    ({ productId, body }: { productId: string; body: SetProductOptionsRequest }) =>
      client.seller.products.setOptions(productId, body),
  );
}

export function useUpdateVariant() {
  const client = useApiClient();
  return useProductMutation(
    ({
      productId,
      variantId,
      body,
    }: {
      productId: string;
      variantId: string;
      body: UpdateVariantRequest;
    }) => client.seller.products.updateVariant(productId, variantId, body),
  );
}

export function useProductAction() {
  const client = useApiClient();
  return useProductMutation(
    ({
      productId,
      action,
    }: {
      productId: string;
      action: 'submit' | 'deactivate' | 'activate' | 'archive' | 'restore';
    }) => client.seller.products.action(productId, action),
  );
}

export function useProductImages() {
  const client = useApiClient();
  const add = useProductMutation(
    ({ productId, file, altText }: { productId: string; file: File; altText?: string }) =>
      client.seller.products.addImage(productId, file, { altText }),
  );
  const replace = useProductMutation(
    ({ productId, imageId, file }: { productId: string; imageId: string; file: File }) =>
      client.seller.products.replaceImage(productId, imageId, file),
  );
  const update = useProductMutation(
    ({
      productId,
      imageId,
      body,
    }: {
      productId: string;
      imageId: string;
      body: { altText?: string | null; variantId?: string | null };
    }) => client.seller.products.updateImage(productId, imageId, body),
  );
  const reorder = useProductMutation(
    ({ productId, imageIds }: { productId: string; imageIds: string[] }) =>
      client.seller.products.reorderImages(productId, imageIds),
  );
  const remove = useProductMutation(
    ({ productId, imageId }: { productId: string; imageId: string }) =>
      client.seller.products.removeImage(productId, imageId),
  );
  return { add, replace, update, reorder, remove };
}

export function useSetProductPricing() {
  const client = useApiClient();
  return useProductMutation(
    ({ productId, body }: { productId: string; body: ProductPricingRequest }) =>
      client.seller.products.setPricing(productId, body),
  );
}

export function useSetPriceTiers() {
  const client = useApiClient();
  return useProductMutation(
    ({ productId, body }: { productId: string; body: PutPriceTiersRequest }) =>
      client.seller.products.setTiers(productId, body),
  );
}

export function useCustomerPrices(productId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.customerPrices(productId),
    queryFn: ({ signal }) => client.seller.products.customerPrices(productId, signal),
  });
}

export function useCustomerPriceMutations(productId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = (data: Awaited<ReturnType<typeof client.seller.products.customerPrices>>) =>
    queryClient.setQueryData(catalogKeys.customerPrices(productId), data);
  return {
    add: useMutation({
      mutationFn: (body: CustomerPriceInput) =>
        client.seller.products.addCustomerPrice(productId, body),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (priceId: string) =>
        client.seller.products.removeCustomerPrice(productId, priceId),
      onSuccess,
    }),
  };
}

export function usePricePreview(productId: string) {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body: PricePreviewRequest) => client.seller.products.previewPrice(productId, body),
  });
}

export function useRequestBrand() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBrandRequest) => client.seller.requestBrand(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: catalogKeys.brandsAll }),
  });
}

// ---- Seller inventory -------------------------------------------------------------------------

function invalidateInventory(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: catalogKeys.inventory });
  void queryClient.invalidateQueries({ queryKey: catalogKeys.sellerProducts });
}

export function useInventorySummary() {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.inventorySummary,
    queryFn: ({ signal }) => client.seller.inventory.summary(signal),
  });
}

export function useWarehouses() {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.warehouses,
    queryFn: ({ signal }) => client.seller.inventory.warehouses(signal),
  });
}

export function useWarehouseMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => invalidateInventory(queryClient);
  return {
    create: useMutation({
      mutationFn: (body: CreateWarehouseRequest) => client.seller.inventory.createWarehouse(body),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ warehouseId, body }: { warehouseId: string; body: UpdateWarehouseRequest }) =>
        client.seller.inventory.updateWarehouse(warehouseId, body),
      onSuccess,
    }),
    makeDefault: useMutation({
      mutationFn: (warehouseId: string) => client.seller.inventory.makeDefault(warehouseId),
      onSuccess,
    }),
  };
}

export function useStockLevels(query: Partial<StockLevelListQuery>) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.stock(query),
    queryFn: ({ signal }) => client.seller.inventory.stock(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSetLowStockThreshold() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ stockLevelId, threshold }: { stockLevelId: string; threshold: number | null }) =>
      client.seller.inventory.setThreshold(stockLevelId, threshold),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useRecordMovement() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordMovementRequest) => client.seller.inventory.record(body),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useMovements(query: Partial<MovementListQuery>) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.movements(query),
    queryFn: ({ signal }) => client.seller.inventory.movements(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useTransferStock() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTransferRequest) => client.seller.inventory.transfer(body),
    onSuccess: () => invalidateInventory(queryClient),
  });
}

export function useTransfers(query: { page?: number; pageSize?: number }) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.transfers(query),
    queryFn: ({ signal }) => client.seller.inventory.transfers(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useReservations(query: { page?: number; pageSize?: number; status?: string }) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.reservations(query),
    queryFn: ({ signal }) => client.seller.inventory.reservations(query, signal),
    placeholderData: keepPreviousData,
  });
}

// ---- Admin -------------------------------------------------------------------------------------

export function useAllCategories() {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.allCategories,
    queryFn: ({ signal }) => client.admin.catalog.categories.all(signal),
  });
}

export function useCategoryMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['catalog'] });
  const c = client.admin.catalog.categories;
  return {
    create: useMutation({ mutationFn: (body: CreateCategoryRequest) => c.create(body), onSuccess }),
    update: useMutation({
      mutationFn: ({ categoryId, body }: { categoryId: string; body: UpdateCategoryRequest }) =>
        c.update(categoryId, body),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (categoryId: string) => c.remove(categoryId), onSuccess }),
    setAttributes: useMutation({
      mutationFn: ({
        categoryId,
        body,
      }: {
        categoryId: string;
        body: PutCategoryAttributesRequest;
      }) => c.setAttributes(categoryId, body),
      onSuccess,
    }),
    setImage: useMutation({
      mutationFn: ({ categoryId, file }: { categoryId: string; file: File }) =>
        c.setImage(categoryId, file),
      onSuccess,
    }),
    removeImage: useMutation({
      mutationFn: (categoryId: string) => c.removeImage(categoryId),
      onSuccess,
    }),
  };
}

export function useBrandMutations() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: catalogKeys.brandsAll });
  const b = client.admin.catalog.brands;
  return {
    create: useMutation({ mutationFn: (body: CreateBrandRequest) => b.create(body), onSuccess }),
    update: useMutation({
      mutationFn: ({ brandId, body }: { brandId: string; body: UpdateBrandRequest }) =>
        b.update(brandId, body),
      onSuccess,
    }),
    review: useMutation({
      mutationFn: ({ brandId, body }: { brandId: string; body: ReviewBrandRequest }) =>
        b.review(brandId, body),
      onSuccess,
    }),
  };
}

export function useAdminProducts(query: Partial<ProductListQuery>) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.adminProductList(query),
    queryFn: ({ signal }) => client.admin.catalog.products.list(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminProduct(productId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.adminProduct(productId ?? ''),
    queryFn: ({ signal }) => client.admin.catalog.products.get(productId!, signal),
    enabled: !!productId,
  });
}

export function useProductModeration() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const onSuccess = (product: ProductDetail) => {
    queryClient.setQueryData(catalogKeys.adminProduct(product.id), product);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'products', 'list'] });
  };
  return {
    review: useMutation({
      mutationFn: ({ productId, body }: { productId: string; body: ReviewProductRequest }) =>
        client.admin.catalog.products.review(productId, body),
      onSuccess,
    }),
    takeDown: useMutation({
      mutationFn: ({ productId, reason }: { productId: string; reason: string }) =>
        client.admin.catalog.products.takeDown(productId, reason),
      onSuccess,
    }),
  };
}

export function useInventoryOverview(query: { page?: number; pageSize?: number; search?: string }) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.inventoryOverview(query),
    queryFn: ({ signal }) => client.admin.catalog.inventoryOverview(query, signal),
    placeholderData: keepPreviousData,
  });
}
