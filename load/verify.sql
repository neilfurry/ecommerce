-- Integrity after the load test: every line must be ok = true (load/run.sh fails otherwise).
\pset footer off
WITH contended AS (
  SELECT sl.quantity_on_hand, sl.reserved_quantity,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.variant_id = sl.variant_id) AS sold
    FROM stock_levels sl JOIN product_variants v ON v.id = sl.variant_id
    JOIN products p ON p.id = v.product_id
   WHERE p.name LIKE 'Load Test Limited Edition %'
)
SELECT 'contended product: units ordered = stock, never more' AS check,
       format('stock %s, reserved %s, ordered %s', quantity_on_hand, reserved_quantity, sold) AS detail,
       sold = quantity_on_hand AND reserved_quantity = quantity_on_hand AS ok
  FROM contended
UNION ALL
SELECT 'no stock level reserves more than it holds', count(*)::text, count(*) = 0
  FROM stock_levels WHERE reserved_quantity > quantity_on_hand OR quantity_on_hand < 0
UNION ALL
SELECT 'reserved stock = active reservations', count(*)::text, count(*) = 0
  FROM stock_levels s
  LEFT JOIN (SELECT stock_level_id, SUM(quantity) q FROM stock_reservations WHERE status = 'ACTIVE' GROUP BY 1) r
    ON r.stock_level_id = s.id
 WHERE s.reserved_quantity <> COALESCE(r.q, 0)
UNION ALL
SELECT 'each paid payment received its amount once', count(*)::text, count(*) = 0
  FROM payments WHERE status = 'PAID' AND amount_received <> amount
UNION ALL
SELECT 'each paid payment has exactly one PAID event', count(*)::text, count(*) = 0
  FROM payments p WHERE p.status = 'PAID'
   AND (SELECT count(*) FROM payment_events e WHERE e.payment_id = p.id AND e.type = 'PAID') <> 1
UNION ALL
SELECT 'no order paid twice', count(*)::text, count(*) = 0
  FROM (SELECT order_id FROM payments WHERE status = 'PAID' GROUP BY 1 HAVING count(*) > 1) x
UNION ALL
SELECT 'every received online payment is in the ledger', count(*)::text, count(*) = 0
  FROM payments p WHERE p.provider <> 'COD' AND p.amount_received > 0
   AND NOT EXISTS (SELECT 1 FROM journal_transactions t WHERE t.idempotency_key = 'receipt:' || p.id::text)
UNION ALL
SELECT 'every posted journal balances', count(*)::text, count(*) = 0
  FROM (SELECT t.id FROM journal_transactions t JOIN journal_entries e ON e.transaction_id = t.id
         WHERE t.status = 'POSTED' GROUP BY t.id HAVING SUM(e.debit) <> SUM(e.credit)) x
UNION ALL
SELECT 'one order per idempotency key', count(*)::text, count(*) = 0
  FROM (SELECT customer_id, idempotency_key FROM orders GROUP BY 1, 2 HAVING count(*) > 1) x
UNION ALL
SELECT 'order totals equal their seller orders', count(*)::text, count(*) = 0
  FROM orders o WHERE grand_total <> (SELECT COALESCE(SUM(total), 0) FROM seller_orders so WHERE so.order_id = o.id);
