# ADR 0023: A controlled state machine for seller orders

- Status: Accepted
- Date: 2026-11-26

## Context

A customer order is split into one seller order per seller (ADR 0019). Each seller order is
fulfilled separately: accepted, packed, shipped, delivered, returned. Status changes come from
customers, sellers, staff, the courier, the payment provider and scheduled jobs, sometimes at
the same moment.

## Decision

- **The rules live in one table** (`SELLER_ORDER_TRANSITIONS` in `@marketplace/shared-types`):
  each move lists the actors allowed to make it.

  ```
  AWAITING_PAYMENT → PENDING (provider, staff) | CANCELLED (customer, staff, system)
  PENDING → PROCESSING (seller, staff) | CANCELLED (customer, seller, staff)
  PROCESSING → READY_FOR_PICKUP | CANCELLED (seller, staff)
  READY_FOR_PICKUP → PROCESSING | CANCELLED (seller, staff) | SHIPPED (courier, seller, staff)
  SHIPPED → DELIVERED | DELIVERY_FAILED | RETURNING_TO_SELLER
  DELIVERY_FAILED → SHIPPED | DELIVERED | RETURNING_TO_SELLER
  RETURNING_TO_SELLER → RETURNED_TO_SELLER
  DELIVERED → COMPLETED (customer, staff, system)
  ```

  `COMPLETED`, `CANCELLED` and `RETURNED_TO_SELLER` are final. The UI shows only the actions the
  table allows for the viewer; the API checks again.

- **Every change goes through `transitionSellerOrderInTx`:** it checks the table, updates with a
  compare-and-set on the status it read (`WHERE status = <read>`), sets the matching timestamp,
  writes an order event with the from/to status and actor, and recalculates the parent order
  (`COMPLETED` when all parts are final and one completed, `CANCELLED` when all are final
  otherwise).
- **Lock order.** Every transaction that changes an order locks the order row first, then the
  rows below it. Concurrent changes therefore wait for each other instead of deadlocking, and
  the loser of a race sees the new status and gets 409.
- **Shipping statuses follow the shipment.** Courier events (or seller/staff updates of a
  self-arranged delivery) move the shipment through its own table, and the seller order follows
  (skipping steps a courier did not report, e.g. delivered without a pickup scan). Staff can
  move a seller order by hand only to accept it or to complete a delivered order early.
- **Side effects at the right step:** held stock leaves the warehouse at pickup; delivery starts
  the return window (7 days by default) and marks cash on delivery as collected; a parcel
  returned to the seller restocks the items, closes the COD collection and refunds anything
  paid; cancellation releases stock, flash sale units, coupon uses and refunds anything paid.
- **Cancellation:** the customer cancels a package directly while it is new, and asks the
  seller once it is being prepared (cancellation request, approved or declined with a reason).
- **Scheduled jobs:** delivered orders past the return window with no open return become
  `COMPLETED`; return requests the seller does not answer in time go to the marketplace.

## Consequences

- Concurrent updates are tested: three simultaneous accepts give one 200 and two 409s;
  approving and declining a cancellation request at once gives one winner.
