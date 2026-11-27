# ADR 0030: Promotion engine and stacking rules

- Status: Accepted
- Date: 2026-11-27

## Context

Phase 7 asks for coupons with product/category restrictions and first-order coupons, plus a
promotion engine (flash sales, bundles, buy 1 take 1, free shipping, seasonal, seller and
marketplace campaigns), with "promotion stacking rules" and "all discounts calculated by the
backend". Phase 4 already had coupons (one marketplace coupon, one per seller) and flash sales.
The user chose **layered stacking, best per item**.

## Decision

### Campaigns

`campaigns` are automatic promotions (no code): scope `PLATFORM` (marketplace-funded, any store)
or `SELLER` (that seller's items, seller-funded); type `PERCENTAGE_OFF`, `FIXED_OFF`, `BUNDLE`
(value % off every eligible unit once `min_quantity` eligible units are in one store's part of
the order), `BUY_X_GET_Y` (buy X, get Y of the same item at value % off; 100 = free, so B1T1 is
buy 1 / get 1 / 100), and `FREE_SHIPPING` (a store's parcel when its eligible items reach
`min_spend`, optionally capped). A `season` label (e.g. "11.11"), dates, status and a priority
for ties. Coupons and campaigns share targets: all items, chosen products
(`coupon_products` / `campaign_products`) or chosen categories (including subcategories).
Seller promotions can only target the seller's own products.

### Stacking (in this order, `CheckoutPricingService.plan`)

1. **One item promotion per item**: the flash sale price or one campaign, whichever saves the
   customer more (ties keep the flash sale; between campaigns: higher priority, then older).
   A campaign that wins over a flash sale is computed on the regular price and the flash-sale
   unit is not taken. Bundles count only the units that actually take the bundle, so the
   choice is repeated until no bundle loses its minimum (pure functions in
   `promotion-engine.ts`, unit tested).
2. **Free shipping campaigns**, the best per parcel.
3. **Coupons**: seller coupons first, then the marketplace coupon, on what is left of the
   items they cover. A restricted coupon's minimum spend counts only covered items (after
   campaigns). A free-shipping coupon is rejected for a parcel that already ships free from a
   campaign ("free shipping from a campaign or a coupon, never both"). First-order coupons
   need a customer with no earlier order that was not cancelled.
4. **Loyalty points** last (ADR 0031).

### Storage and money

Campaign discounts are written into the existing `seller_discount` / `platform_discount` by
who funds them, so commission (base = line subtotal − seller discount) and the sale journal
work unchanged; `promotion_discount` and `campaign_id` on order items, and `order_promotions`
per seller order, keep what was applied for display and reports. `orders.coupon_discount` now
means coupons only; the order total check includes promotions and points.

## Consequences

- The customer always gets the single best item deal; deals never multiply on one item.
- When a sale price exists below the regular price and a campaign beats a flash sale, the
  campaign is taken off the regular price (documented trade-off; still better than the flash).
- Promotions are recomputed at every quote and at order placement from the database.
