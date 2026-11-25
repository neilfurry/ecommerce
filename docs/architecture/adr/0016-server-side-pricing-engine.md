# ADR 0016: Server-side pricing engine and price snapshots

- Status: Accepted
- Date: 2026-11-27

## Context

The brief requires retail prices, wholesale tiers, minimum order quantities, customer-specific
prices and effective dates, and says the backend must calculate prices and never trust prices
sent by the frontend. Orders (Phase 4) must keep the applied price and rule.

## Decision

- **One pure function** (`price-engine.ts`) decides a unit price from the product's pricing
  settings, the variant, the tiers and customer prices in force, the buyer and the quantity. It
  has no database access and is unit tested on its own (20 cases).
- **Order of rules:**
  1. A price agreed with this customer (variant-specific before product-wide, then the highest
     minimum quantity reached) wins.
  2. Otherwise the retail price: the sale price while its window is open, else the regular price.
  3. Wholesale tiers apply only when the buyer is an approved `WHOLESALE_CUSTOMER`, wholesale is
     enabled on the product and the quantity reaches the wholesale minimum. Variant tiers
     replace product tiers. The tier for the highest break reached is used only if it is cheaper
     than retail.
- **Limits:** minimum and maximum order quantity are enforced (422); tiers that overlap in time
  must use different quantities, and a larger quantity may not have a higher unit price.
- **Snapshot:** every quote line returns `source` (`CUSTOMER_PRICE`, `WHOLESALE_TIER`, `SALE`,
  `REGULAR`), the `rule` (type, id, minimum quantity, window), the tier table that was in force,
  the unit price and the line total. Checkout will store this object on the order item.
- **Money** is `Decimal(12,2)` in PHP (ADR 0004); arithmetic uses Prisma `Decimal`, never
  floating point.
- `POST /pricing/quote` is public and read-only (CSRF skipped), with a strict schema that
  refuses any extra field, so a client cannot even propose a price.

## Consequences

- Promotions and vouchers (later phase) layer on top of the engine's result rather than
  changing it.
- Customer prices are set per customer email by the seller; sellers see only their own.
