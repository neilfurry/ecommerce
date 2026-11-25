# Phase 4 report: Customer storefront, shopping cart and checkout

- Branch: `phase-4-storefront` (PR #4, based on `phase-3-catalog`)
- Date: 2026-11-25
- Verified on: GitHub Actions run `45633417150`, commit `565d1d2` (all three jobs green)
- Status: **Complete, awaiting review and approval.** Phase 5 has not been started and will not
  start until you send the Phase 5 details.

Decisions applied (from the Phase 4 kick-off):

1. **Cash on delivery works now; online methods wait for payment.** GCash, Maya and card
   orders are created as `AWAITING_PAYMENT` and hold their stock until the payment window ends
   (60 minutes by default, 5–60 configurable). A worker job then cancels them and releases
   everything. The payment provider comes in a later phase.
2. **Prices include VAT.** 12% by default and configurable. Each order, seller order and line
   shows the VAT included in it.
3. **Marketplace and seller coupons.** Marketplace coupons are funded by the marketplace and
   do not reduce the seller's commission base; seller coupons are funded by the seller, apply
   only to that seller's items and do reduce it. At most one marketplace coupon and one per
   seller per order.

The example from the brief works as written: a laptop from Isla Tech Gadgets (Seller A) and
a mouse and keyboard from Click & Type (Seller B) in one checkout give one order,
`MP…`, with suborders `MP…-1` for Seller A and `MP…-2` for Seller B. Each has its own
shipping group, item snapshots, discounts, VAT and commission.

## 1. Implemented features

### Storefront (customers)

- **Home page** (all content from `GET /storefront/home`): logo and branding, search with
  suggestions, category navigation and menu, hero and promo banners, the running flash sale
  with a countdown and units left, featured products, best sellers, recommended products
  (based on the customer's orders, wishlist and cart when signed in), featured stores, footer.
- **Catalog:** search results and category pages with filters (keyword, category, seller,
  brand, price range, rating, in stock, wholesale available) and sorting (relevance, newest,
  price, best-selling, rating). Product page with variant choice, photos, specifications,
  rating and reviews, stock, retail, sale, flash and wholesale prices, and the price for the
  chosen quantity from the server. Store pages with the store's products.
- **Cart:** add, remove, change quantity, change variant (remove and add), save for later,
  grouped by seller. Guests keep a cart in the browser (ids and quantities only). It is priced
  by the server and joins the account cart at sign-in. Signed-in carts are stored. Every view
  re-checks prices and stock.
- **Checkout:** address choice or a new address, one package per seller with its shipping
  options, coupons, payment method, notes per seller and the full breakdown. Every amount comes
  from the server's quote. Placing the order sends the total that was shown. If the server's
  total differs, the customer sees the new total instead of being charged a different one.
- **Account:** overview with the account type (retail or wholesale), orders and order detail
  (one package per seller, cancel while allowed), addresses (PSGC region → province → city →
  barangay), wishlist, reviews (for bought items), and profile and security (Phase 2: email
  and mobile, password, sign-in methods, wholesale application). Wholesale still needs admin
  approval (Phase 2).
- Responsive on phones: the whole checkout is tested on a Pixel 7 viewport.

### Seller Center

- **Orders:** the seller's suborders only, with search and status filter, and a detail page
  (items with price snapshots, shipping group, customer and address, coupons, commission per
  item). Read-only until fulfilment.
- **Coupons:** create and edit seller-funded coupons.
- **Flash sales:** add products to upcoming or running marketplace sales (flash price, units,
  per-order limit), or withdraw them.
- **Warehouses:** a PSGC location picker. A warehouse with a location can be a shipping
  origin; one without is flagged.

### Admin Console

- **Orders:** customer orders and seller suborders, with detail pages.
- **Promotions:** marketplace coupons (all coupons are listed; seller coupons read-only) and
  flash sales (schedule, edit, switch a seller's item off).
- **Storefront content:** banners (upload, schedule, order, hide) and featured products and
  stores (ordered).
- **Reviews:** hide with a reason, or publish again.
- **Settings:** VAT rate, payment methods and window, extra charges; the mock shipping rate
  table; commission rates (default and per category).

### API, worker and data

- Search behind a `SearchProvider` interface, with PostgreSQL full-text and trigram search
  (ADR 0018).
- `CheckoutPricingService` for both the quote and the order; order placement in one
  transaction with idempotency keys, row locks and guarded updates (ADR 0019).
- PSGC locations: 42,004 barangays imported from data, re-importable (ADR 0020).
- `ShippingProvider` interface and a mock provider with an editable rate table, refused in
  production (ADR 0021).
- Flash-sale prices in the pricing engine.
- Order emails: confirmation to the customer, one email per seller with only that seller's
  items, and cancellation emails.
- Unpaid online orders expire through a worker job that runs every 60 s.
- Demo data: two more sellers (Cebu and Davao), a wholesale customer, coupons, a flash sale,
  featured content and generated product photos and banners.

## 2. Created and modified files

187 files changed (113 new) against `phase-3-catalog`. Main areas:

| Area                         | Files                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                     | `prisma/schema.prisma`, `prisma/migrations/20261128090000_storefront_cart_checkout/`, `prisma/src/{locations,orders,seed-storefront}.ts`, `prisma/import-locations.ts`                                                |
| API modules (new)            | `apps/api/src/modules/{storefront,locations,addresses,wishlist,reviews,cart,promotions,shipping,checkout,orders,settings}/`, `apps/api/src/scripts/seed-demo-media.ts`                                                |
| API modules (changed)        | `pricing` (flash sales), `inventory` (warehouse locations, order-item reservations), `products` (public catalog moved to `storefront`), `notifications`, `files`, `users` (search fix)                                |
| Worker                       | order emails, `jobs/unpaid-order-sweep.ts`                                                                                                                                                                            |
| Shared packages              | `shared-types/src/storefront.ts`, `validation/src/{storefront,checkout}.ts`, `api-client/src/{shop,shop-react}.ts(x)`, `ui` (`SellerOrderView`), `auth-ui` (`CouponManager`)                                          |
| Storefront                   | `layouts/store-layout.tsx`, `pages/home-page.tsx`, `pages/shop/*`, `pages/account/*`, `components/shop/*`, `lib/guest-cart.ts`                                                                                        |
| Seller Center, Admin Console | `pages/orders/*`, `pages/marketing/*`, `pages/settings/*`, warehouse location picker, navigation and routes                                                                                                           |
| Tests                        | `apps/api/test/{checkout,storefront}.e2e-spec.ts`, `price-engine.spec.ts`, `money.spec.ts`, `order-jobs.spec.ts`, UI tests in all three apps (storefront fixtures captured from the real API), `e2e/shopping.spec.ts` |
| Docs                         | ADRs 0018–0021, API reference, architecture, local database, testing guide, Windows setup, roadmap, this report                                                                                                       |

## 3. Database changes

Migration `20261128090000_storefront_cart_checkout` (hand-written, matched to the Prisma
schema; the CI drift check compares them):

- New tables: `ph_locations`, `customer_addresses`, `cart_items`, `wishlist_items`,
  `product_reviews`, `home_banners`, `featured_products`, `featured_stores`, `flash_sales`,
  `flash_sale_items`, `coupons`, `coupon_redemptions`, `platform_settings`,
  `commission_rules`, `orders`, `seller_orders`, `order_shipping_groups`, `order_items`,
  `order_coupons`, `order_events`.
- Changed: `products` (rating average and count, sold count), `warehouses` (PSGC codes),
  `stock_reservations` (nullable expiry, order-item link).
- Integrity in the database: CHECK constraints that each order's and seller order's grand
  total equals items − coupon discounts + shipping − shipping discount + charges. Also
  non-negative amounts, valid rates, flash units within limits, and coupon uses within
  limits. Partial unique indexes allow one default address per customer and one default
  commission rule. Unique (customer, idempotency key).
- Search indexes: GIN full-text expression index and `pg_trgm` index on product names.
- Seeded in every environment: the default 5% commission rule and the PSGC locations.

## 4. API endpoints

63 new or rewritten endpoints, listed in [API_REFERENCE.md](../api/API_REFERENCE.md) and in
Swagger at `/api/docs`. In short:

- Public: search, suggestions, product, reviews, home page, banner images, locations, guest
  cart preview.
- Customers: addresses, wishlist, reviews, cart, checkout quote and orders, order history and
  cancellation.
- Sellers: suborders, coupons, flash sales.
- Staff: orders and suborders, banners, featured items, coupons, flash sales, reviews,
  settings, commission rules.

New error code: `CHECKOUT_CHANGED` (409).

## 5. Permissions and environment

- New platform permissions: `orders.read`, `marketing.manage`, `settings.manage`,
  `reviews.moderate`. ADMIN has all four, FINANCE_ADMIN `orders.read` and `settings.manage`,
  CUSTOMER_SUPPORT `orders.read` and `reviews.moderate`.
- New seller permissions: `seller.orders.read`, `seller.marketing.manage`. SELLER_MANAGER has
  both; SELLER_ORDER_PROCESSOR and SELLER_ACCOUNTING have `seller.orders.read`. Only verified
  sellers can create coupons or join flash sales.
- New environment variable: `SHIPPING_PROVIDER` (`mock`; refused in production).

## 6. Starting the project (Windows PowerShell)

```powershell
git pull
pnpm install
.\scripts\setup.ps1          # builds, applies the migration, imports locations, seeds demo data and photos
.\scripts\dev.ps1            # API, worker and the three apps
```

Then follow steps 8–9 of
[WINDOWS_SETUP.md](../development/WINDOWS_SETUP.md#4-verify-the-installation): a guest buys a
keyboard and a laptop from two sellers, signs in, applies `FREESHIP` and pays on delivery.
Then Click & Type sees only its suborder in the Seller Center, and staff see both. Demo
accounts: `customer@marketplace.local`, `wholesale@marketplace.local`,
`seller2.owner@marketplace.local`, `seller3.owner@marketplace.local` (password as in Phase 2).

## 7. Test results

All results below come from real runs; nothing was counted from a run that did not happen.

GitHub Actions run `45633417150`, commit `565d1d2` (all three jobs green):

| Suite                                                     | Result                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (11 packages)                                  | **432 passed** (34 more than Phase 3): api 122, validation 96, worker 52, admin-portal 40, seller-portal 32, ui 28, api-client 26, storefront 15, config 8, database 7, auth-ui 6                                                                                                           |
| API e2e (real PostgreSQL, Redis, S3-compatible storage)   | **244 passed** in 19 suites (30 new: checkout 18, storefront 11, admin search regression 1); all 214 Phase 1–3 tests still pass                                                                                                                                                             |
| Worker integration (real Redis, in-process SMTP)          | **9 passed**                                                                                                                                                                                                                                                                                |
| Playwright (desktop + Pixel 7)                            | **33 passed**, 1 skipped (a mobile-only test in the desktop project), 0 flaky. New: guest → two sellers → sign in → checkout with a coupon made in the Admin Console → one order, two packages → the seller sees only its suborder → staff see both; on desktop and phone; wholesale prices |
| Typecheck, lint, formatting, production builds            | Passed                                                                                                                                                                                                                                                                                      |
| Migration drift check (`prisma migrate diff --exit-code`) | No difference detected                                                                                                                                                                                                                                                                      |
| PowerShell scripts on pwsh + Docker Compose               | Passed                                                                                                                                                                                                                                                                                      |

Run locally as well (PostgreSQL 16, Redis, S3-compatible server, Chrome):

- unit tests: 432 passed in 11 packages (34 more than Phase 3): api 122, validation 96,
  worker 52, admin-portal 40, seller-portal 32, ui 28, api-client 26, storefront 15, config
  8, database 7, auth-ui 6;
- API e2e: 244 passed in 19 suites (30 new: checkout 18, storefront 11, plus one admin
  search regression test);
- Playwright: every test that does not need Mailpit passed on desktop and Pixel 7. The 5 that
  read emails from Mailpit cannot run here, because Mailpit is not installed in this
  environment. CI runs them.

What the concurrency tests prove, with real parallel requests against PostgreSQL:

- 12 buyers at once for 5 units: exactly 5 orders, no overselling;
- 8 buyers at once for a coupon with 3 uses: exactly 3 uses;
- parallel checkouts never pass a flash sale's unit cap;
- the same checkout submitted twice at the same moment: one order and one set of stock holds.

Fixed during verification:

- **Admin user search** (a Phase 2 bug that Phase 4 test data exposed): the digits in a
  search term were also matched against mobile numbers. Searching `ana.2024@…` could
  therefore list a customer whose mobile contains `2024`. Now only phone-like terms are
  matched against mobiles, and `0917…` is matched as `+63917…`. A regression test fails on the
  old code and passes on the new one.
- **Phone header:** "Create account" was only in the menu on phones. It is back in the header,
  as in Phase 2, and checked at 360 px.
- **Home page:** when banners lead, the page had no `<h1>`; it now has one for screen
  readers. The rotating banners are no longer announced on every change.
- **Account overview:** customers who have not confirmed their email now see a notice with a
  link to send a new confirmation link. The Phase 2 browser tests were updated to the Phase 4
  account layout.
- **Guest cart:** adding an item changed the line object React had already rendered; it now
  writes a copy.
- **Tests that relied on a fresh database:** the shopping browser test now creates its own
  coupon in the Admin Console, because the demo coupons allow 5 uses per customer. The catalog
  and inventory tests now search for their own records instead of expecting them on page 1.
  You can now run the suites repeatedly on your PC.
- ADR 0016 said money is `Decimal(12,2)`; it is `Decimal(19,4)` (corrected).

## 8. Remaining issues and limitations

- **No payments yet.** Online methods create orders waiting for payment that expire after the
  window; nothing is charged. The payment phase will confirm payments through signed webhooks.
- **No fulfilment yet.** Seller and admin order screens are read-only. Packing, shipping,
  tracking, delivery, returns and staff cancellation come with fulfilment. Until then:
  - reviews are allowed once an order is placed (later: once delivered);
  - the ship-from warehouse (default warehouse with a location) can differ from where stock
    was reserved.
- **Shipping rates are mock rates** (an editable table). Real couriers need an implementation
  of `ShippingProvider`; production refuses to start with the mock.
- **Commission is calculated and stored, not settled.** Payouts, statements and invoices or
  official receipts belong to the finance phase.
- **Search** is PostgreSQL-based: prefix and partial-word matching, no typo tolerance or
  synonyms. The provider interface is ready for OpenSearch.
- **Recommendations** use simple rules (categories of the customer's orders, wishlist and
  cart; top-rated otherwise), not a trained model.
- **Banner and product photos are re-encoded but not malware-scanned** (as noted in Phase 3).

## 9. Acceptance

| Requirement (brief §)                                                                                                     | Status                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| §1 Home page with branding, search, navigation, categories, banners, featured, best sellers, recommended, stores, flash   | Done; all content from the API                                                         |
| §2 Listing, detail, categories, store pages, variants, specifications, photos, ratings, stock, retail and wholesale price | Done                                                                                   |
| §3 Search filters and sorting; PostgreSQL behind an abstraction for OpenSearch                                            | Done (ADR 0018)                                                                        |
| §4 Dashboard, profile, addresses, orders, wishlist, reviews, security, retail/wholesale; wholesale needs approval         | Done                                                                                   |
| §5 Cart: add, remove, quantity, variant, save for later, persistence, multiple sellers, server revalidation               | Done                                                                                   |
| §6 One parent order, one suborder per seller with snapshots, prices, discounts, taxes, shipping, commission reference     | Done                                                                                   |
| §7 Checkout pricing service and quote endpoint; no client totals                                                          | Done (ADR 0019); client totals are only compared, never used                           |
| §8 Addresses with PSGC region, province, city, barangay, postal code, street; configurable data                           | Done (ADR 0020)                                                                        |
| §9 Shipping provider interface with origin, destination, weight, dimensions, method, fees; mock rates                     | Done (ADR 0021)                                                                        |
| §10 Pages, fully responsive                                                                                               | Done; checkout tested end to end on a phone viewport                                   |
| §11 Tests (see [TESTING_GUIDE.md](../testing/TESTING_GUIDE.md#phase-4-storefront-cart-and-checkout))                      | Done                                                                                   |
| §12 Multi-seller purchase, separate suborders, correct retail and wholesale prices, totals calculated on the backend      | Done; the complete shopping workflow was run locally in a browser on desktop and phone |

## 10. Dependencies for the next phase

The next phases can build on:

- `orders` / `seller_orders` with payment status, `paymentDueAt` and `cancelOrderInTx` (payment
  confirmation and refunds);
- reservations linked to order items, plus `ReservationsService.convert` for shipping stock out;
- `order_shipping_groups` and `ShippingProvider` for fulfilment and courier integration;
- commission stored per item and seller order for settlements;
- the `search` provider interface for OpenSearch.
