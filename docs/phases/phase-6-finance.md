# Phase 6 report: Commission engine, seller settlement and accounting

- Branch: `phase-6-finance` (PR #6, based on `phase-5-orders`)
- Date: 2026-11-27
- Verified on: GitHub Actions run `45920163677`, commit `3e95fd7` (all three jobs green, nothing flaky)
- Status: **Complete, awaiting review and approval.** Phase 7 has not been started and will not
  start until you approve this phase and send the Phase 7 details.

Decisions applied (from the Phase 6 kick-off):

1. **Payouts:** a manual workflow (the seller requests, finance verifies and approves, then pays
   by bank transfer and records the reference), plus a PayMongo disbursement adapter. The adapter
   is used only when PayMongo keys and a wallet are configured.
2. **Settlement:** earnings become eligible once the order is delivered and the 7-day return
   window has passed with no open return or dispute. Periods are weekly (Monday to Sunday), and
   the schedule is configurable.
3. **Gateway fees:** configurable. By default the seller bears them: each fee is split across the
   seller orders by their share of the payment and deducted at settlement. Admins can switch any
   channel (online, bank transfer, COD) to marketplace-absorbed.
4. **Invoicing:** each seller is the seller of record and issues its own sales invoice; we store
   its reference and a tax snapshot. The marketplace issues service invoices to sellers for
   commission and fees, and credit notes when commission is returned on refunds.

## 1. Implemented features

### Commission engine (§1, ADR 0026)

- **Rule scopes:** default, category, seller, seller in a category, and product.
- **Rule types:** percentage, fixed per unit (never more than the base), and exemption.
  Exemptions need a reason and the `commission.exempt` permission.
- **Effective dates:** rules can be scheduled. Rules are versioned: a new rule ends the current
  one for the same target, and the database refuses any edit or deletion.
- **Precedence:** a matching exemption wins, then product > seller in a category > seller >
  category (nearest) > default.
- **Preview:** "which rule applies to this product" is available in the Admin Console and the API.
- **Snapshots:** order items keep the rule, scope, type, rate, fixed amount, base and amount. A
  trigger refuses any change to an item's price, tax or commission. Changing rules never
  touches placed orders.

### Double-entry ledger (§2, ADR 0027)

- **Records:** chart of accounts, journals (reference, type, description, accounting date,
  source record, posting status, idempotency key, reversal link) and lines (debit or credit,
  seller and seller-order dimensions, kind).
- **Enforced by the database:**
  - posting requires total debits = total credits and at least two lines;
  - every seller payable line must name the seller;
  - posted journals and their lines cannot be updated, deleted or truncated.
- **Corrections:** a reversal posts the exact opposite (at most once), followed by a correct
  journal where needed.
- **What is posted:** receipts, sales (seller earnings, commission and its output VAT, marketplace
  vouchers, shipping and charges income), provider and COD fees with seller recovery, COD
  collection and remittance (with the shortage or overage), self-delivery shipping credits,
  refunds (seller share, commission returned with its VAT, marketplace share), settlements,
  withholding, reserves, payouts and expenses.
- **Atomic:** each posting runs in the same database transaction as the business change.
- **Phase 5 history:** it is posted by an idempotent backfill (run by the seed). The old
  single-entry table is kept as frozen history.

### Seller financial accounts (§3)

Balances are always computed from posted lines; nothing is stored or editable:

- **pending** (earned, not yet eligible) and **held** (the part of pending on orders with an open
  return, dispute or refund);
- **available** (settled). It may be **negative**: the seller then owes the marketplace, the
  amount is deducted from later settlements, and payouts are blocked;
- **reserved** (held back by finance with a reason);
- **in payout** and **paid**.

Refunds before settlement reduce pending; refunds after settlement reduce available.

### Settlement (§4, ADR 0028)

- **Periods:** weekly by default, with every two weeks or monthly available. The first weekday
  and extra hold days are settings. Periods use Philippine time.
- **Eligibility:** money received (sale posted); delivered and the return window plus hold
  passed, or ended without delivery; no open return, dispute or refund.
- **Runs:** the worker settles the last closed period every 6 hours, and finance can run it
  from the console. Each seller is settled once per period and each order once ever.
- **Statements:** immutable, with order lines (sales, shipping, commission, fees, refunds,
  commission returned, adjustments, net). They also show withholding with its rule and inputs,
  and the available balance before and after.
- **Service documents:** a service invoice and a credit note are issued from the same ledger
  lines, numbered without gaps (`SI-2026-000001`).

### Payouts (§5, ADR 0028)

- **Bank and e-wallet accounts:** the number is stored encrypted (AES-256-GCM). Only the last four
  digits are ever returned or logged, details cannot be changed, and finance verifies each
  account.
- **Requests** need:
  - a verified seller with a verified tax profile;
  - a verified account;
  - an amount between the minimum (₱100) and the available balance, checked under a per-seller
    lock;
  - an idempotency key.
- **Workflow:** requested → approved → paid. Requests can also be rejected or cancelled, or fail.
  A paid payout can be reversed when the bank returns it. Each of these returns the money to
  the available balance through the ledger.
- **Controls:** the requester cannot approve. Every step is in an append-only approval log and
  the audit log.
- **Manual payouts:** finance records the bank reference and any transfer fee.
- **PayMongo payouts:** sent as InstaPay `batch_transfers` from the configured wallet. An unknown
  outcome is never sent again automatically.

### Accounting module (§6)

- **Ledger tools:** chart of accounts (add and deactivate; system accounts stay), journal list and
  detail, manual journals (draft → post → reverse), and a general ledger per account with
  running balance.
- **Accounts payable and receivable:**
  - **Payable:** seller payables, plus vendor payables from **expense records** (record with
    input VAT, pay, or void by reversal).
  - **Receivable:** COD held by couriers, plus negative seller balances.
- **Reports:** revenue (income statement plus facilitated GMV, output VAT and withholding),
  commission (by seller and by rule type), refunds (by reason, seller and marketplace share),
  COD reconciliation (per courier vs the ledger receivable), settlements and payouts, and trial
  balance. All use period filters.
- **Reconciliation checks**, read from one consistent snapshot:
  - journals balance;
  - every received payment, paid sale and succeeded refund is posted;
  - the COD receivable equals collections not yet remitted;
  - payouts in process equal open requests;
  - settled orders have nothing left pending;
  - unallocated customer money is explained;
  - negative balances are listed.
- **Marketplace books are separate from seller bookkeeping:** seller sales are liabilities, not
  revenue. Sellers see only their own statement of account, statements and documents.

### Tax and invoicing (§7, ADR 0029)

- **Tax rules:** versioned per jurisdiction, by what is taxed (goods, marketplace services,
  remittances) and by seller registration, each with rate, base share, inclusive or added on
  top, and a legal reference.
- **No universal VAT:** checkout applies the goods rule for each seller's registration (non-VAT
  sellers' goods carry none) and snapshots it on every item. The Phase 4 VAT setting is gone.
- **Seeded Philippine rules (editable):**
  - 12% VAT on goods of VAT-registered sellers;
  - 12% VAT on marketplace services;
  - withholding of ½% of gross remittances (RR 16-2023 as amended by RR 5-2025).
- **Seller tax profile:** TIN, VAT status and registered name, with the CoR and sworn declaration
  documents. Finance verifies it and can record a withholding exemption. A change clears the
  verification.
- **Invoices:** sellers record their own sales invoice number on each order. Marketplace
  service invoices and credit notes are described above.

### Admin Console (§8) and Seller Center (§9)

- **Admin Console › Accounting** has: financial dashboard (with work queues and reconciliation
  status), seller balances and statements of account (with reserves), settlements (preview and
  run), payouts (approval, recording, PayMongo send and check, failure, reversal) and bank
  accounts to verify, commission, taxes and seller tax verification, ledger, expenses,
  invoices to sellers, reports and checks, and finance settings. Every action is shown only
  with its permission.
- **Seller Center › Finance** has: overview (balances, sales summary with period filter,
  current period, what is missing before the first payout), transactions, settlement
  statements, invoices from the marketplace, payouts (request with an idempotency key, cancel,
  history with log), bank accounts, and tax profile. Each order also gets a sales-invoice card.
  The Phase 5 "Payables" page now redirects to Transactions.

## 2. Created and modified files

- **Database** (`prisma/`):
  - schema;
  - migration `20261210090000_finance_ledger_settlement`;
  - `src/ledger.ts` (posting core, balances, postings, periods);
  - `src/commission.ts` (precedence and calculation);
  - `src/settlement.ts` (eligibility, settlement, documents, runs);
  - `src/ledger-backfill.ts`;
  - `src/finance.spec.ts`;
  - `src/payments.ts` and `src/fulfilment.ts` (now post to the ledger);
  - seed (finance demo user, backfill).
- **API:**
  - `modules/finance/` (ledger, balances, settlements and tax profiles, payouts, expenses,
    reports, admin and seller controllers);
  - `modules/settings/commission-rules.service.ts` and `tax-rules.service.ts`;
  - checkout pricing (commission resolver, tax rules);
  - refunds and COD (ledger postings);
  - seller order detail (taxes, invoice, settlement, ledger lines);
  - config (`FINANCE_ENCRYPTION_KEY`, PayMongo wallet);
  - `test/finance.e2e-spec.ts`, plus updates to earlier e2e tests.
- **Worker:** `jobs/settlement.ts` (scheduled settlement).
- **Shared packages:**
  - `validation/src/finance.ts`;
  - `shared-types` (permissions, ledger kind labels, sworn declaration document);
  - `payments/src/payouts.ts` and its tests;
  - `api-client/src/finance.ts` and `finance-react.tsx`;
  - `ui/src/patterns/finance.tsx`.
- **Admin Console:** `pages/finance/finance-admin-pages.tsx`, `ledger-pages.tsx`,
  `finance-common.tsx`, `finance-utils.tsx` and `accounting.test.tsx`, plus routes, navigation,
  and the settings page (VAT field replaced).
- **Seller Center:** `pages/finance/finance-pages.tsx` and `finance.test.tsx`, plus routes,
  navigation, the order page and the returns page (old payables page removed).
- **Browser test:** `e2e/finance.spec.ts`.
- **Docs:** ADRs 0026–0029 (ADR 0025 marked partly superseded), the API reference Phase 6
  section, testing guide, roadmap, Windows setup (finance demo user) and `.env.example`.

## 3. Database changes

One migration, `20261210090000_finance_ledger_settlement`.

- **New tables:**
  - `tax_rules`, `ledger_accounts`, `journal_transactions`, `journal_entries`;
  - `settlements`, `settlement_lines`;
  - `seller_bank_accounts`, `payouts`, `payout_events`;
  - `finance_documents`, `document_sequences`, `expenses`.
  - The chart of accounts (23 accounts) and the three Philippine tax rules are seeded by the
    migration.
- **Changed tables:**
  - `commission_rules` becomes scoped and versioned; existing rules become DEFAULT/CATEGORY
    rules effective from their creation.
  - `order_items` gains commission scope, type and fixed amount, and the tax rule, rate and
    inclusive flag. Earlier items get a 12% snapshot where they carried VAT.
  - `seller_orders` gains the seller's invoice number and date.
  - `sellers` gains the registered name, tax verification and withholding exemption.
  - The seller document type gains `SWORN_DECLARATION`.
- **Triggers:**
  - rules are versioned (no edit or delete);
  - order item snapshots are immutable;
  - journals post only when balanced and stay immutable once posted;
  - statements, statement lines, documents and payout events are append-only;
  - payouts, expenses, bank accounts and ledger accounts are never deleted;
  - bank account details are frozen.
- **Checks:** a line is a debit or a credit, never both; rule scope and type combinations; payout
  and expense amounts; document totals; one default bank account per seller.

## 4. API endpoints

See `docs/api/API_REFERENCE.md` › Phase 6. In short:

- **Seller Center:** `/api/v1/seller/finance/*` (overview, transactions, settlements, documents,
  bank accounts, payouts, tax profile) and `PUT /seller/orders/{id}/sales-invoice`.
- **Admin Console:** `/api/v1/finance/*` (dashboard, settings, commission rules and preview, tax
  rules and seller tax profiles, accounts and account ledgers, journals, balances and reserves,
  settlements, documents, bank accounts, payouts, expenses, reports, reconciliation).

## 5. Permissions and environment

- **New platform permissions:** `finance.read`, `finance.manage`, `commission.manage`,
  `commission.exempt`, `tax.manage`, `ledger.post`, `settlements.manage`, `payouts.approve`,
  `payouts.process`.
  - Finance admins get all of them.
  - Admins get `finance.read` and `commission.manage`, but not exemptions.
  - Super admins get everything.
- **New seller permissions:** `seller.finance.read` (owner, manager, accounting) and
  `seller.payouts.manage` (owner, accounting).
- **Demo user:** `finance@marketplace.local` (Finance admin).
- **Environment:**
  - `FINANCE_ENCRYPTION_KEY` encrypts bank account numbers. It has a development default and is
    required (random) in production.
  - `PAYMONGO_WALLET_ACCOUNT_NUMBER`, `PAYMONGO_WALLET_ACCOUNT_NAME` and `PAYMONGO_WALLET_BIC`
    (with `PAYMONGO_SECRET_KEY`) enable PayMongo payouts.

## 6. Starting the project (Windows PowerShell)

```powershell
git pull
pnpm install
.\scripts\setup.ps1          # applies the migration; the seed posts earlier money events to the ledger
.\scripts\dev.ps1
```

**Try it:**

1. **Set up fees.** As `finance@marketplace.local`, open Admin Console › Accounting › Finance
   settings and enter fee rates (they are zero by default) and the invoice issuer.
2. **Complete an order.** Buy and pay as in Phase 5, then have the seller ship it and simulate
   delivery. The seller's Finance page shows the earnings as **pending**.
3. **Settle it.** Settlement needs the return window to have passed: wait 7 days, or set the
   return window shorter in Admin › Settings for testing. Then use Accounting › Settlements ›
   "Settle last period now" (or let the worker do it). The statement, the service invoice and
   the **available** balance appear.
4. **Pay out.** The seller adds a bank account under Finance › Bank accounts. Finance verifies it
   (Accounting › Payouts › Bank accounts to verify) and the seller's tax profile (Accounting ›
   Taxes › Seller tax profiles). The seller requests a payout; finance approves it and records
   the bank reference.
