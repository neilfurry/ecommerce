# Phase 3 report: Product catalog, pricing and inventory management

- Branch: `phase-3-catalog` (PR #3, based on `phase-2-identity`)
- Date: 2026-11-27
- Verified on: GitHub Actions run `45566418730`, commit `2cf1be5` (all three jobs green)
- Status: **Complete, awaiting review and approval.** Phase 4 has not been started and will not
  start until you send the Phase 4 details.

Decisions applied (from the Phase 3 kick-off):

1. **Content changes need approval again; commercial changes do not.** Editing the name,
   description, category, brand, specifications, attributes, options or photos of an approved
   product sends it back to `PENDING_APPROVAL` (hidden until approved). Prices, sale dates, stock,
   SKUs and barcodes apply immediately.
2. **Brands are created by marketplace staff; sellers request missing ones.** A seller can use
   a requested brand on its own products straight away, but the product cannot be approved until
   the brand is.
3. **Wholesale prices are for approved wholesale customers only.** Everyone else pays retail.
   Sellers can also set a price for a named customer (by email), which wins over every other
   price.

## 1. Implemented features

### Seller Center (Catalog section)

- **Products**: list with photo, price range, stock, status and filters (status, category,
  search); **Add product** (store, name, category, brand, description, SKU, price).
- **Product page** with tabs and a checklist of what is still missing before submission:
  - **Details**: name, link, category (three-level picker), brand (with "Request a brand"),
    description, category attributes (text, number, yes/no, choice; required ones marked),
    specifications, search-engine title, description and keywords.
  - **Variants**: up to three options (e.g. Size, Color, Material); one variant per
    combination, generated with a SKU prefix and starting price; per variant SKU, barcode,
    regular and sale price with dates, weight, dimensions, stock tracking and status.
  - **Photos**: upload up to 10, move earlier or later, replace, delete, alt text; the first
    is the main photo. (Linking a photo to a variant is available in the API; the screen does
    not offer it yet.)
  - **Pricing**: currency, minimum and maximum order quantity, wholesale on/off and wholesale
    minimum, wholesale tiers (product-wide or per variant, with effective dates), prices for
    named customers, and a **price preview** (retail or wholesale buyer, any quantity).
  - Actions: submit for approval, hide/show, archive, restore; history of every decision.
- **Inventory**: dashboard (variants, units on hand, reserved, available, low-stock count),
  stock per variant and warehouse, low-stock filter and per-row threshold.
- **Warehouses**: add and edit (address, contact), make default, deactivate.
- **Stock adjustments**: stock in, stock out, adjustment (+/−), damaged, damaged write-off,
  restocked return, damaged return, and **transfers** between warehouses.
- **Movement history**: the ledger with type, quantity, balances after, who and why; filters.
- Every action is shown only to employees whose permissions allow it.

### Admin Console (Catalog section)

- **Product approval** (`catalog/products`): queue of products waiting for approval (oldest
  first) and every seller's products by status, seller and search.
- **Product review page**: details, attributes, photos, variants and prices, seller, history;
  **Approve**, **Reject** (with a note the seller receives by email), **Take down** (with a
  reason).
- **Categories**: tree with sort order and status; add, edit, delete empty ones; image;
  category attributes editor.
- **Brands**: all brands and seller requests; add, edit, retire, approve or reject requests.
- **Inventory overview**: stock totals per seller across the marketplace.
- Seller detail gains **View products**.

### API, worker and data

- Categories, brands, products, variants, photos, pricing, public catalog and inventory
  modules (62 endpoints, §4).
- **Pricing engine**: one pure function decides every price; quotes return a snapshot (source,
  rule, tiers, unit price, line total) for orders to store. Prices sent by clients are refused.
- **Inventory ledger**: every stock change is one guarded SQL update plus an append-only
  ledger row in one transaction; available stock can never go negative (also enforced by
  database CHECK constraints).
- **Reservations** with expiry for checkout (all items or none, default warehouse first),
  released by a worker sweep every minute, converted to a `SALE` deduction at fulfilment.
- **Product photos** are validated and re-encoded to WebP (1600 px + 400 px thumbnail, metadata
  removed) before storage.
- Emails: product approved / rejected / taken down; low stock (once per threshold crossing).
- New permissions with defaults for existing roles (§5).
- Development seed: categories (Groceries › Rice & Grains with attributes, Electronics ›
  Mobile Phones, Fashion …), three brands, two warehouses for the demo seller and an active
  demo product "Sinandomeng Rice 25 kg" with tiers ₱500 / 450 / 420 / 390 and 120 units.

Architecture decisions: [ADR 0015](../architecture/adr/0015-catalog-approval-and-product-images.md)
(catalog, approval, photos), [ADR 0016](../architecture/adr/0016-server-side-pricing-engine.md)
(pricing), [ADR 0017](../architecture/adr/0017-inventory-ledger-and-reservations.md) (ledger,
concurrency, reservations).

## 2. Created and modified files

115 files changed compared with `phase-2-identity` (75 added, 40 modified), including this report. Main locations:

| Area      | Files                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts | `packages/shared-types/src/{catalog,auth,api}.ts`, `packages/validation/src/{catalog,inventory,notifications}.ts`, `packages/config` (queues, job names, sweep interval)                                                                  |
| Database  | `prisma/schema.prisma`, migration `20261127090000_catalog_pricing_inventory/`, `prisma/src/reservations.ts`, `prisma/src/seed-catalog.ts`                                                                                                 |
| API       | `apps/api/src/modules/{catalog,products,pricing,inventory}/`, `modules/files/{image-processor,upload-limits}.ts`, notifications service                                                                                                   |
| Worker    | `apps/worker/src/database/`, `jobs/reservation-sweep.ts`, product-decision and low-stock email handlers and templates, `DATABASE_URL` configuration                                                                                       |
| Client    | `packages/api-client/src/{catalog,catalog-react}.ts(x)`; `packages/ui/src/lib/money.ts`                                                                                                                                                   |
| Frontends | Seller Center `pages/products/*`, `pages/inventory/*`, `components/catalog/*`; Admin Console `pages/catalog/*`, `pages/inventory/*`, `components/product-status.tsx`; navigation and routes                                               |
| Tests     | API `catalog`, `products`, `pricing`, `inventory` e2e suites and `price-engine.spec.ts`; worker `catalog-jobs.spec.ts`; frontend `catalog.test.tsx`, `catalog-admin.test.tsx`; Playwright `catalog.spec.ts`; validation `catalog.test.ts` |
| Docs      | ADR 0015–0017, API reference, architecture, local database, testing guide, Windows setup, roadmap, this report                                                                                                                            |
| CI        | The migration drift check prints the SQL difference when it fails                                                                                                                                                                         |

## 3. Database changes

Migration `20261127090000_catalog_pricing_inventory` (hand-written; the CI drift check confirms
it matches the schema):

- Enums for category, brand, product, variant, warehouse and reservation status, attribute
  types, product event types, inventory movement types; new `file_purpose` values
  `PRODUCT_IMAGE`, `PRODUCT_IMAGE_THUMBNAIL`, `CATEGORY_IMAGE`.
- Tables: `categories`, `category_attributes`, `brands`, `products`, `product_events`,
  `product_options`, `product_option_values`, `product_variants`, `variant_option_values`,
  `product_images`, `price_tiers`, `customer_prices`, `warehouses`, `stock_levels`,
  `inventory_movements`, `stock_transfers`, `stock_transfer_items`, `stock_reservations`.
- Unique keys: category and product links; SKU per seller; one variant per option combination;
  one stock row per variant and warehouse; warehouse code per seller; **one default warehouse
  per seller** (partial unique index).
- CHECK constraints: link formats, category depth 0–2, prices above zero, sale price below the
  regular price, valid date windows, order quantities, all stock quantities non-negative and
  **on hand ≥ reserved**, reservation state consistency.
- Trigger `inventory_movements_prevent_mutation`: the ledger cannot be updated or deleted.
- Indexes for the approval queue, seller listings, stock lookups, the ledger by variant and
  date, and due reservations.

## 4. API endpoints

Listed with request and response shapes in [API_REFERENCE.md](../api/API_REFERENCE.md), and in
Swagger at http://localhost:3000/api/docs. All lists are paginated and filterable.

| Group                                                                                                       | Endpoints |
| ----------------------------------------------------------------------------------------------------------- | --------- |
| `/api/v1/categories/*`                                                                                      | 11        |
| `/api/v1/brands/*`                                                                                          | 5         |
| `/api/v1/products/*` (products, variants, photos, approval)                                                 | 20        |
| `/api/v1/products/{id}/pricing`, `price-tiers`, `customer-prices`, `price-preview`; `/api/v1/pricing/quote` | 7         |
| `/api/v1/catalog/products/*` (public)                                                                       | 2         |
| `/api/v1/inventory/*`                                                                                       | 13        |
| `/api/v1/dev/inventory/reservations/*` (development only)                                                   | 4         |

New error codes: `INSUFFICIENT_STOCK` (409), `SELLER_NOT_VERIFIED` (403), `NOT_READY` (422),
`RESERVATION_NOT_ACTIVE` (409).

## 5. Permissions and environment

| Permission                                                                      | Default roles                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `catalog.categories.manage`, `catalog.brands.manage`, `catalog.products.review` | Admin                                                                         |
| `catalog.products.read`                                                         | Admin, Finance admin, Customer support                                        |
| `inventory.read`                                                                | Admin, Finance admin, Warehouse staff                                         |
| `seller.products.manage`                                                        | Seller manager, Seller encoder (and owners, who hold every seller permission) |
| `seller.pricing.manage`                                                         | Seller manager                                                                |
| `seller.inventory.manage`                                                       | Seller manager, Seller inventory                                              |

Super admins keep every permission; `db:seed` grants the new defaults to existing roles.

Environment: the worker now reads `DATABASE_URL` (the same value as the API; already in `.env`;
required in production). No other new variables.

## 6. Starting the project (Windows PowerShell)

Unchanged from Phase 2. After pulling:

```powershell
pnpm install
.\scripts\setup.ps1          # builds packages, applies the new migration, seeds demo data
.\scripts\dev.ps1            # API, worker and the three apps
```

Then follow step 7 of [WINDOWS_SETUP.md](../development/WINDOWS_SETUP.md#4-verify-the-installation)
to walk through a product from creation to approval and stock.

## 7. Test results

All results below come from real runs; nothing was counted from a run that did not happen.

GitHub Actions run `45566418730`, commit `2cf1be5` (all three jobs green):

| Suite                                                     | Result                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (11 packages)                                  | **398 passed** (61 more than Phase 2): api 113, validation 96, worker 46, admin-portal 33, ui 28, api-client 26, seller-portal 25, storefront 10, config 8, database 7, auth-ui 6                                                                          |
| API e2e (real PostgreSQL, Redis, S3-compatible storage)   | **214 passed** in 17 suites (80 new: products 33, pricing 20, inventory 18, categories and brands 9); the 134 Phase 1–2 tests all still pass                                                                                                               |
| Worker integration (real Redis, in-process SMTP)          | **9 passed**                                                                                                                                                                                                                                               |
| Playwright (desktop + Pixel 7)                            | **29 passed**, 1 skipped (a mobile-only test in the desktop project), 0 flaky. New: seller creates a product → photo → submit → admin approves → public price ₱420.00 → stock in 40 → history; inventory dashboard and admin overview on desktop and phone |
| Typecheck, lint, formatting, production builds            | Passed                                                                                                                                                                                                                                                     |
| Migration drift check (`prisma migrate diff --exit-code`) | No difference detected                                                                                                                                                                                                                                     |
| PowerShell scripts on pwsh + Docker Compose               | Passed                                                                                                                                                                                                                                                     |

The concurrency tests use real parallel requests against PostgreSQL: 25 simultaneous stock-outs
of 10 units against 100 on hand succeed exactly 10 times, and 30 simultaneous reservations of 3
against 20 available succeed exactly 6 times; stock never goes negative. The API, unit and
catalog browser suites were also run locally (PostgreSQL 16, Redis, S3-compatible server,
Chrome).

Fixed during verification:

- **A real bug found by the new browser test:** in the Seller Center, a product in a category
  with an optional choice attribute (e.g. "Variety" left empty) could not be saved: the form
  treated the empty choice as invalid and showed the error only beside that field. The details
  form now drops empty optional attributes; regression tests were added in the validation
  package and the Seller Center (the new test failed before the fix and passes after).
- The browser test used `__dirname`, which is not available in the ES-module test runner, and
  one text selector matched four elements; both corrected.
- In run `45564606492` the Phase 2 mobile sign-up test passed only on retry (confirming the
  email, then the account page briefly showing it unconfirmed). It passed in the final run and
  in every earlier run; I could not download that run's trace here, so I am noting it rather
  than guessing at a cause. CI fails on flaky tests, so a recurrence will be caught.
- Earlier, during development: permission expectations in the Phase 2 seller-staff test were
  updated because the new default permissions intentionally extend seller roles; a blank
  category link in the admin form now means "generate it".

## 8. Remaining issues and limitations

- **No storefront product pages yet.** Shoppers' catalog data is available through the public
  API (`/catalog/products`) with prices for who they are; the storefront pages come with the
  cart and checkout phase.
- **Reservations have no checkout yet.** The reservation service is complete and tested; until
  checkout exists it is reachable through development-only endpoints. Orders will store the
  pricing snapshot returned by the quote.
- **Search** is a name filter only; full-text and faceted search are not built (roadmap row 4
  mentioned search; I suggest it with the storefront catalog).
- **Photos are not malware-scanned.** They are re-encoded, so stored files contain no embedded
  payloads, but a scanning step is recommended before production (as for seller documents).
- **Photos are processed during the upload request** (well under a second for 5 MB). The
  `image-processing` queue is available if heavier processing is needed later.
- **Currency** is stored per product but only `PHP` exists.

## 9. Acceptance

| Requirement (brief §)                                                                                                                         | Status                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| §1 Products: name, link, seller, category, brand, description, specifications, photos, statuses, approval status, SEO                         | Done                                                                                   |
| §2 Variants: options (size, color, model, material, …), SKU unique per seller, barcode, prices, stock tracking, weight, dimensions, status    | Done                                                                                   |
| §3 Pricing: retail, wholesale tiers, MOQ, wholesale eligibility, customer prices, effective dates, currency; backend-calculated with snapshot | Done                                                                                   |
| §4 Categories: tree, images, descriptions, status, sort order, category attributes; staff only                                                | Done                                                                                   |
| §5 Photos: several per product, order, delete, replace, optimised, thumbnails, private storage, type/extension/size checks                    | Done                                                                                   |
| §6 Warehouses, stock levels, all movement types, history, low-stock notices, ledger with on hand / reserved / available                       | Done                                                                                   |
| §7 Reservations: order-item link, expiry, no overselling, release on expiry, conversion at fulfilment, concurrency-safe                       | Done (used by checkout in Phase 4)                                                     |
| §8 Seller pages                                                                                                                               | Done                                                                                   |
| §9 Admin pages                                                                                                                                | Done                                                                                   |
| §10 Documented endpoints with pagination and filtering                                                                                        | Done                                                                                   |
| §11 Tests (see the mapping in [TESTING_GUIDE.md](../testing/TESTING_GUIDE.md#phase-3-catalog-pricing-and-inventory))                          | Done                                                                                   |
| §12 Phase 1 and Phase 2 tests still pass                                                                                                      | Done: all 134 Phase 1–2 API tests and all Phase 1–2 browser tests pass in the same run |

## 10. Dependencies for the next phase

Checkout can build on:

- `PricingService.quote()` for cart and checkout prices, storing each line's snapshot on the
  order item;
- `ReservationsService.reserve / attachOrderItem / release / convert` for stock holds;
- the public catalog API for storefront product pages;
- wholesale eligibility from the approved wholesale application and customer prices.

I will wait for your review and the Phase 4 details before starting anything else.
