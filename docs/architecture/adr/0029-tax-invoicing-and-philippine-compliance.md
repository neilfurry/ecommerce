# ADR 0029: Tax rules, invoicing and Philippine compliance dependencies

- Status: Accepted
- Date: 2026-11-26

## Context

"Do not hardcode a universal VAT assumption." The design must support Philippine compliance and
future jurisdictions. The user chose: **sellers invoice customers** (seller of record); the
marketplace invoices sellers for its services and issues credit notes for refunds.

## Decision

### Tax rules

`tax_rules` (versioned like commission rules; never edited) per **jurisdiction**, **what is
taxed** (`GOODS`, `MARKETPLACE_SERVICES`, `SELLER_REMITTANCE`), **seller registration**
(`VAT_REGISTERED`, `NON_VAT`, `ANY`; the exact registration beats `ANY`), rate, share of the
amount taxed (base %), tax-inclusive or added on top, effective dates and legal reference. With
no rule in force, no tax applies. Seeded starting points (editable):

| Code                  | Applies to                      | Rule                                                                                                         |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PH-VAT-GOODS`        | Goods of VAT-registered sellers | 12%, prices include it                                                                                       |
| `PH-VAT-SERVICES`     | Commission and fee recoveries   | 12% included (assumes the operator is VAT-registered)                                                        |
| `PH-EWT-EMARKETPLACE` | Remittances to sellers          | ½% of gross remittances (BIR RR 16-2023 as amended by RR 5-2025; RMC 8-2024, RMC 55-2026), from 15 July 2024 |

- Checkout uses the goods rule of each seller's registration at the time of the order and stores
  the rule, rate and inclusive flag on every item; non-VAT sellers' goods carry no VAT. A
  tax-exclusive rule adds the tax on top (it is the seller's, credited to the seller). The
  Phase 4 single VAT setting is ignored.
- Withholding is computed at settlement on the period's goods sold net of returns, excluding VAT
  (from the items' tax snapshot), shipping and the platform fee, unless finance recorded an
  accepted sworn declaration (`withholding_exempt_until`). The rule and inputs are stored on the
  statement.

### Seller tax profile

TIN and VAT registration (business profile), registered name on the BIR Certificate of
Registration, documents (CoR, sworn declaration), and finance's verification. Changing the TIN or
VAT status clears the verification. Payouts need a verified tax profile.

### Documents

- Sellers issue their own sales invoices to customers and record the number and date on each
  order (`PUT /seller/orders/:id/sales-invoice`).
- The marketplace issues, at each settlement, a **service invoice** (commission, payment fees,
  COD fees) and a **credit note** (commission returned) per seller, numbered without gaps per
  type and year (`SI-2026-000001`, `CN-2026-000001`, row-locked counter), with issuer, buyer and
  tax snapshots; immutable.

## Philippine compliance dependencies (not done in software; to confirm with the operator's

accountant and the BIR)

1. **Invoicing system registration.** Under RR 7-2024 (as amended by RR 11-2024) the invoice is
   the primary document. Using system-generated service invoices as official BIR invoices needs
   the operator's registration of its computerized accounting/invoicing system (CAS/CBA) or an
   Authority to Print, the BIR-required invoice fields and serial ranges, and — when mandated —
   e-invoicing (EIS). Until then the generated documents are internal statements.
2. **Withholding remittance and reporting.** Remitting withheld tax (monthly forms), issuing
   BIR Form 2307 certificates to sellers and submitting alphalists (RMC 55-2026 reminds
   e-marketplace operators) are not automated; the ledger (2320) and statements provide the data.
3. **Rates and bases.** The withholding rate and base, VAT on shipping and checkout charges,
   sworn declaration rules and the ₱500,000 threshold must be confirmed; all are configuration.
4. **Operator VAT status.** If the operator is not VAT-registered, end `PH-VAT-SERVICES` (or
   replace it with the applicable percentage tax treatment).
5. **Seller registration checks.** RR 16-2023 requires sellers to be registered; finance verifies
   the CoR manually.
6. **Data privacy.** Bank details are encrypted and masked (Data Privacy Act); retention periods
   for financial records follow the operator's policy (records are never deleted by the system).

## Consequences

- Adding a jurisdiction is configuration (tax rules with its code) plus any new withholding
  behaviour.
- Reports show output VAT and withholding payable from the ledger for filing preparation.
