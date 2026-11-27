# Testing guide

## Test layers

| Layer                 | Tool                     | Location                                                         | Needs services             |
| --------------------- | ------------------------ | ---------------------------------------------------------------- | -------------------------- |
| Unit: shared packages | Vitest                   | `packages/*/src/**/*.test.ts(x)`, `prisma/src/*.spec.ts`         | No                         |
| Unit: frontends       | Vitest + Testing Library | `apps/{storefront,seller-portal,admin-portal}/src/**/*.test.tsx` | No                         |
| Unit: API             | Jest (SWC)               | `apps/api/src/**/*.spec.ts`                                      | No                         |
| Unit: worker          | Jest (SWC)               | `apps/worker/src/**/*.spec.ts`                                   | No                         |
| API end-to-end        | Jest + Supertest         | `apps/api/test/*.e2e-spec.ts`                                    | PostgreSQL, Redis, MinIO   |
| Worker integration    | Jest                     | `apps/worker/test/*.integration-spec.ts`                         | Redis (SMTP is in-process) |
| Browser end-to-end    | Playwright               | `e2e/*.spec.ts`                                                  | Everything                 |
| Migration drift       | `prisma migrate diff`    | `pnpm db:check`                                                  | PostgreSQL (shadow DB)     |

## Running tests (PowerShell)

```powershell
.\scripts\test.ps1                      # typecheck, lint, unit, integration and browser tests
.\scripts\test.ps1 -Suite unit          # fast; no Docker needed
.\scripts\test.ps1 -Suite integration   # starts services, migrates, seeds, runs API e2e + worker integration
.\scripts\test.ps1 -Suite ui            # builds API + worker, runs Playwright
```

Individual suites:

```powershell
pnpm test:unit                          # every unit suite in the monorepo
pnpm --filter @marketplace/ui test      # one package
pnpm test:e2e:api                       # API e2e (services must be running, DB migrated and seeded)
pnpm test:integration:worker            # worker integration
pnpm test:e2e:ui                        # Playwright
pnpm exec playwright test --ui          # Playwright interactive mode
pnpm exec playwright show-report        # last HTML report
```

Before the first Playwright run, download the browser once:

```powershell
pnpm exec playwright install chromium
```

Playwright starts the built API (`node dist/main.js`), the built worker and the three Vite dev
servers, or reuses ones already running locally. Build the API and worker first:
`pnpm --filter @marketplace/api --filter @marketplace/worker run build`. `test.ps1 -Suite ui` does
this for you.

## What the tests prove

### Phase 1

| Requirement                 | Proven by                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| All three frontends start   | Playwright `system-status.spec.ts` loads each app from its Vite dev server                                            |
| Backend starts              | Playwright starts `apps/api/dist/main.js`; API e2e boots the full AppModule                                           |
| PostgreSQL connection works | `health.e2e-spec.ts`, `database.e2e-spec.ts`                                                                          |
| Prisma commands work        | CI runs `db:generate`, `db:check` (drift), `db:deploy`, `db:seed`; the scripts job runs `reset-db.ps1`                |
| Redis connection works      | `health.e2e-spec.ts`, `rate-limit.e2e-spec.ts`                                                                        |
| Worker processes a test job | `worker.integration-spec.ts` (sample job, retries, backoff, dead-lettering, email) and Playwright `dev-tools.spec.ts` |
| MinIO accepts a test upload | `object-storage.e2e-spec.ts`, `dev-tools.e2e-spec.ts`, Playwright file test                                           |
| Swagger is accessible       | `http-pipeline.e2e-spec.ts` (`/api/docs-json`)                                                                        |
| Health endpoint works       | `health.e2e-spec.ts`, Playwright status pages                                                                         |
| Email reaches Mailpit       | Playwright `dev-tools.spec.ts` queries the Mailpit API                                                                |
| Docker services are healthy | CI "scripts" job: `setup.ps1` runs `docker compose up --wait` (all health checks)                                     |

### Phase 2 (identity, access, sellers and stores)

