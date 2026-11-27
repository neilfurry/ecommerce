# ADR 0032: Referrals and affiliate commissions

- Status: Accepted
- Date: 2026-11-27

## Context

"Prepare referral codes, tracking, affiliate accounts, commission configuration, attribution,
conversion records and reports. Ensure commissions are auditable." The user chose **track and
accrue in the ledger**, with manual payouts.

## Decision

- **Referrals:** each customer gets a `referral_code`; signing up with it creates a `referrals`
  row (one per new customer). When the new customer's first seller order completes, both get
  bonus points (configurable) as `REFERRAL_BONUS` transactions.
- **Affiliates:** customers apply; staff (`affiliates.manage`) approve, suspend or reject and may
  set an own rate (else `platform_settings.affiliates.defaultCommissionRate`). Links carry
  `?aff=CODE`; the storefront remembers the code for the link window and records a click (no
  raw IP; a salted hash per day). Checkout attributes the order to an approved affiliate that
  is not the buyer.
- **Conversions:** one per seller order with base (merchandise paid), rate and commission
  frozen at checkout (a trigger refuses changes). `PENDING` → `ACCRUED` when the seller order
  completes (net of refunds so far; Dr 5060 / Cr 2420), `CANCELLED` if it is cancelled;
  later refunds raise `reversed_amount` (only up) and post Dr 2420 / Cr 5060.
- **Payouts:** finance records a manual payout of everything payable (accrued net of reversals
  less earlier payouts; minimum configurable); Dr 2420 / Cr 1010; conversions become `PAID`.
  Payouts are append-only.
- **Reports:** monthly clicks, conversions, sales and commission for the affiliate and staff.

## Consequences

Each peso of commission traces to a seller order, a frozen rate, its journals and a payout.
