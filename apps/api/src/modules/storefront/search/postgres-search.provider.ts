import { Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  type ProductSearchRequest,
  type ProductSearchResponse,
  SearchProvider,
  type SearchFacetCount,
} from './search-provider';

const ORDER_BY: Record<ProductSearchRequest['sort'], Prisma.Sql> = {
  relevance: Prisma.sql`"rank" DESC, "sold_count" DESC, "approved_at" DESC NULLS LAST, "id" DESC`,
  newest: Prisma.sql`"approved_at" DESC NULLS LAST, "id" DESC`,
  price_asc: Prisma.sql`"min_price" ASC, "id" DESC`,
  price_desc: Prisma.sql`"min_price" DESC, "id" DESC`,
  best_selling: Prisma.sql`"sold_count" DESC, "rating_average" DESC, "id" DESC`,
  rating: Prisma.sql`"rating_average" DESC, "rating_count" DESC, "id" DESC`,
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Search with PostgreSQL: full-text matching on product names and descriptions (GIN index on
 * the same expression) plus trigram matching for partial words, over the products shoppers
 * can see, with the current price (sale or running flash sale) computed per product.
 */
@Injectable()
export class PostgresSearchProvider extends SearchProvider {
  readonly name = 'postgres';

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async search(request: ProductSearchRequest): Promise<ProductSearchResponse> {
    const now = new Date();
    const q = request.q?.trim() || null;
    // Words of the query (letters and digits only, so the tsquery syntax cannot be injected);
    // each must match, as a word prefix ("tumb" finds "Tumbler").
    const words = (q ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 8);
    const prefixQuery = words.map((w) => `${w}:*`).join(' & ');
    const likes = words.map((w) => `%${escapeLike(w)}%`);
    const document = Prisma.sql`to_tsvector('simple'::regconfig, p."name" || ' ' || coalesce(p."description", ''))`;

    const filters: Prisma.Sql[] = [
      Prisma.sql`p."status" = 'ACTIVE'`,
      Prisma.sql`s."status" = 'VERIFIED'`,
      Prisma.sql`st."status" = 'ACTIVE'`,
      Prisma.sql`c."status" = 'ACTIVE'`,
      Prisma.sql`price."min_price" IS NOT NULL`,
    ];
    if (words.length > 0) {
      // A product matches when the full-text query matches its name and description, or when
      // every word appears in its name, brand or category. Written so each branch can use an
      // index (GIN full-text, GIN trigram on the name, b-tree on brand and category): the
      // first word must appear in the name, brand or category (a word has no spaces, so it
      // cannot span two of them), which narrows the products before the exact check. A plain
      // OR across the joined tables made PostgreSQL compute the text vector of every product
      // on every search (Phase 8 load test: 850 ms per search with 5,000 products).
      const first = likes[0]!;
      filters.push(Prisma.sql`p."id" IN (
        SELECT tp."id" FROM "products" tp
         WHERE to_tsvector('simple'::regconfig, tp."name" || ' ' || coalesce(tp."description", ''))
               @@ to_tsquery('simple', ${prefixQuery})
        UNION
        SELECT wp."id" FROM "products" wp
          LEFT JOIN "brands" wb ON wb."id" = wp."brand_id"
          JOIN "categories" wc ON wc."id" = wp."category_id"
         WHERE wp."id" IN (
                 SELECT "id" FROM "products" WHERE lower("name") LIKE ${first}
                 UNION SELECT "id" FROM "products"
                  WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("name") LIKE ${first})
                 UNION SELECT "id" FROM "products"
                  WHERE "category_id" IN (SELECT "id" FROM "categories" WHERE lower("name") LIKE ${first}))
           AND lower(wp."name" || ' ' || coalesce(wb."name", '') || ' ' || wc."name") LIKE ALL(${likes}::text[]))`);
    }
    if (request.categoryIds?.length)
      filters.push(Prisma.sql`p."category_id" = ANY(${request.categoryIds}::uuid[])`);
    if (request.storeId) filters.push(Prisma.sql`p."store_id" = ${request.storeId}::uuid`);
    if (request.sellerId) filters.push(Prisma.sql`p."seller_id" = ${request.sellerId}::uuid`);
    if (request.minRating) filters.push(Prisma.sql`p."rating_average" >= ${request.minRating}`);
    if (request.wholesale) filters.push(Prisma.sql`p."wholesale_enabled"`);
    if (request.minPrice)
      filters.push(Prisma.sql`price."min_price" >= ${request.minPrice}::numeric`);
    if (request.maxPrice)
      filters.push(Prisma.sql`price."min_price" <= ${request.maxPrice}::numeric`);
    if (request.inStock) filters.push(Prisma.sql`stock."in_stock"`);
    const brandFilter = request.brandIds?.length
      ? Prisma.sql`"brand_id" = ANY(${request.brandIds}::uuid[])`
      : Prisma.sql`TRUE`;
    const rank =
      words.length > 0
        ? Prisma.sql`ts_rank(${document}, to_tsquery('simple', ${prefixQuery})) + similarity(lower(p."name"), ${words.join(' ')})`
        : Prisma.sql`0`;
    const offset = (request.page - 1) * request.pageSize;

    const [row] = await this.prisma.$queryRaw<
      {
        total: number;
        ids: string[] | null;
        brands: SearchFacetCount[];
        categories: SearchFacetCount[];
        stores: SearchFacetCount[];
        min_price: string | null;
        max_price: string | null;
      }[]
    >`
      WITH candidates AS (
        SELECT p."id", p."brand_id", p."category_id", p."store_id", p."approved_at",
               p."sold_count", p."rating_average", p."rating_count", price."min_price",
               ${rank}::float8 AS "rank"
        FROM "products" p
        JOIN "sellers" s ON s."id" = p."seller_id"
        JOIN "stores" st ON st."id" = p."store_id"
        JOIN "categories" c ON c."id" = p."category_id"
        LEFT JOIN "brands" b ON b."id" = p."brand_id"
        CROSS JOIN LATERAL (
          SELECT MIN(LEAST(
            CASE WHEN v."sale_price" IS NOT NULL
                  AND (v."sale_starts_at" IS NULL OR v."sale_starts_at" <= ${now})
                  AND (v."sale_ends_at" IS NULL OR v."sale_ends_at" > ${now})
                 THEN v."sale_price" ELSE v."regular_price" END,
            (SELECT MIN(fi."flash_price") FROM "flash_sale_items" fi
               JOIN "flash_sales" fs ON fs."id" = fi."flash_sale_id"
              WHERE fi."variant_id" = v."id" AND fi."status" = 'ACTIVE'
                AND fi."sold_quantity" < fi."quantity_limit"
                AND fs."status" = 'ACTIVE' AND fs."starts_at" <= ${now} AND fs."ends_at" > ${now})
          )) AS "min_price"
          FROM "product_variants" v WHERE v."product_id" = p."id" AND v."status" = 'ACTIVE'
        ) price
        CROSS JOIN LATERAL (
          SELECT EXISTS (
            SELECT 1 FROM "product_variants" v
            WHERE v."product_id" = p."id" AND v."status" = 'ACTIVE'
              AND (NOT v."track_inventory" OR EXISTS (
                SELECT 1 FROM "stock_levels" sl JOIN "warehouses" w ON w."id" = sl."warehouse_id"
                WHERE sl."variant_id" = v."id" AND w."status" = 'ACTIVE'
                  AND sl."quantity_on_hand" - sl."reserved_quantity" > 0))
          ) AS "in_stock"
        ) stock
        WHERE ${Prisma.join(filters, ' AND ')}
      ),
      matched AS (SELECT * FROM candidates WHERE ${brandFilter}),
      page AS (
        SELECT "id", row_number() OVER (ORDER BY ${ORDER_BY[request.sort]}) AS "position"
        FROM matched ORDER BY ${ORDER_BY[request.sort]}
        LIMIT ${request.pageSize}::int OFFSET ${offset}::int
      )
      SELECT
        (SELECT COUNT(*)::int FROM matched) AS "total",
        (SELECT array_agg("id" ORDER BY "position") FROM page) AS "ids",
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
          SELECT "brand_id" AS "id", COUNT(*)::int AS "count" FROM candidates
          WHERE "brand_id" IS NOT NULL GROUP BY "brand_id" ORDER BY 2 DESC LIMIT 30) x) AS "brands",
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
          SELECT "category_id" AS "id", COUNT(*)::int AS "count" FROM matched
          GROUP BY "category_id" ORDER BY 2 DESC LIMIT 30) x) AS "categories",
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
          SELECT "store_id" AS "id", COUNT(*)::int AS "count" FROM matched
          GROUP BY "store_id" ORDER BY 2 DESC LIMIT 30) x) AS "stores",
        (SELECT MIN("min_price")::text FROM matched) AS "min_price",
        (SELECT MAX("min_price")::text FROM matched) AS "max_price"`;

    return {
      ids: row?.ids ?? [],
      total: row?.total ?? 0,
      facets: {
        brands: row?.brands ?? [],
        categories: row?.categories ?? [],
        stores: row?.stores ?? [],
        priceRange:
          row?.min_price && row.max_price
            ? {
                min: new Prisma.Decimal(row.min_price).toFixed(2),
                max: new Prisma.Decimal(row.max_price).toFixed(2),
              }
            : null,
      },
    };
  }
}
