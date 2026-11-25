import type { SearchSort } from '@marketplace/shared-types';

export interface ProductSearchRequest {
  /** Keywords as typed by the shopper. */
  q?: string;
  /** Categories to search (a category and all its subcategories). */
  categoryIds?: string[];
  storeId?: string;
  sellerId?: string;
  brandIds?: string[];
  /** Price bounds on the lowest current retail price, in pesos. */
  minPrice?: string;
  maxPrice?: string;
  minRating?: number;
  inStock?: boolean;
  wholesale?: boolean;
  sort: SearchSort;
  page: number;
  pageSize: number;
}

export interface SearchFacetCount {
  id: string;
  count: number;
}

export interface ProductSearchResponse {
  /** Matching product ids for the requested page, in order. */
  ids: string[];
  total: number;
  facets: {
    categories: SearchFacetCount[];
    /** Brand counts ignore the brand filter, so other brands can still be chosen. */
    brands: SearchFacetCount[];
    stores: SearchFacetCount[];
    priceRange: { min: string; max: string } | null;
  };
}

/**
 * Product search behind one interface. PostgreSQL full-text and trigram search serve it
 * today; an OpenSearch (or Elasticsearch) provider can replace it without touching the API or
 * the apps: it returns ids and facet counts, and the catalog service builds the cards.
 */
export abstract class SearchProvider {
  abstract readonly name: string;
  abstract search(request: ProductSearchRequest): Promise<ProductSearchResponse>;
}
