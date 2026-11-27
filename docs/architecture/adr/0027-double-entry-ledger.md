# ADR 0027: Immutable double-entry ledger; balances derived from it

- Status: Accepted
- Date: 2026-11-26

## Context

"Every posted transaction must balance. Total debits = Total credits. Never directly edit posted
ledger entries. Corrections must use reversal and replacement transactions." "Do not implement
seller balances as manually editable numeric fields. Derive balances from ledger entries." Phase
5 kept a single-entry, append-only `seller_ledger_entries`.

## Decision

### Model

- `ledger_accounts`: the chart of accounts (seeded by the migration; finance can add accounts and
  deactivate non-system ones; nothing is deleted). Seller payables are **subledger accounts**:
  their lines must name the seller (and usually the seller order).
- `journal_transactions`: reference (`JE-…`), type, description, accounting date
  (`occurred_at`), status `DRAFT` / `POSTED`, source record (journal reference to the payment,
  refund, settlement, payout…), unique **idempotency key**, and `reversal_of_id` (unique: a
  journal is reversed at most once).
- `journal_entries`: account, debit **or** credit (CHECK: exactly one positive), seller and
  seller order dimensions, a `kind` (SALE, COMMISSION, PAYMENT_FEE, REFUND, SETTLEMENT,
  WITHHOLDING, PAYOUT…) used by statements and invoices.

### Integrity enforced by the database

- Posting (`DRAFT` → `POSTED`) runs a trigger that requires at least two lines, total debits =
  total credits > 0, and the seller on every seller payable line. Inserting a journal as
  `POSTED` directly is impossible (it has no lines yet).
- Posted journals and their lines cannot be updated or deleted (triggers); `TRUNCATE` is refused.
  Drafts (manual journals) can be edited or discarded.
- Corrections are reversals (`reverseJournalInTx` posts the exact opposite, linked by
  `reversal_of_id`) followed, when needed, by a new correct journal.
- `postJournalInTx` inserts with `ON CONFLICT DO NOTHING` on the idempotency key, so a retried
  webhook, a double click or a concurrent duplicate posts once and never fails the transaction.

### Chart of accounts and postings

| Event                                    | Journal (idempotency key)                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Online payment / bank transfer received  | Dr provider balance (1020) or bank (1010) / Cr customer payments clearing (2010) — `receipt:<payment>`                                                                                                                                                                                                       |
| Sale (money received for a seller order) | Dr clearing (order total), Dr vouchers (5030, marketplace discounts) / Cr seller pending (2110: items − seller discount + tax charged on top), Cr shipping income (4030), Cr charges income (4040); commission: Dr seller pending / Cr commission revenue (4010) + output VAT (2310) — `sale:<seller order>` |
| Provider fee                             | Dr payment fees (5010) / Cr provider or bank; if sellers bear it: Dr seller pending (allocated by seller order total) / Cr fee recoveries (4020) + output VAT — `fee:<payment>`                                                                                                                              |
| COD collected by the courier             | Dr COD receivable (1100) / Cr clearing — `cod-collected:<collection>`                                                                                                                                                                                                                                        |
| COD remittance                           | Dr bank (received) / Cr COD receivable (expected); shortage Dr COD fees (5020), overage Cr 4090 — `cod-remittance:<remittance>`; then the sale per seller order and the COD fee recovery                                                                                                                     |
| Self-arranged shipping credit            | Dr shipping income / Cr seller (pending, or available once settled) — `shipcredit:<seller order>`                                                                                                                                                                                                            |
| Refund succeeded                         | Cr provider or bank (amount); Dr seller (seller debit; pending, or available once settled); Dr refunds contra revenue (4090, the rest); commission returned: Cr seller / Dr commission revenue + output VAT at the rate charged on the sale — `refund:<refund>`                                              |
| Settlement                               | per order Dr pending / Cr available (2120); withholding Dr available / Cr withholding payable (2320) — `settlement:<seller>:<period>`                                                                                                                                                                        |
| Reserve / release                        | Dr available / Cr reserved (2130) and back                                                                                                                                                                                                                                                                   |
| Payout requested                         | Dr available / Cr payouts in process (2140) — `payout-request:<payout>`; rejection, cancellation and failure reverse it                                                                                                                                                                                      |
| Payout paid                              | Dr payouts in process / Cr bank or provider; transfer fee Dr 5040 — `payout-paid:<payout>`; a returned payout reverses both                                                                                                                                                                                  |
| Expense                                  | Dr expense (5xxx) + input VAT (1200) / Cr vendor payables (2210); payment Dr 2210 / Cr bank — voiding reverses                                                                                                                                                                                               |

Every money event is posted in the **same database transaction** as the business change that
causes it (payment confirmation, remittance, refund success, settlement, payout step), after
taking the existing order-row lock (ADR 0023) or the seller-balance advisory lock, so the books
and the operational records never disagree.

### Seller balances

Computed from posted seller payable lines, never stored: **pending** (2110), **held** (the part
of pending on orders with an open return, dispute or refund), **available** (2120; may be
negative — owed to the marketplace and deducted from the next settlements), **reserved** (2130),
**in payout** (2140), **paid** (payout lines on the cash accounts, net of reversals).

### Marketplace books vs seller bookkeeping

The general ledger is the marketplace's books: seller sales are not marketplace revenue (they
are liabilities owed to sellers; GMV is reported separately). Sellers see only their own
subledger (statement of account), statements and the documents issued to them; their own
bookkeeping (cost of goods, their VAT returns) is outside the marketplace.

### Migration of Phase 5 data

`seller_ledger_entries` is kept as frozen history and no longer written. `backfillLedger`
(idempotent, run by the seed and safe to re-run) posts the earlier receipts, COD collections and
remittances, sales, fees and refunds to the double-entry ledger.

## Consequences

- Trial balance always balances; reconciliation checks compare the ledger with payments, sales,
  refunds, COD collections, payouts and clearing (Admin › Reports › Checks).
- Shipping income and checkout charges are recorded gross (no output VAT split) until the
  operator's accountant confirms their VAT treatment (ADR 0029).
