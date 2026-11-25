import { toDisplayError, useProductSearch } from '@marketplace/api-client';
import { SEARCH_SORT_LABELS, SEARCH_SORTS, type SearchSort } from '@marketplace/shared-types';
import type { ProductSearchQueryInput, ProductSearchResult } from '@marketplace/validation';
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  formatMoney,
  Input,
  Label,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@marketplace/ui';
import { SearchXIcon, SlidersHorizontalIcon, StarIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ProductGrid, ProductGridSkeleton } from './product-card';

/** Filters live in the URL so results can be shared, bookmarked and navigated back to. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const list = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean);
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: false });
  };
  return { params, list, set };
}

function FilterPanel({ result, scope }: { result: ProductSearchResult | undefined; scope: Scope }) {
  const { params, list, set } = useFilters();
  const brands = list('brandIds');
  const [min, setMin] = useState(params.get('minPrice') ?? '');
  const [max, setMax] = useState(params.get('maxPrice') ?? '');
  const applyPrice = (event: FormEvent) => {
    event.preventDefault();
    set({ minPrice: min.trim() || null, maxPrice: max.trim() || null });
  };
  const facets = result?.facets;
  const toggleBrand = (id: string, on: boolean) =>
    set({ brandIds: (on ? [...brands, id] : brands.filter((b) => b !== id)).join(',') || null });
  return (
    <div className="space-y-6 text-sm">
      {!scope.storeId && facets && facets.categories.length > 1 ? (
        <fieldset>
          <legend className="mb-2 font-semibold">Category</legend>
          <ul className="space-y-1">
            {facets.categories.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/c/${c.slug}?${new URLSearchParams({ ...(params.get('q') ? { q: params.get('q')! } : {}) })}`}
                  className="flex justify-between gap-2 rounded px-1 py-0.5 hover:bg-accent"
                >
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      {!scope.storeId && facets && facets.stores.length > 0 ? (
        <fieldset>
          <legend className="mb-2 font-semibold">Seller</legend>
          <ul className="space-y-1.5">
            {facets.stores.map((s) => {
              const id = `store-${s.id}`;
              const checked = params.get('storeId') === s.id;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(v) => set({ storeId: v === true ? s.id : null })}
                  />
                  <Label htmlFor={id} className="flex-1 font-normal">
                    {s.name}
                  </Label>
                  <span className="text-muted-foreground">{s.count}</span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      {facets && facets.brands.length > 0 ? (
        <fieldset>
          <legend className="mb-2 font-semibold">Brand</legend>
          <ul className="space-y-1.5">
            {facets.brands.map((b) => {
              const id = `brand-${b.id}`;
              return (
                <li key={b.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={brands.includes(b.id)}
                    onCheckedChange={(v) => toggleBrand(b.id, v === true)}
                  />
                  <Label htmlFor={id} className="flex-1 font-normal">
                    {b.name}
                  </Label>
                  <span className="text-muted-foreground">{b.count}</span>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      <form onSubmit={applyPrice}>
        <fieldset>
          <legend className="mb-2 font-semibold">Price (₱)</legend>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Minimum price"
              inputMode="decimal"
              placeholder={
                facets?.priceRange ? Math.floor(Number(facets.priceRange.min)).toString() : 'Min'
              }
              value={min}
              onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ''))}
            />
            <span aria-hidden="true">–</span>
            <Input
              aria-label="Maximum price"
              inputMode="decimal"
              placeholder={
                facets?.priceRange ? Math.ceil(Number(facets.priceRange.max)).toString() : 'Max'
              }
              value={max}
              onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="mt-2 w-full">
            Apply price
          </Button>
        </fieldset>
      </form>
      <fieldset>
        <legend className="mb-2 font-semibold">Rating</legend>
        <ul className="space-y-1">
          {[4, 3, 2].map((r) => (
            <li key={r}>
              <button
                type="button"
                aria-pressed={params.get('minRating') === String(r)}
                onClick={() =>
                  set({ minRating: params.get('minRating') === String(r) ? null : String(r) })
                }
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-accent aria-pressed:bg-accent aria-pressed:font-medium"
              >
                {r}
                <StarIcon
                  className="size-3.5 fill-amber-500 text-amber-500"
                  aria-hidden="true"
                />{' '}
                &amp; up
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold">Availability</legend>
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-in-stock"
            checked={params.get('inStock') === 'true'}
            onCheckedChange={(v) => set({ inStock: v === true ? 'true' : null })}
          />
          <Label htmlFor="filter-in-stock" className="font-normal">
            In stock
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-wholesale"
            checked={params.get('wholesale') === 'true'}
            onCheckedChange={(v) => set({ wholesale: v === true ? 'true' : null })}
          />
          <Label htmlFor="filter-wholesale" className="font-normal">
            Wholesale prices
          </Label>
        </div>
      </fieldset>
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() =>
          set({
            brandIds: null,
            minPrice: null,
            maxPrice: null,
            minRating: null,
            inStock: null,
            wholesale: null,
            storeId: scope.storeId ? null : null,
          })
        }
      >
        Clear filters
      </Button>
    </div>
  );
}

export interface Scope {
  categoryId?: string;
  category?: string;
  storeId?: string;
}

/** Search results with filters, sorting and pages; scoped to a category or store if given. */
export function ProductListing({ scope = {}, heading }: { scope?: Scope; heading: string }) {
  const { params, set } = useFilters();
  const sort = (SEARCH_SORTS as readonly string[]).includes(params.get('sort') ?? '')
    ? (params.get('sort') as SearchSort)
    : 'relevance';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const query: ProductSearchQueryInput = {
    q: params.get('q') ?? undefined,
    category: scope.category,
    categoryId: scope.categoryId,
    storeId: scope.storeId ?? params.get('storeId') ?? undefined,
    brandIds: params.get('brandIds') ?? undefined,
    minPrice: params.get('minPrice') ?? undefined,
    maxPrice: params.get('maxPrice') ?? undefined,
    minRating: params.get('minRating') ? Number(params.get('minRating')) : undefined,
    inStock: params.get('inStock') === 'true' ? 'true' : undefined,
    wholesale: params.get('wholesale') === 'true' ? 'true' : undefined,
    sort,
    page,
    pageSize: 24,
  };
  const search = useProductSearch(query);
  const result = search.data;
  const filters = <FilterPanel result={result} scope={scope} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside aria-label="Filters" className="hidden lg:block">
        {filters}
      </aside>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result
              ? `${result.totalItems} result${result.totalItems === 1 ? '' : 's'}${query.q ? ` for “${query.q}”` : ''} in ${heading}`
              : ' '}
            {result?.facets.priceRange ? (
              <span className="hidden sm:inline">
                {' '}
                · {formatMoney(result.facets.priceRange.min)} –{' '}
                {formatMoney(result.facets.priceRange.max)}
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="lg:hidden">
                  <SlidersHorizontalIcon aria-hidden="true" /> Filters
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-6">{filters}</div>
              </SheetContent>
            </Sheet>
            <Label htmlFor="sort" className="sr-only">
              Sort by
            </Label>
            <Select
              value={sort}
              onValueChange={(value) => set({ sort: value === 'relevance' ? null : value })}
            >
              <SelectTrigger id="sort" className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_SORTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SEARCH_SORT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {search.isPending ? (
          <ProductGridSkeleton />
        ) : search.isError ? (
          <ErrorState
            message={toDisplayError(search.error)?.message ?? 'Search failed.'}
            requestId={toDisplayError(search.error)?.requestId}
            onRetry={() => void search.refetch()}
          />
        ) : result && result.items.length > 0 ? (
          <>
            <ProductGrid
              products={result.items}
              className={search.isFetching ? 'opacity-60' : undefined}
            />
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              totalItems={result.totalItems}
              onPageChange={(p) => {
                set({ page: p === 1 ? null : String(p) });
                window.scrollTo({ top: 0 });
              }}
              disabled={search.isFetching}
            />
          </>
        ) : (
          <EmptyState
            icon={SearchXIcon}
            title="No products found"
            description="Try other words, or remove some filters."
          />
        )}
      </div>
    </div>
  );
}
