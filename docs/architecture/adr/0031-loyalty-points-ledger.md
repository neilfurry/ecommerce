# ADR 0031: Loyalty points as an append-only ledger

- Status: Accepted
- Date: 2026-11-27

## Context

"Use a ledger-style transaction history for loyalty points", with earning, redemption,
expiration, configuration and refund reversal. The user chose **earn on completion**: 1 point
per ₱100 paid, credited after the return window; 1 point = ₱1 at checkout up to 20% of the
order; 12-month expiry; refunds reverse points proportionally; all configurable.

## Decision

- `loyalty_transactions` is append-only (trigger): `EARN`, `REDEEM`, `RESTORE`, `REVERSE`,
  `EXPIRE`, `ADJUST`, `REFERRAL_BONUS`; signed points, `balance_after`, peso value, the order /
  seller order / refund / referral it came from, and a unique idempotency key.
  `loyalty_accounts.balance` is a cache moved only with a transaction row under a row lock;
  CHECK constraints keep balances ≥ 0.
- Settings: `platform_settings.loyalty` (`pesosPerPoint`, `pointValue`, `maxRedeemPercent`,
  `expiryMonths`, referral bonuses).
- **Earn** when a seller order becomes `COMPLETED` (the hook in `transitionSellerOrderInTx`):
  whole points on merchandise paid (items after every discount) less item refunds.
- **Redeem** at checkout, capped by the balance and `maxRedeemPercent` of the items left after
  promotions and coupons; allocated to lines as a marketplace-funded discount (`points_discount`).
- **Cancellation** gives every spent point back; a **refund** gives back the refunded items'
  share and takes back earned points down to what the remaining paid amount earns (never below
  zero; a shortfall is not charged).
- **Expiry** is first-in, first-out: what has expired is the earned lots past their date minus
  every point taken away since; a daily worker job posts `EXPIRE`.
- **Accounting** (double-entry, ADR 0027): earn / bonus / positive adjustment Dr 5050 Loyalty
  expense, Cr 2410 Points liability; expiry, reversal, negative adjustment the opposite. The
  sale journal debits 2410 (instead of 5030 vouchers) for the points part. Points given back
  after the sale was posted are Dr 4090 / Cr 2410; before it, there is nothing to reverse.
  2410 therefore equals customer balances plus points held by orders whose sale is not posted.

## Consequences

Every point can be traced to an order, refund, referral or staff adjustment (with the staff
member and reason), and to its journal.