5. **Check the books.** Accounting › Reports › Checks should show everything OK. The trial
   balance always balances.

## 7. Test results

All of these were executed. Earlier tests changed only where behaviour changed on purpose:

- VAT is now by seller registration;
- the ledger replaced the Phase 5 seller payables table (journal lines, kind `SALE` instead of
  `ORDER_EARNING`);
- the seller manager role gained `seller.finance.read`.

| Suite                                   | Result (CI run `45920163677`)                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, format                 | Pass                                                                                                                            |
| Unit tests (all packages and apps)      | 488 passed (new: commission precedence and amounts, money helpers, periods, PayMongo payouts, admin and seller finance screens) |
| API e2e                                 | 272 passed in 22 suites (new `finance.e2e-spec.ts`: 15)                                                                         |
| Worker integration                      | 9 passed                                                                                                                        |
| Playwright                              | 35 passed, 1 skipped, no flaky tests (new: seller adds a bank account, finance verifies it, accounting pages)                   |
| Migration drift (`prisma migrate diff`) | Clean (first run caught a column type in the hand-written migration; fixed in `3e95fd7`)                                        |
| PowerShell scripts                      | Pass                                                                                                                            |

On the report commit (`cc93526`, documentation only) the Phase 2 SMS sign-up browser test flaked
once on the mobile project (passed on retry and on the rerun, run `45921121720`). This is the
intermittent test noted in the Phase 5 report; it is unrelated to Phase 6.