| Requirement                                          | Proven by                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer sign-up with SMS code, retail and wholesale | `auth.e2e-spec.ts` (API), `auth-flows.test.tsx` (storefront), Playwright `identity.spec.ts`                                                                    |
| Sign-in by mobile + SMS code or email + password     | `auth.e2e-spec.ts`, `auth-flows.test.tsx`, Playwright `identity.spec.ts`                                                                                       |
| Staff accounts only through admin invitation         | `administration.e2e-spec.ts`, Playwright invitation test                                                                                                       |
| Sessions: rotation, reuse detection, sign-out        | `auth.e2e-spec.ts` (sessions), `client.test.ts` (single-flight refresh)                                                                                        |
| CSRF, lock-out, rate limits, no enumeration          | `auth.e2e-spec.ts`, `guards.spec.ts`                                                                                                                           |
| Roles and configurable permissions                   | `administration.e2e-spec.ts` (immediate effect), `guards.spec.ts`, admin `routes.test.tsx`                                                                     |
| Wholesale approval                                   | `administration.e2e-spec.ts`, Playwright wholesale test                                                                                                        |
| Append-only audit log                                | `administration.e2e-spec.ts` (update/delete rejected by the database)                                                                                          |
| Emails and SMS are sent by the worker                | `worker.integration-spec.ts` (SMTP and mock SMS outbox), `notification-handlers.spec.ts`, `sms.spec.ts`                                                        |
| Seller registration (self sign-up)                   | `sellers.e2e-spec.ts` (registration), seller `seller-pages.test.tsx`, Playwright `sellers.spec.ts`                                                             |
| Email verification, password reset, token expiry     | `auth.e2e-spec.ts`, `mfa.e2e-spec.ts` (expired and forged access tokens)                                                                                       |
| Seller verification workflow                         | `sellers.e2e-spec.ts` (submit, request info, approve, reject, resubmit, suspend, reinstate, close), admin `marketplace.test.tsx`, Playwright `sellers.spec.ts` |
| Private seller documents                             | `sellers.e2e-spec.ts` (only the seller and staff; staff views audited; type checked by content)                                                                |
| Seller data isolation                                | `sellers.e2e-spec.ts`, `stores.e2e-spec.ts`, `seller-members.e2e-spec.ts` (404 for another seller's data), Playwright isolation test                           |
| Stores                                               | `stores.e2e-spec.ts` (verified only, unique slugs, limit, settings, images, public visibility, admin suspension)                                               |
| Seller staff invitations and permissions             | `seller-members.e2e-spec.ts` (invite, expire, resend, revoke, join, role limits, suspend, remove), seller `seller-pages.test.tsx`                              |
| Permission scopes                                    | `mfa.e2e-spec.ts` (permission catalog, scope validation), admin `marketplace.test.tsx` (roles page)                                                            |
| Two-step verification                                | `totp.spec.ts` (RFC 6238 vectors), `mfa.e2e-spec.ts` (sign-in, recovery codes, attempt limit, disable, admin reset), auth-ui `auth-ui.test.tsx`                |

### Phase 3 (catalog, pricing and inventory)

| Requirement                       | Proven by                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Seller isolation                  | `products.e2e-spec.ts` (another seller's product, variant, photo and pricing answer 404), `inventory.e2e-spec.ts` (warehouses, stock, movements)       |
| Categories and brands             | `catalog.e2e-spec.ts` (staff only, depth limit, inherited attributes, brand requests and review), admin `catalog-admin.test.tsx`                       |
| Product creation and approval     | `products.e2e-spec.ts` (create, submit readiness, approve/reject, content change back to review, take-down, archive), Playwright `catalog.spec.ts`     |
| Variant generation                | `products.e2e-spec.ts` (combinations, re-generation keeps existing variants, SKU unique per seller, limits)                                            |
| Wholesale and customer prices     | `price-engine.spec.ts` (20 rule cases), `pricing.e2e-spec.ts` (wholesale only for approved buyers, MOQ, effective dates, customer price, strict quote) |
| Inventory adjustments and history | `inventory.e2e-spec.ts` (every movement type, reasons, ledger cannot be edited, low-stock email once)                                                  |
| Concurrent stock updates          | `inventory.e2e-spec.ts` (25 parallel stock-outs of 10 against 100 units: exactly 10 succeed)                                                           |
| Warehouse transfers               | `inventory.e2e-spec.ts` (all-or-nothing, insufficient stock leaves both warehouses unchanged)                                                          |
| Image upload validation           | `products.e2e-spec.ts` (wrong extension, disguised content, too large, too small, limit of 10, replace, reorder, delete)                               |
| Reservations and expiry           | `inventory.e2e-spec.ts` (30 parallel reservations of 3 against 20 units: exactly 6 succeed; expiry, release, convert), worker `catalog-jobs.spec.ts`   |
| Seller and admin screens          | seller `catalog.test.tsx`, admin `catalog-admin.test.tsx`                                                                                              |

### Phase 4 (storefront, cart and checkout)

| Requirement                   | Proven by                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-seller cart             | `checkout.e2e-spec.ts` (cart grouped by seller; lines saved for later stay out of checkout; browser cart merge keeps the larger quantity), storefront `shopping.test.tsx` (guest cart priced by the server, grouped by store), Playwright `shopping.spec.ts` (browser cart joins the account cart at sign-in) |
| Price recalculation           | `checkout.e2e-spec.ts` (a price change between quote and order gives 409 `CHECKOUT_CHANGED`; extra fields such as a client total are refused), storefront test (re-quote and a new idempotency key after `CHECKOUT_CHANGED`)                                                                                  |
| Wholesale eligibility         | `checkout.e2e-spec.ts` (approved wholesale buyer gets tiers in cart and order; retail buyer pays retail), Playwright `shopping.spec.ts` (wholesale price ₱420 at 50 units)                                                                                                                                    |
| Coupons                       | `checkout.e2e-spec.ts` (marketplace and seller coupons, funding side, minimum spend, one per scope, per-customer limit, 8 parallel buyers on a 3-use coupon: exactly 3), seller and admin `CouponManager` tests                                                                                               |
| Checkout validation           | `checkout.e2e-spec.ts` (empty cart, missing address, more than in stock, sellers that cannot ship, products that stopped selling, missing idempotency key), `money.spec.ts` (rounding and allocation)                                                                                                         |
| Multi-seller order generation | `checkout.e2e-spec.ts` (one order, one suborder per seller with shipping group, snapshots, commission; totals add up), Playwright `shopping.spec.ts` (guest → two sellers → sign in → checkout → order with two packages; the seller sees only its suborder; staff see both)                                  |
| Inventory reservation         | `checkout.e2e-spec.ts` (COD holds without expiry linked to order items; online holds expire; cancellation and the unpaid-order sweep release them), worker `order-jobs.spec.ts`                                                                                                                               |
| Concurrent checkouts          | `checkout.e2e-spec.ts` (12 parallel buyers for 5 units: exactly 5 orders; flash-sale cap under parallel checkouts; the same checkout submitted twice at the same moment: one order, one set of holds)                                                                                                         |
| Customer data isolation       | `checkout.e2e-spec.ts` (another customer's orders, cancel, addresses and cart lines answer 404 or are refused; each seller sees only its own suborder, another seller's answers 404)                                                                                                                          |
| Search, home page, locations  | `storefront.e2e-spec.ts` (keyword prefixes, filters, facets, sorting, suggestions, home sections, PSGC steps), `price-engine.spec.ts` (flash-sale rules)                                                                                                                                                      |
| Seller and admin screens      | seller `sales.test.tsx` and `catalog.test.tsx` (warehouse location), admin `orders/sales-admin.test.tsx`                                                                                                                                                                                                      |
| Mobile layout                 | Playwright `shopping.spec.ts` runs the whole checkout on the mobile project (Pixel 7) as well as on desktop                                                                                                                                                                                                   |

### Phase 5 (orders, payments, shipping, returns and refunds)

| Requirement               | Proven by                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful payment        | `payments.e2e-spec.ts` (mock checkout → signed webhook → order paid, earnings posted once; the return redirect alone leaves it unpaid), storefront `orders.test.tsx`, Playwright `fulfilment.spec.ts`                     |
| Duplicate webhook         | `payments.e2e-spec.ts` (the same event three times concurrently and again later: one payment, one event row, ledger posted once)                                                                                          |
| Invalid signature         | `payments.e2e-spec.ts` (tampered and unsigned: 401, nothing stored), `payments.test.ts`, `fulfilment.spec.ts` (mock courier)                                                                                              |
| Failed payment            | `payments.e2e-spec.ts` (declined attempt, retry with a new attempt, "pay now" twice returns the same attempt)                                                                                                             |
| Payment timeout           | `payments.e2e-spec.ts` (expiry cancels; late money goes to the review queue and reconciliation, refunded once), worker `order-jobs.spec.ts` (providers asked before expiry)                                               |
| Bank transfer             | `payments.e2e-spec.ts` (proof, one at a time, no expiry while under review, rejection with more time, approval once), admin `finance.test.tsx`                                                                            |
| Refund and partial refund | `fulfilment.e2e-spec.ts` (automatic refund on a paid cancellation, ledger reversal, no second refund; partial goodwill refund; over-refund refused; return refund)                                                        |
| Multiple seller suborders | `fulfilment.e2e-spec.ts` (two sellers, isolation of orders and labels, read-only employee)                                                                                                                                |
| COD reconciliation        | `fulfilment.e2e-spec.ts` (collected ≠ received; remittance mismatch needs a note; duplicate reference refused; earnings on remittance), admin `finance.test.tsx`                                                          |
| Shipment status updates   | `fulfilment.e2e-spec.ts` (pickup converts stock; failed delivery and return to seller restock and close COD; out-of-order events ignored; manual jumps refused), `fulfilment.spec.ts` unit tests (state machines, labels) |
| Concurrent status updates | `fulfilment.e2e-spec.ts` (three simultaneous accepts: one wins; approve vs. decline a cancellation; two receipts of one return)                                                                                           |

### Phase 6 (commission, ledger, settlement, payouts, tax and accounting)

| Requirement                        | Proven by                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commission precedence              | `prisma/src/finance.spec.ts` (nearest category, product > seller+category > seller > category > default, exemption wins, effective dates), `finance.e2e-spec.ts` (each scope through the API preview; admins without `commission.exempt` refused)                                                                                                   |
| Commission calculations            | `finance.spec.ts` (percentage rounding, fixed per unit capped at the base), `finance.e2e-spec.ts` (6% seller+category rate on an order: ₱120 on ₱2,000; 10% category on a COD order)                                                                                                                                                                |
| Historical commission immutability | `finance.e2e-spec.ts` (a new rate leaves placed orders unchanged; the database refuses editing or deleting a rule and changing an order item's snapshot; rules cannot start in the past; conflicting scheduled rule 409)                                                                                                                            |
| Ledger balancing                   | `finance.e2e-spec.ts` (unbalanced journal refused by the code and, bypassing it, by the trigger; trial balance balanced; manual draft must balance), reconciliation check `BALANCED`                                                                                                                                                                |
| Double-entry integrity             | `finance.e2e-spec.ts` (posted journals and lines cannot be updated or deleted; reversal posts the opposite once; a second reversal 409; sellers cannot reach the ledger)                                                                                                                                                                            |
| Duplicate transaction prevention   | `finance.e2e-spec.ts` (three concurrent postings with one idempotency key: one journal; payout request retried with the same key: one payout; settling twice: nothing new), `payments.e2e-spec.ts` (receipt and sale once despite duplicate webhooks)                                                                                               |
| Refund reversals                   | `finance.e2e-spec.ts` (refund after settlement taken from the available balance; commission returned with VAT at the original rate; journal balances), `fulfilment.e2e-spec.ts` (refund and commission reversal lines on the seller order)                                                                                                          |
| Seller settlement                  | `finance.e2e-spec.ts` (nothing settled inside the return window; settlement of a delivered order: net, ½% withholding, opening/closing balance, statement lines, service invoice with VAT split; other sellers 404; statements append-only), `finance.spec.ts` (weekly, biweekly and monthly periods in Philippine time), seller `finance.test.tsx` |
| Payout approval                    | `finance.e2e-spec.ts` (tax profile and bank account verification required, minimum and available limits, approve and record the bank reference, event log, balances), admin `accounting.test.tsx`, Playwright `finance.spec.ts` (seller adds an account, finance verifies it)                                                                       |
| Payout failure                     | `finance.e2e-spec.ts` (failed, rejected, cancelled and reversed payouts return the amount to available), `packages/payments/src/payouts.test.ts` (PayMongo transfer request; rejected vs uncertain errors)                                                                                                                                          |
| COD reconciliation                 | `finance.e2e-spec.ts` (collection posts a receivable, no earnings before remittance; remittance with a ₱15 shortage posts the COD fee/shortage; COD report), reconciliation check `COD`                                                                                                                                                             |
| Bank details never exposed         | `finance.e2e-spec.ts` (only the last four digits in responses and the audit log; stored encrypted)                                                                                                                                                                                                                                                  |
| Fee allocation                     | `finance.e2e-spec.ts` (configured MAYA fee: expense, seller recovery and output VAT), `finance.spec.ts` (largest-remainder allocation)                                                                                                                                                                                                              |
| Taxes                              | `checkout.e2e-spec.ts` (VAT only for the VAT-registered seller's goods), `finance.e2e-spec.ts` (tax rules versioned per jurisdiction; services rules must be inclusive; seller sales invoice reference)                                                                                                                                             |
| Reconciliation                     | `finance.e2e-spec.ts` (every check passes after the whole suite)                                                                                                                                                                                                                                                                                    |

directly in the database and give each test client its
own address (`X-Forwarded-For` with `TRUST_PROXY=1`), so per-address limits never leak between
tests. They read SMS codes and email links from the queued jobs; Playwright reads them from the
SMS outbox and Mailpit, like a developer would. Playwright signs in to the staff apps once
(`e2e/auth.setup.ts`, using the seeded demo accounts) and reuses the saved cookies.

### Phase 7 (promotions, loyalty, referrals, affiliates, reviews, support, notifications, analytics)

| Requirement                    | Proven by                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coupon eligibility             | `engagement.e2e-spec.ts` (product-restricted coupon discounts only covered items; minimum spend counts covered items; category coupons; first-order coupons refused after a first order)                                                                                                                                                                                                                                   |
| Promotion conflicts            | `promotion-engine.spec.ts` (best of flash or campaign, ties, priority, bundles that lose their minimum, other stores' units, caps, free shipping minimum), `engagement.e2e-spec.ts` (B1T1, bundle minimum, flash sale kept or replaced without taking flash stock, free shipping from a campaign rejects a free-shipping coupon, seller coupon on top of a campaign, totals add up, seller cannot target others' products) |
| Loyalty earning and redemption | `prisma/src/engagement.spec.ts` (points per ₱100, redeem cap, month arithmetic), `engagement.e2e-spec.ts` (20% cap, redemption posted against 2410 in the sale journal, 8 points earned on completion with a journal, refund gives back spent points and takes back earned points proportionally, FIFO expiry, cancellation gives every point back without a journal, no negative balances)                                |
| Referral attribution           | `engagement.e2e-spec.ts` (unknown code 422; sign-up with a code; both rewarded once on the first completed order)                                                                                                                                                                                                                                                                                                          |
| Affiliate commissions          | `engagement.e2e-spec.ts` (pending accounts and own orders not attributed; click; frozen conversion; accrual journal 5060/2420; minimum payout; payout journal; nothing left to pay)                                                                                                                                                                                                                                        |
| Review eligibility             | `engagement.e2e-spec.ts` (one review per item 409; rating the seller only after delivery; photos served only while published; seller replies to own products only; one report per customer, none on one's own; upheld reports hide the review)                                                                                                                                                                             |
| Support access                 | `engagement.e2e-spec.ts` (order ticket to the seller; other seller and customers 404; internal notes hidden; take-over routes replies to support; closed tickets refuse replies; general inquiries never reach sellers), Playwright `engagement.spec.ts`                                                                                                                                                                   |
| Notification processing        | `worker.integration-spec.ts` (an outbox event delivered by the worker: inbox row, email over SMTP, mock SMS, mock push, masked delivery log; opted-out channel skipped; never delivered twice), `notifications.spec.ts`, `engagement.e2e-spec.ts` (events written with the order), Playwright `engagement.spec.ts` (welcome notification in the inbox and in Mailpit)                                                      |
| Report calculations            | `engagement.e2e-spec.ts` (GMV equals the database sum for a seller, admin and seller views; sellers refused staff reports), `analytics.spec.ts` (Philippine dates, week/month/year buckets without gaps)                                                                                                                                                                                                                   |
| Export generation              | `analytics.spec.ts` (CSV quoting and formula neutralising, real XLSX and PDF files), `engagement.e2e-spec.ts` (CSV, XLSX and PDF downloads), Playwright (CSV download), admin `engagement.test.tsx`                                                                                                                                                                                                                        |

Locally without Mailpit, run the browser tests with `E2E_NO_MAILPIT=1` to skip only the email
check (CI always runs it).

### Phase 8 (quality assurance, security and production)

| Requirement                         | Proven by                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer, seller and admin journeys | Playwright `journeys.spec.ts`: register → browse → cart → checkout → pay → track → review; register → verify → store → product → order → ship → settlement; sign in → approve seller → approve product → monitor order → resolve dispute → approve payout                                                      |
| Data integrity                      | `integrity.e2e-spec.ts` (duplicate/concurrent webhooks, concurrent refunds, multi-seller refund cap, COD remittance once, checkout rollback, seller isolation matrix, whole-database reconciliation); earlier suites for duplicate orders, oversell and reservation expiry (see FINAL_TECHNICAL_REPORT.md §10) |
| Route protection                    | `route-access.e2e-spec.ts` (inventory of every route)                                                                                                                                                                                                                                                          |
| Worker crash recovery               | `worker.integration-spec.ts` (orphaned outbox event; killed job re-run once; backlog drained in one run)                                                                                                                                                                                                       |
| Production configuration            | `app-config.spec.ts`, `worker-config.spec.ts` (development secrets, test keys, mocks, http URLs refused)                                                                                                                                                                                                       |
| Production stack                    | CI job "Production images…": `docker/production/ci/smoke.sh` (TLS, headers, redirects, health, Swagger/dev tools/metrics hidden, forged webhook refused, cookies, CSRF, every Prometheus target, Grafana, Alertmanager, Loki)                                                                                  |
| Backups restorable                  | `docker/production/ci/backup-restore.sh` (encrypted backup, write after backup, volume destroyed, restore, every table and a checksum identical, app healthy)                                                                                                                                                  |
| Load and integrity under load       | CI job "Load test": `load/run.sh` with k6; thresholds p95 < 2 s and < 1% errors per scenario; `load/verify.sql` (see LOAD_TEST_REPORT.md)                                                                                                                                                                      |

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Quality:** install, typecheck, lint, Prettier check, all unit tests, production builds.
2. **Integration:** PostgreSQL, Redis, Mailpit and MinIO containers; migration drift check,
   migrate, seed, API e2e, worker integration, Playwright (HTML report uploaded on failure).
3. **Scripts:** the PowerShell scripts (`setup`, `test -Suite integration`, `backup`, `restore`,
   `reset`, `start -InfraOnly`, `stop -RemoveData`) run with PowerShell 7 against the real
   `docker/docker-compose.yml`.
4. **Production stack:** builds the five production images, starts `docker/production` with
   `NODE_ENV=production`, runs the smoke test and the backup → destroy → restore test.
5. **Load test:** the same images with the load-test overrides, k6, integrity checks and a
   database analysis.

A phase is complete only when all jobs are green.

## Writing tests

- **Validate contracts with the shared schemas.** E2E tests parse responses with the schemas
  from `@marketplace/validation` (`healthResponseSchema.parse(res.body)`), so a contract change
  fails loudly.
- **API unit tests** construct services directly with fakes for Prisma, Redis or storage. **E2E
  tests** use `createTestApp()` (`apps/api/test/test-app.ts`), which applies the production HTTP
  pipeline from `bootstrap.ts`.
- **Isolate data:** use unique ids or prefixes (`randomUUID()`, `Date.now()`) and clean up what you
  create, so suites can run in parallel and re-run against the same database.
- **Frontend tests** render routes with `createMemoryRouter` and pass a fake `fetch` to
  `createApiClient`; they never call a real server.
- **Playwright** selects by role, label and visible text (as users do). Use `data-testid` only
  for status read-outs.
- Never mark a test as passing without running it. A phase report lists only results from real
  runs.
