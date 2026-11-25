# ADR 0019: Checkout pricing and multi-seller orders

- Status: Accepted
- Date: 2026-11-28

## Context

One checkout can contain items from several sellers. The brief asks for one parent order with
one suborder per seller. Each suborder keeps the seller, product snapshots, quantities,
prices, discounts, taxes, shipping and a commission reference. Every amount must be
calculated by the backend, which must never accept a grand total from the client. The Phase
4 kick-off decided:

- cash on delivery works now; online methods create orders that wait for payment and hold
  stock until a deadline;
- prices include 12% VAT (configurable);
- marketplace coupons are paid for by the marketplace, seller coupons by the seller.

## Decision

### One calculation for the quote and the order

`CheckoutPricingService.plan()` computes everything from the database, in this order:

1. **Items:** "buy now" (one variant), chosen cart lines, or every cart line not saved for
   later.
2. **Address:** the chosen one, or the customer's default.
3. **Prices and stock per line** with the pricing engine (ADR 0016). Phase 4 adds flash
   sales: a running flash price applies when it is below the sale/regular price, the quantity
   fits in the remaining flash units and the per-order limit. Otherwise the whole line is at
   retail (no split lines). A price agreed with the customer, or a cheaper wholesale tier,
   still wins.
4. **Shipping per seller:** from the seller's default active warehouse that has a PSGC
   location (ADR 0020) to the delivery address, quoted by the `ShippingProvider` (ADR 0021).
   The customer may pick a method per seller; the cheapest is the default.
5. **Coupons:** at most one marketplace coupon and one per seller. Seller coupons apply
   first, so the marketplace coupon applies to what is left. Checks: validity window, status,
   usage limit, uses per customer, minimum spend, and that the store is in the order. A
   coupon that cannot be used is returned as `NOT_APPLIED` with a reason, not silently
   dropped. Percentage and fixed discounts are split across sellers and then lines in
   proportion to their amounts. Free-shipping discounts are split across shipping fees. The
   split (`allocate`) uses the largest-remainder method, so parts always add up to the
   centavo.
6. **Per seller order:** configured charges (fixed or a percentage of items, optionally only
   for certain payment methods), the VAT included in the total (`amount × rate / (1 + rate)`)
   and the **commission**. Commission is on each line's price after the seller's own discount;
   marketplace-funded discounts do not lower it. The rate comes from the commission rule of
   the product's category, else the nearest parent category with a rule, else the default
   rule.

`POST /checkout/quote` returns this breakdown (groups per seller, lines, shipping options,
coupons, totals, VAT, payment methods and any blocking problems). Placing the order runs the
same `plan()` again **inside the order transaction**, so the stored order always equals a
fresh calculation.

### Placing an order (`POST /checkout/orders`)

- **Idempotency:** an `Idempotency-Key` header is required. `orders` has a unique key on
  (customer, key). Repeating a request returns the same order (200 instead of 201). Two
  identical requests at the same moment: the second hits the unique key and returns the
  first's order.
- **Agreed total:** the client sends `expectedGrandTotal`, the total it showed. The server
  never uses it for any amount. It only compares it with its own result. If they differ, or a
  coupon can no longer be used, the answer is `409 CHECKOUT_CHANGED` and nothing is created.
  Blocking problems (out of stock, no address, below the minimum quantity) return 422.
- **One transaction** (30 s timeout) that:
  1. locks the coupons involved (`SELECT … FOR UPDATE`) and re-plans;
  2. creates the order, one `seller_orders` row per seller (`<order number>-1`, `-2`, …), its
     shipping group and order items with the price snapshot, discounts, VAT and commission
     (rate, rule, base, amount);
  3. takes flash-sale units and coupon uses with **guarded updates** (`… WHERE used < limit`),
     so parallel checkouts can never exceed a limit;
  4. reserves stock for every item, linked to the order item (ADR 0017). COD holds last until
     fulfilment or cancellation. Online-payment holds expire 5 minutes after the payment
     deadline;
  5. increments the products' sold counts and removes the bought lines from the cart.
- After commit: low-stock checks and emails (customer confirmation; one email per seller with
  only that seller's items).
- **Order numbers** are `MP` + date (Manila time, `YYMMDD`) + 6 random characters.

### Payment states and expiry

- COD orders are `PLACED` with payment status `PAY_ON_DELIVERY`. Orders paid online are
  `AWAITING_PAYMENT` with payment status `PENDING` until the payment deadline
  (`paymentWindowMinutes`, 60 by default, 5–60 allowed).
- `cancelOrderInTx` (in the database package, shared by the API and the worker) releases
  reservations, coupon uses, flash-sale units and sold counts and records an event. Customers
  can cancel an order that is waiting for payment, or a COD order while every seller order is
  still `PENDING`. A worker job runs every 60 s and cancels unpaid orders
  whose deadline has passed.

### Storage

- Amounts are `Decimal(19,4)` rounded to the centavo when calculated. Database CHECK
  constraints require, for every order and seller order,
  `grand_total = items − coupon discounts + shipping − shipping discount + charges`.
- Commission is stored per order item and summed per seller order. Finance (a later phase)
  reads these amounts and does not recalculate them.

## Consequences

- A change in price, stock, coupon or settings between quote and order is caught and shown,
  never charged silently.
- No payment provider is connected yet. Online methods only create orders waiting for
  payment, which expire. The payment phase will mark them paid through signed webhooks.
- Settings (VAT rate, charges, payment methods and window, shipping rates) live in
  `platform_settings` with defaults in code, and commission rules live in their own table.
  Staff change them in the Admin Console. Orders keep the amounts they were placed with.
