# ADR 0028: Seller settlement, statements and payouts

- Status: Accepted
- Date: 2026-11-26

## Context

The user chose: earnings eligible after delivery and the return window, **weekly** settlement
(configurable); gateway fees **configurable, deducted from the seller by default**; payouts by a
**manual workflow plus a PayMongo sandbox adapter**.

## Decision

### Eligibility and periods

- A seller order is eligible when its sale is posted, it is not settled yet, and either it was
  delivered (or completed) and `return_window_ends_at` + hold days is at or before the period
  end, or it ended without delivery (cancelled, returned to seller); in both cases with no open
  return or dispute and no refund in progress.
- Periods are Philippine calendar periods (UTC+8, no daylight saving): weekly (default Monday to
  Sunday), every two weeks, or monthly; the first weekday and an extra hold are settings.
- The worker job `order-processing.settle-sellers` runs every 6 hours and settles the last closed
  period; finance can also run it from the console. Unique `(seller, period start)` and unique
  `settlement_lines.seller_order_id` make it idempotent: each order is settled once ever.

### Settlement

In one transaction under the seller-balance lock: the eligible orders' pending amounts move to
available (one journal), withholding is computed and posted, an **immutable statement**
(`settlements` + `settlement_lines`, append-only triggers) records sales, shipping credits,
commission, payment/COD fees, refunds, commission returned, other adjustments, net, withholding
and the available balance before and after; the marketplace's **service invoice** (commission
and fees) and **credit note** (commission returned) are issued from the same ledger lines
(ADR 0029). Refunds after settlement are taken from the available balance; a negative available
balance is carried into later settlements and blocks payouts.

### Fees

Per payment method: percent + fixed (zero until finance enters contracted rates). Per channel
(online, bank transfer, COD): borne by the seller (default) or the marketplace. Seller-borne
online fees are allocated to the seller orders of the payment in proportion to their totals
(largest remainder, to the centavo). Fees are not returned on refunds (providers keep them).

### Payouts

- Sellers add bank or e-wallet accounts: the number is encrypted (AES-256-GCM,
  `FINANCE_ENCRYPTION_KEY`); only the last four digits are returned or logged; account details
  cannot be changed (a new account is added). Finance verifies or rejects accounts.
- A payout request needs a verified seller with a verified tax profile, a verified account, at
  least the minimum (₱100 default) and at most the available balance (checked under the
  seller-balance lock) and an idempotency key (a retry returns the same payout).
- States: `REQUESTED` → `APPROVED` → `PAID`, or `PROCESSING` (sent to PayMongo) → `PAID` /
  `FAILED`; `REJECTED`, `CANCELLED` (by the seller), `FAILED` return the amount to available
  (reversal); `PAID` → `REVERSED` when the bank returns it. The requester cannot approve. Every
  step is an append-only `payout_events` row and an audit entry.
- Manual: finance transfers from the bank and records the bank reference and any fee.
- PayMongo (when `PAYMONGO_SECRET_KEY` and `PAYMONGO_WALLET_ACCOUNT_NUMBER` are set and the
  setting is on): `POST /v2/batch_transfers` (InstaPay) from the wallet to the account's BIC.
  The payout is marked `PROCESSING` before the call so it cannot be sent twice. A rejected
  request (4xx) fails it; an unknown outcome (timeout, 5xx) leaves it `PROCESSING` for finance to
  check (`GET /v2/transfers/:id`) or record by hand — never resent automatically.

## Consequences

- Statements, invoices and balances always agree because they read the same ledger lines.
- The PayMongo transfer adapter is unit-tested against recorded request shapes but has not been
  run against the PayMongo sandbox (no keys were provided); its status endpoint and webhook
  handling must be confirmed in the sandbox before live use.
