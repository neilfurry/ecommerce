# ADR 0025: Cash on delivery, returns, refunds and the seller payables ledger

- Status: Accepted (the seller payables ledger is superseded by the double-entry ledger, ADR 0027)
- Date: 2026-11-26

## Context

"Do not consider COD payments financially collected until the remittance is confirmed."
"Refunds must update financial records and seller payable calculations. Prevent duplicate
refunds." The marketplace collects all money (ADR 0022), so it must know what it owes each
seller at any time.

## Decision

### Seller payables ledger

- `seller_ledger_entries` is append-only (a trigger refuses UPDATE and DELETE). Entries:
  - `ORDER_EARNING` (+): items less the seller's own discounts, when the money is received;
  - `COMMISSION` (−);
  - `SHIPPING_CREDIT` (+): for deliveries the seller arranged and paid;
  - `REFUND` (−);
  - `COMMISSION_REVERSAL` (+).
- Partial unique indexes post each order entry once per seller order and each refund entry once
  per refund. The balance is the sum. Payouts are the Finance phase.

### Cash on delivery

- Eligibility: up to a maximum order amount (₱50,000 by default) and refused for customers with
  too many undelivered COD parcels (2 by default); both configurable.
- One collection per seller order with the expected amount: `PENDING` → `COLLECTED` (the courier
  delivered and took the cash) → `REMITTED` (finance recorded the courier's remittance).
  `FAILED` when cancelled or returned undelivered.
- **Only remittance counts as received.** It raises the payment's received amount, posts the
  seller's earnings and sets the order to partly or fully paid. A remittance must equal what the
  parcels collected or carry an explanation; a courier reference can be recorded once.

### Returns

- Requested within the return window (7 days after delivery by default) with items and
  quantities, a reason, a description and up to 5 photos (re-encoded, metadata removed). One open
  return per seller order.
- The seller approves (full refund, partial refund or replacement; with or without the item
  back) or rejects with a reason within the answer window (3 days by default). The customer can
  escalate a rejection or an unanswered request; staff with `disputes.manage` decide (and may add
  the shipping fee to the refund).
- Refunds are created when the item is back (restocked or recorded as damaged) or at approval
  when no return parcel is needed. Replacements leave stock when sent; the return resolves when
  the replacement is delivered.

### Refunds

- Sources: cancellation of a paid seller order (automatic), a parcel returned undelivered,
  returns, and staff refunds (seller order full or partial, or late and duplicate payments).
- **No duplicates:**
  - every refund has a unique idempotency key (a repeated request returns the same refund);
  - at most one live refund per return and per cancelled seller order (partial unique indexes);
  - creating a refund reserves its amount on the payment under the payment row lock, with a CHECK
    that refunded ≤ received, so two refunds can never give back the same money;
  - providers get the refund id as their idempotency key.
- Method: back to the original payment through the provider when possible, otherwise a manual
  payout that finance marks paid with its reference. A failed refund releases its reservation
  and can be retried as a new refund.
- The seller's share is decided when the refund is created (the refunded items' earnings and
  commission, in proportion for partial refunds; goodwill refunds are the marketplace's cost) and
  posted to the ledger only when the refund succeeds.

## Consequences

- Payments, refunds, COD and payables reconcile from the database alone. The reconciliation
  report lists every exception (money under review, cancelled orders not yet refunded, stuck or
  failed refunds, failed webhooks, open checkouts past their deadline, totals that do not match).
