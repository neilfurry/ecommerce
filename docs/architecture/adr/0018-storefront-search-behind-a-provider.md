# ADR 0018: Storefront search behind a provider interface (PostgreSQL now, OpenSearch later)

- Status: Accepted
- Date: 2026-11-28

## Context

The Phase 4 brief asks for product search by keyword, category, seller, brand, price range,
rating, availability and wholesale-only, sorted by relevance, price, newest or best-selling.
It says to use PostgreSQL search now in a way that OpenSearch can replace later.

## Decision

- **`SearchProvider`** is an abstract class with one method,
  `search(query, shopper) → { ids, total, facets }`. Only the provider knows how matching and
  ranking are done; `CatalogService` turns the ids into product cards. The provider is bound
  in `StorefrontModule`, so switching engines means writing one class and changing one binding.
  The response names the engine in use (`engine: "postgres"`).
- **`PostgresSearchProvider`** builds one SQL statement:
  - **Keyword:** each word becomes a prefix term, so partial words match
    (`to_tsquery('simple', 'key:* & mou:*')`). The document is
    `to_tsvector('simple', name || ' ' || description)`. The `simple` configuration is used
    because listings mix English and Filipino. A fallback `lower(name || brand || category)
LIKE ALL ('%word%', …)` also catches words inside other words and brand or category names.
  - **Ranking:** `ts_rank` plus trigram `similarity` on the name.
  - **Current price** for the price filter and sorting comes from a `LATERAL` subquery: the
    lowest price over the product's active variants of `LEAST(sale price while it runs, or the
regular price; the flash price while a flash sale runs)`. Wholesale and agreed prices are
    per buyer and quantity, so they are not used for filtering. The card shows them.
  - **Filters:** category (the category and every category below it), store, seller, brand,
    price range, minimum rating, in stock, and wholesale available.
  - **Facets:** categories, brands and stores with counts, and the price range of the
    matches. Brand counts ignore the brand filter, so shoppers can switch brands.
  - **Indexes:** a GIN expression index on the document and a `pg_trgm` GIN index on
    `lower(name)` (migration `20261128090000_storefront_cart_checkout`).
- Only products shoppers may see are searched: product active (approved), store and category
  active, seller verified.
- **Suggestions** (`/catalog/suggest`) use the same provider with a small page size.

## Consequences

- PostgreSQL is enough for the expected Phase 4 catalog size. OpenSearch is worth adding when
  typo tolerance, synonyms or much larger catalogs are needed. It would need indexing jobs (a
  new queue fed by product changes) and the same `SearchProvider` contract.
- Ratings and sold counts are stored on the product (`rating_average`, `rating_count`,
  `sold_count`), so search does not need to aggregate them on every query.