How each §10 requirement is proven is listed in `docs/testing/TESTING_GUIDE.md` › Phase 6.
Locally, every reconciliation check passed on the accumulated development data after the
backfill.

## 8. Accounting assumptions and Philippine compliance dependencies

**Assumptions** (all configurable unless noted):

- **Seller of record.** Sellers are the seller of record for goods. Their sales are liabilities
  of the marketplace, not marketplace revenue.
- **Commission and fees.**
  - Commission is based on the items after the seller's own discount.
  - Commission and fee recoveries are VAT-inclusive under the marketplace services rule.
  - Provider fees are not returned on refunds.
- **Shipping and charges.** Income from shipping and checkout charges is recorded gross, with no
  output VAT split, until confirmed (ADR 0027).
- **Withholding.** It is computed at settlement on goods sold net of returns, excluding VAT
  (from the item snapshot), shipping and the platform fee.
- **Recognition.** Earnings are recognised when the money is received. For COD this is the
  remittance.
- **Periods.** Settlement periods and report dates use Philippine time.

**Compliance dependencies.** These are not done in software; confirm them with the operator's
accountant and the BIR (details in ADR 0029):

1. **Invoices.** Registration of the invoicing system (CAS/CBA or ATP, and EIS when mandated) is
   needed before the generated service invoices can serve as official BIR invoices (RR 7-2024
   and RR 11-2024). Until then they are internal statements, and the document says so.
