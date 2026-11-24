# ADR 0004: Money and currency

- Status: Accepted
- Date: 2026-11-24

## Decision

- **Storage:** `Decimal(19, 4)` columns. Never `Float`/`double precision`. Four decimal places
  keep intermediate precision for commission percentages and tax. Amounts presented to customers
  are rounded to 2 places (centavos) at defined points, using banker's rounding unless a regulation
  says otherwise.
- **Currency:** every monetary record carries a `currency` column (`CHAR(3)`, ISO 4217) with a
  foreign key to `currencies`. The platform default is `PHP`; only active currencies can be used.
- **Transport:** JSON carries amounts as **decimal strings** (`"1499.50"`), validated by
  `decimalStringSchema` from `@marketplace/validation`. JSON numbers are rejected for money.
- **Arithmetic:** server-side calculations use Prisma's `Decimal` (decimal.js). JavaScript `number`
  arithmetic on money is not allowed. A shared money utility arrives with pricing in Phase 4.
- **Display:** `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })` in the UI only.

## Consequences

No rounding errors from floats. Every API that accepts money validates it with the shared schema.
