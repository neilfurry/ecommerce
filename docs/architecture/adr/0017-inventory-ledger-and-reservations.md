# ADR 0017: Inventory ledger, concurrency and stock reservations

- Status: Accepted
- Date: 2026-11-27

## Context

Stock is kept per variant and warehouse. Many requests (seller adjustments, transfers, future
checkouts) change the same rows at once, and available stock must never go negative.

## Decision

- **Stock level row** per (variant, warehouse): `quantity_on_hand`, `reserved_quantity`,
  `damaged_quantity`; available = on hand − reserved. CHECK constraints make every quantity
  non-negative and on hand ≥ reserved, as a last line of defence.
- **One guarded UPDATE per change** (`applyStockChange`): the deltas and the conditions are in
  the same statement (`... WHERE id = $1 AND quantity_on_hand + $d - reserved_quantity >= 0 ...
RETURNING *`). Zero rows means `INSUFFICIENT_STOCK` (409). No read-then-write, so no lost
  updates under concurrency.
- **Append-only ledger** (`inventory_movements`): each change writes a row with type, signed
  quantity, balances after, actor, reason and reference, in the same transaction. A trigger
  refuses UPDATE and DELETE.
- **Transfers** move every item or none, locking rows in variant order to avoid deadlocks.
- **Low-stock alerts** fire once when available stock falls to the threshold
  (compare-and-set on `low_stock_notified_at`), and re-arm after restocking.
- **Reservations** lock the variant's stock rows (`SELECT ... FOR UPDATE`), first release that
  variant's expired holds, then take stock from the default warehouse first. All items or none.
  They expire (15 minutes by default); `convert` turns an active reservation into a `SALE`
  movement with a compare-and-set, so a hold can be converted or released only once.
- **Expiry sweep** lives in `@marketplace/database` (`releaseExpiredReservations`, one statement
  with `SKIP LOCKED`) so the API and the worker share it. The worker runs it every 60 seconds
  through a BullMQ job scheduler; this gives the worker optional database access
  (`DATABASE_URL`, required in production).

## Consequences

- Checkout (next phase) calls `ReservationsService`; until then reservations are exercised
  through development-only endpoints.
- Verified by tests: 25 parallel stock-outs of 10 against 100 units succeed exactly 10 times;
  30 parallel reservations of 3 against 20 units succeed exactly 6 times.