2. **Withholding.** Remitting withholding tax, issuing BIR Form 2307 and submitting alphalists
   are not automated. The ledger (account 2320) and statements provide the data.
3. **Rates.** The withholding rate and base, VAT on shipping and charges, the sworn declaration
   rules and the ₱500,000 threshold all need confirming.
4. **Operator VAT status.** The services VAT rule assumes the operator is VAT-registered.
5. **Seller registration.** Finance checks each seller's CoR manually.
6. **Records.** Retention periods for financial records are a policy decision; the system never
   deletes financial records.

## 9. Remaining issues and limitations

- **PayMongo payouts were not run against the sandbox** (no keys or wallet were provided). The
  request shape follows PayMongo's `batch_transfers` documentation and is unit-tested. The
  status endpoint and transfer webhooks must be confirmed in the sandbox before live use. The
  manual workflow is fully working.
- **Fee rates are zero** until finance enters the contracted rates. COD fee recovery is posted
  but covered only by code review; its e2e test was left out because it would change settings
  other parallel suites rely on.
- **Rule targets are entered by id** in the commission and manual journal dialogs. There is no
  searchable picker yet.
- **No period closing or locking.** Back-dated manual journals are allowed (they are audited and
  reversible).
- **Service invoices are not official BIR invoices** until the invoicing system is registered
  (see §8).
