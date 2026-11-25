import type { PrismaClient } from './generated/prisma/client';

type Db = Pick<PrismaClient, '$queryRaw'>;

/**
 * Releases ACTIVE stock reservations whose expires_at has passed: marks them EXPIRED and gives
 * their units back (reserved_quantity down), in one statement, so the two can never disagree.
 * Rows locked by a concurrent transaction are skipped (SKIP LOCKED) and picked up next time.
 * Safe to run from several processes at once. Returns how many reservations expired.
 *
 * Used by the worker's periodic sweep and by the API before it reserves stock, so expired
 * holds never block a checkout even if the sweep is late.
 */
export async function releaseExpiredReservations(
  db: Db,
  options: { now?: Date; limit?: number; stockLevelIds?: string[] } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const levels = options.stockLevelIds ?? null;
  const rows = await db.$queryRaw<{ expired: bigint }[]>`
    WITH due AS (
      SELECT "id"
      FROM "stock_reservations"
      WHERE "status" = 'ACTIVE'
        AND "expires_at" <= ${now}
        AND (${levels}::uuid[] IS NULL OR "stock_level_id" = ANY(${levels}::uuid[]))
      ORDER BY "expires_at"
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    ),
    expired AS (
      UPDATE "stock_reservations" r
      SET "status" = 'EXPIRED', "released_at" = ${now}, "updated_at" = ${now}
      FROM due
      WHERE r."id" = due."id"
      RETURNING r."stock_level_id", r."quantity"
    ),
    totals AS (
      SELECT "stock_level_id", SUM("quantity")::int AS "quantity"
      FROM expired
      GROUP BY "stock_level_id"
    ),
    released AS (
      UPDATE "stock_levels" s
      SET "reserved_quantity" = s."reserved_quantity" - totals."quantity", "updated_at" = ${now}
      FROM totals
      WHERE s."id" = totals."stock_level_id"
      RETURNING s."id"
    )
    SELECT COUNT(*)::bigint AS "expired" FROM expired`;
  return Number(rows[0]?.expired ?? 0);
}
