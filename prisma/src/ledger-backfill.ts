import { type Prisma } from './generated/prisma/client';
import {
  postCodCollectedInTx,
  postCodRemittanceInTx,
  postPaymentFeeInTx,
  postPaymentReceivedInTx,
  postRefundInTx,
  postSaleInTx,
} from './ledger';

type Tx = Prisma.TransactionClient;

/**
 * Posts to the double-entry ledger the money events recorded before Phase 6 (the single-entry
 * `seller_ledger_entries` stays as history). Every posting is idempotent, so this can run any
 * number of times (the seed runs it). Returns the number of journals posted.
 */
export async function backfillLedger(db: {
  $queryRaw: Tx['$queryRaw'];
  $transaction: <T>(fn: (tx: Tx) => Promise<T>, options?: { timeout?: number }) => Promise<T>;
}): Promise<number> {
  let posted = 0;
  const run = async (
    ids: { id: string; at: Date | null }[],
    post: (tx: Tx, id: string, at: Date) => Promise<unknown>,
  ) => {
    for (const { id, at } of ids) {
      const result = await db.$transaction((tx) => post(tx, id, at ?? new Date()), {
        timeout: 30_000,
      });
      if (result) posted++;
    }
  };
  await run(
    await db.$queryRaw`
      SELECT p."id", p."paid_at" AS "at" FROM "payments" p
      WHERE p."provider" <> 'COD' AND p."amount_received" > 0
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'receipt:' || p."id"::text)
      ORDER BY p."paid_at"`,
    (tx, id, at) => postPaymentReceivedInTx(tx, id, at),
  );
  await run(
    await db.$queryRaw`
      SELECT c."id", c."collected_at" AS "at" FROM "cod_collections" c
      WHERE c."status" IN ('COLLECTED', 'REMITTED') AND c."collected_amount" > 0
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'cod-collected:' || c."id"::text)
      ORDER BY c."collected_at"`,
    (tx, id, at) => postCodCollectedInTx(tx, id, at),
  );
  await run(
    await db.$queryRaw`
      SELECT r."id", r."remitted_at" AS "at" FROM "cod_remittances" r
      WHERE NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'cod-remittance:' || r."id"::text)
      ORDER BY r."remitted_at"`,
    (tx, id) => postCodRemittanceInTx(tx, id),
  );
  // Sales: the seller orders that had earnings in the Phase 5 seller ledger.
  await run(
    await db.$queryRaw`
      SELECT e."seller_order_id" AS "id", MIN(e."created_at") AS "at" FROM "seller_ledger_entries" e
      WHERE e."type" = 'ORDER_EARNING' AND e."seller_order_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'sale:' || e."seller_order_id"::text)
      GROUP BY e."seller_order_id" ORDER BY MIN(e."created_at")`,
    (tx, id, at) => postSaleInTx(tx, id, at),
  );
  await run(
    await db.$queryRaw`
      SELECT p."id", p."paid_at" AS "at" FROM "payments" p
      WHERE p."provider" <> 'COD' AND p."amount_received" > 0
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'fee:' || p."id"::text)
      ORDER BY p."paid_at"`,
    (tx, id, at) => postPaymentFeeInTx(tx, id, at),
  );
  await run(
    await db.$queryRaw`
      SELECT f."id", f."succeeded_at" AS "at" FROM "refunds" f
      WHERE f."status" = 'SUCCEEDED'
        AND NOT EXISTS (SELECT 1 FROM "journal_transactions" t WHERE t."idempotency_key" = 'refund:' || f."id"::text)
      ORDER BY f."succeeded_at"`,
    (tx, id, at) => postRefundInTx(tx, id, at),
  );
  return posted;
}