- **Phase 5 limitations still apply:** Maya and Xendit are not implemented, and real couriers
  await credentials.

## 10. Acceptance

| Requirement (brief §)                                                                                                                                                               | Status                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| §1 Default, seller, category, product, fixed, percentage, effective dates, authorised exemptions; precedence documented; rule and rate preserved; history unchanged                 | Done (ADR 0026)                                       |
| §2 Accounts, transactions, entries, journal references, descriptions, debit/credit, posting status, reversals; balanced; never edited                                               | Done, enforced by database triggers (ADR 0027)        |
| §3 Payable, pending, eligible, reserved/held, paid, negative balances, refund deductions; derived from the ledger                                                                   | Done                                                  |
| §4 Periods, eligibility, delivery requirement, return/dispute holds, commission, fee allocation, refunds, statements; configurable schedule                                         | Done (ADR 0028)                                       |
| §5 Request, bank account selection, verification, approval, processing, failure, reversal, history; provider API where supported, manual workflow with references and approval logs | Done; PayMongo adapter not yet run in the sandbox     |
| §6 Chart of accounts, journals, general ledger, AP, AR, expenses, revenue/commission/refund/COD/settlement reports, period filters; marketplace books separate                      | Done                                                  |
| §7 Tax classification, rates, inclusive/exclusive, seller tax info, snapshots, invoice references, credit notes; no universal VAT; Philippine and other jurisdictions               | Done (ADR 0029); BIR registration dependencies listed |
| §8 Admin dashboard, commission, balances, settlements, payout approval, ledger viewer, reports, reconciliation                                                                      | Done                                                  |
| §9 Seller dashboard, sales summary, commission, pending, available, statements, payout requests and history, reports                                                                | Done                                                  |
| §10 Tests                                                                                                                                                                           | Done (see §7)                                         |
| §11 Traceable, balanced, reconciled, reproducible, accurate, nothing silently deleted or modified; assumptions and compliance documented                                            | Done (see §8)                                         |
