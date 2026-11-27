# ADR 0026: Commission engine with versioned rules and snapshots

- Status: Accepted
- Date: 2026-11-26

## Context

Phase 6 requires configurable commission rules (default, seller, category, product, fixed,
percentage, effective dates, authorised exemptions), a documented precedence, and: "Every
commission record must preserve the applied rule and rate at transaction time. Historical
commissions must not change when an administrator updates commission settings." Phase 4 had
one percentage per category (or the default), edited in place.

## Decision

### Rules

`commission_rules` rows have a **scope** (`DEFAULT`, `CATEGORY`, `SELLER`, `SELLER_CATEGORY`,
`PRODUCT`), a **type** (`PERCENTAGE` of the base, `FIXED` amount per unit, `EXEMPT`), the target
ids for the scope (CHECK constraints enforce the combination), `effective_from` and an exclusive
`effective_to`, a reason (required for exemptions) and who created and ended the rule.

Rules are **versioned, never edited or deleted**: a database trigger refuses any change except
setting the end once (and user references). A new rule for the same target ends the current one
where the new one starts; a rule scheduled after that start must be ended first (409). Rules
cannot start in the past. The default rule can only be replaced, never ended, so there is always
one. Ending a scheduled rule before it starts makes it zero-length (never applies).

### Precedence

For the rules in force at the time of the sale (`effective_from <= t < effective_to`):

1. an `EXEMPT` rule that matches the item wins (the most specific one);
2. `PRODUCT` — the product itself;
3. `SELLER_CATEGORY` — the seller in the item's category or its nearest ancestor;
4. `SELLER` — every product of the seller;
5. `CATEGORY` — the item's category or its nearest ancestor;
6. `DEFAULT`.

Seller-negotiated rates beat category rates because they are deliberate exceptions for a seller;
a seller+category rate refines a seller rate. Exemptions beat everything so a promotional or
contractual zero rate cannot be overridden by an accidental narrower rule.
`resolveCommission` (in `@marketplace/database`) is a pure function used by checkout, the admin
preview and the unit tests.

### Calculation and snapshot

- Base (unchanged from Phase 4): line subtotal minus the seller-funded discount (marketplace
  discounts do not reduce the seller's sale).
- `PERCENTAGE`: base × rate, rounded half-up to the centavo. `FIXED`: amount × quantity, never
  more than the base. `EXEMPT`: zero.
- Each order item stores the rule id, scope, type, rate, fixed amount, base and amount. A trigger
  refuses any change to an order item's price, tax or commission columns. The commission is
  posted to the ledger (ADR 0027) from these snapshots, so commissions are reproducible from
  history.
- Commission is charged VAT-inclusive under the marketplace services tax rule (ADR 0029); the
  ledger splits it into revenue and output VAT.

### Permissions

`commission.manage` creates and ends rules; `commission.exempt` (Finance admin by default, not
Admin) is additionally required to grant or end an exemption. Every change is audited. The
Phase 4 settings endpoints (`PUT/DELETE /settings/commission-rules`) keep working: they create a
new default/category version and end a category rule.

## Consequences

- History is never rewritten; reports and refunds use the order item snapshot.
- Overlapping rules for the same target cannot exist; different targets coexist and precedence
  decides.
- Admins pick targets by id in this phase (the console links from seller, category and product
  pages); a searchable picker is a later improvement.
