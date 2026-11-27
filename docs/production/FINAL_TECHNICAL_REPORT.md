# Final technical report

The multi-vendor marketplace for the Philippines after Phases 1–8.

**Verdict:** the software passed every check that can run without production credentials or
a production server. That includes CI run **{{RUN}}** (commit `{{SHA}}`): every test suite,
the production stack under `NODE_ENV=production`, a backup → destroy → restore test, and a
load test whose integrity checks all passed. The marketplace is **not yet production-ready
as a business service**. What remains needs the owner's accounts, a server, legal approval
and merchant onboarding (§15). Production readiness should be declared only when every box in
[GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) is ticked.

## 1. Completed modules

| Phase | Modules                                                                                                                                                                                                                                                       | Report                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1     | Monorepo, API and worker skeletons, three frontends, PostgreSQL/Redis/S3, queues with dead-lettering, health, Windows PowerShell scripts, CI                                                                                                                  | [phase-1](../phases/phase-1-foundation.md)              |
| 2     | Customer, seller and staff accounts; sessions with rotation; email/SMS verification; two-step verification; roles and permissions; seller registration, verification, members and stores; audit log                                                           | [phase-2](../phases/phase-2-identity.md)                |
| 3     | Categories with attributes, brands, products with variants and images, approval workflow, pricing (sale prices, wholesale tiers), warehouses, stock movements and reservations                                                                                | [phase-3](../phases/phase-3-catalog.md)                 |
| 4     | Storefront (home, categories, search with facets, product pages, store pages), cart, wishlist, addresses (PSGC), shipping quotes, multi-seller checkout, first coupons and flash sales                                                                        | [phase-4](../phases/phase-4-storefront.md)              |
| 5     | Order state machine, payments (PayMongo, bank transfer, COD), webhooks, shipments and tracking, cancellations, returns, refunds, COD remittance, reconciliation                                                                                               | [phase-5](../phases/phase-5-orders.md)                  |
| 6     | Commission engine, double-entry ledger, seller balances and settlement, payouts, VAT/withholding, invoices and credit notes, finance reports                                                                                                                  | [phase-6](../phases/phase-6-finance.md)                 |
| 7     | Coupons and campaigns (stacking engine), loyalty points ledger, referrals and affiliates, reviews and seller ratings, notification outbox (in-app, email, SMS, push), support tickets, analytics, dashboards and exports                                      | [phase-7](../phases/phase-7-engagement.md)              |
| 8     | System audit and fixes, role journeys, integrity tests, load testing, production images and Compose, HTTPS edge and load balancing, monitoring and alerting, encrypted backups with restore testing, release pipeline with rollback, production documentation | [phase-8](../phases/phase-8-production.md), this report |

## 2. System architecture

Details: [SYSTEM_ARCHITECTURE.md](../architecture/SYSTEM_ARCHITECTURE.md),
[DEPLOYMENT_GUIDE.md §1](DEPLOYMENT_GUIDE.md#1-architecture) and 39 ADRs in
[architecture/adr](../architecture/adr/).

- **Frontends:** three React SPAs (Vite). The Storefront serves customers, the Seller Center
  serves sellers and the Admin Console serves staff. In production they are static files
  served by the Caddy edge.
- **API:** a NestJS 12 modular monolith with 31 domain modules and 439 routes. It is
  stateless, and two replicas sit behind the edge's least-connections load balancer.
- **Worker:** NestJS + BullMQ with seven work queues plus a dead-letter queue. It handles email, SMS, notifications, image
  processing, payment events, order processing (expiries, settlement, loyalty) and reports.
  Retries back off exponentially; jobs that fail permanently are dead-lettered.
- **Data:** PostgreSQL 17 (with pgBackRest), Redis 7 (queues, rate limits, caches) and
  S3-compatible object storage (signed URLs).
- **Edge:** Caddy terminates TLS with automatic Let's Encrypt certificates, adds security
  headers and redirects HTTP to HTTPS. It routes `/api` to the API replicas and can sit behind
  a CDN.
- **Observability:** Prometheus, Alertmanager, Grafana, Loki + Alloy, exporters, and
  Sentry-compatible error tracking.

## 3. Database schema overview

There are 113 tables (Prisma models), 78 enums and 10 hand-written, reviewed migrations. CI
checks the migrations against the schema with `prisma migrate diff` and applies them from
zero to a fresh database in every run. Conventions are in
[DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md):

- UUIDv7 keys;
- `timestamptz`;
- money as `numeric(19,4)` with a currency;
- soft rules enforced by `CHECK` constraints and triggers.

| Area       | Main tables                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity   | `users`, `sessions`, `roles`, `permissions`, `user_roles`, `mfa_*`, `audit_logs`                                                                              |
| Sellers    | `sellers`, `seller_members`, `seller_documents`, `stores`                                                                                                     |
| Catalog    | `categories`, `category_attributes`, `brands`, `products`, `product_variants`, `product_images`, `wholesale_tiers`                                            |
| Inventory  | `warehouses`, `stock_levels` (`reserved ≤ on hand` enforced), `stock_movements`, `stock_reservations`                                                         |
| Shopping   | `carts`, `cart_items`, `wishlists`, `customer_addresses`, `ph_locations` (PSGC)                                                                               |
| Orders     | `orders`, `seller_orders`, `order_items`, `order_events`, `shipments`, `shipment_events`, `returns`, `refunds`                                                |
| Payments   | `payments`, `payment_events`, `webhook_events`, `bank_transfer_proofs`, `cod_collections`, `cod_remittances`                                                  |
| Finance    | `ledger_accounts`, `ledger_transactions`, `journal_entries` (append-only, balanced per transaction), `commission_rules`, `settlements`, `payouts`, `invoices` |
| Marketing  | `coupons`, `campaigns`, `flash_sales`, `loyalty_*` (ledger), `referrals`, `affiliate_*`                                                                       |
| Engagement | `reviews`, `seller_ratings`, `notification_events` (outbox), `notification_deliveries`, `notifications`, `notification_templates`, `support_tickets`          |

## 4. API documentation

- Reference: [docs/api/API_REFERENCE.md](../api/API_REFERENCE.md). It covers conventions,
  errors and every endpoint by phase.
- OpenAPI/Swagger UI at `/api/docs` in development. Production disables it, and the smoke
  test checks that.
- Every route's protection (public, signed in, permission) is listed and enforced by
  `apps/api/test/route-access.e2e-spec.ts`.

## 5. Frontend applications

| App           | Production URL (example)     | Local URL               | Build-time configuration                                     |
| ------------- | ---------------------------- | ----------------------- | ------------------------------------------------------------ |
| Storefront    | `https://shop.example.ph`    | `http://localhost:5173` | `VITE_API_BASE_URL=/api`, optional `VITE_SENTRY_DSN`         |
| Seller Center | `https://seller.example.ph`  | `http://localhost:5174` | same                                                         |
| Admin Console | `https://admin.example.ph`   | `http://localhost:5175` | same                                                         |
| API           | `https://api.example.ph`     | `http://localhost:3000` | webhooks and health (the apps call `/api` on their own host) |
| Grafana       | `https://grafana.example.ph` | –                       | monitoring                                                   |

The domains come from `STOREFRONT_DOMAIN`, `SELLER_DOMAIN`, `ADMIN_DOMAIN`, `API_DOMAIN` and
`GRAFANA_DOMAIN` ([DEPLOYMENT_GUIDE.md §2.2](DEPLOYMENT_GUIDE.md#22-domains-and-dns)).

## 6. Backend configuration

Every variable, with its default, which service reads it and the production rules, is listed
in [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md). The template is
`docker/production/.env.production.example`.

In production the API and the worker **refuse to start** in any of these cases:

- development secrets are present (copied from `.env.example`);
- PayMongo test keys are set (unless `ALLOW_TEST_PAYMENTS=true` on staging);
- mock shipping or mock payments are configured;
- `http://` public URLs, insecure cookies or developer tools are configured;
- staff two-step verification is optional;
- Mailpit or localhost SMTP is configured.

## 7. Payment integrations

| Method                    | Integration                                                                                                                                                                           | Status                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cards, GCash, Maya, QR Ph | PayMongo Checkout Sessions. Webhooks are signature-checked, have a replay window and are idempotent (duplicates and concurrent retries are applied once). Refunds go through the API. | Built and tested with signed events. **Live mode never exercised:** needs an activated PayMongo account. |
| Bank transfer             | The customer uploads proof and finance verifies it                                                                                                                                    | Complete                                                                                                 |
| Cash on delivery          | COD limits, collection per parcel and remittance reconciliation                                                                                                                       | Complete                                                                                                 |
| Seller payouts            | Manual (recorded with reference) or PayMongo wallet transfer                                                                                                                          | Manual complete; the PayMongo payout path needs a wallet account                                         |
| Maya Business, Xendit     | Prepared adapters that refuse to run                                                                                                                                                  | Need merchant onboarding                                                                                 |

## 8. Shipping integrations

- **Production:** an admin-managed **rate table** (by island group and weight). Sellers arrange
  their own courier and enter tracking numbers, the customer sees each tracking update, and
  sellers can print waybill PDFs.
- **Development:** a mock courier with labels and tracking events.
- **Not integrated:** courier APIs (LBC, J&T, Ninja Van, Flash, GoGo Xpress). Each needs a
  merchant account and API credentials ([AUDIT_REPORT.md](AUDIT_REPORT.md) L1).

## 9. Security measures

Summary of [SECURITY_GUIDE.md](SECURITY_GUIDE.md), mapped to OWASP ASVS and OWASP Top 10:

- **Passwords and sign-in:** Argon2id hashing, account lockout and per-address sign-in limits.
- **Sessions:** HttpOnly/Secure/SameSite cookies, and rotating refresh sessions with reuse
  detection.
- **CSRF:** double-submit token.
- **Staff:** two-step verification is required in production.
- **Authorization:** permission-based authorization with a route inventory test; the seller
  scope always comes from the membership (a cross-seller matrix test checks this).
- **Input:** validated by Zod.
- **Uploads:** checked by magic bytes, pixel-limited and re-encoded; files are stored
  privately and reached through signed URLs.
- **Database access:** SQL is built only with tagged templates.
- **Webhooks:** signature checks with replay windows and alerts on rejections.
- **Sensitive data:** secrets live only in the environment, and access logs and error reports
  are redacted. No card data ever reaches the system: PayMongo hosts the payment page. Bank
  details are encrypted at rest.
- **Audit and dependencies:** an append-only audit log, a clean `pnpm audit --prod`, and
  images with SBOM and provenance.

Every finding, with its fix, is in [AUDIT_REPORT.md](AUDIT_REPORT.md). No critical or
high-severity finding is open. An **external penetration test** is still recommended (go-live
checklist §5).

## 10. Test results

CI run **{{RUN}}** on commit `{{SHA}}`. All counts are from that run.

{{TEST_TABLE}}

Data integrity coverage, with each case pointing to its test:

| Case                          | Where                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate payments (webhooks) | `integrity.e2e-spec.ts` (burst of distinct, duplicate and concurrent events), `payments.e2e-spec.ts`; load test: 60 payments × 4 events |
| Duplicate orders              | `checkout.e2e-spec.ts` (same idempotency key, simultaneous submissions); load test check "one order per idempotency key"                |
| Duplicate refunds             | `integrity.e2e-spec.ts` (concurrent refunds never exceed what was paid, or a seller order's own total)                                  |
| Inventory concurrency         | `inventory.e2e-spec.ts`, `checkout.e2e-spec.ts` (never oversells); load test: 200 attempts at 25 units                                  |
| Stock reservation expiration  | `inventory.e2e-spec.ts` (expired holds return stock and cannot convert), `payments.e2e-spec.ts` (unpaid orders expire)                  |
| Ledger balancing              | `finance.e2e-spec.ts` (unbalanced journals refused at the database), reconciliation after integrity and load tests                      |
| Settlement reconciliation     | `finance.e2e-spec.ts` (settlement, refund after settlement), `integrity.e2e-spec.ts` (whole-database reconciliation)                    |
| COD remittance                | `finance.e2e-spec.ts` (shortage reconciliation), `integrity.e2e-spec.ts` (concurrent duplicate submissions recorded once)               |
| Database rollback             | `integrity.e2e-spec.ts` (failed checkout leaves no order and no hold)                                                                   |
| Worker crash recovery         | `worker.integration-spec.ts` (outbox row orphaned by a crash is delivered; a job whose process was killed runs again exactly once)      |

## 11. Load test results

See [LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md). The results come from a CI runner (4 vCPU,
16 GB) running the whole production stack, so they show **relative** capacity on similar
hardware, not a guaranteed traffic level for a production server.

{{LOAD_SUMMARY}}

## 12. Known limitations

| Limitation                               | Effect                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL and Redis are single nodes    | No automatic failover. Recovery is by restore (RPO about 1 minute, RTO in minutes; measure it in the drill). A managed database with a standby is the upgrade path. |
| No courier API                           | Sellers enter tracking numbers by hand                                                                                                                              |
| Web push uses a mock provider            | Push needs VAPID keys; in-app, email and SMS are real                                                                                                               |
| Search is PostgreSQL full-text + trigram | Good for the tested 5,000-product catalogue; a search engine behind the existing `SearchProvider` interface is the path for a much larger catalogue                 |
| Per-address rate limits                  | Carrier NAT can group many shoppers; tune `RATE_LIMIT_MAX_REQUESTS` and `AUTH_SIGN_IN_LIMIT_PER_MINUTE`                                                             |
| Notification sweep fallback              | A kick that arrives while a run is finishing can wait for the 10-second sweep                                                                                       |
| Load figures from a CI runner            | Repeat the load test on the production-sized server before launch                                                                                                   |

## 13. Deployment instructions

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

1. Prepare one Linux VM (4 vCPU / 8–16 GB) with Docker, DNS for the five hosts and the
   buckets.
2. Copy `docker/production` to the server and fill `.env.production` from the template.
3. Log in to GHCR.
4. Run `DC run --rm migrate`, then `DC run --rm migrate pnpm db:seed`, then the bootstrap of
   the first super admin.
5. Run `DC up -d`.
6. For each release, tag `vX.Y.Z`. The Release workflow builds the images, waits for approval
   of the `production` environment and runs `deploy.sh`. The script takes a backup, migrates,
   recreates the services, health-checks them and rolls back automatically on failure.

## 14. Backup and recovery procedures

See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

- **Schedule:** pgBackRest takes a full backup weekly and a differential daily, and archives
  WAL continuously (point-in-time recovery, RPO about 1 minute).
- **Protection:** backups are encrypted with AES-256 on the client side and stored in a
  bucket in another account or region. Retention defaults to 4 full and 7 differential
  backups.
- **Monitoring:** backup metrics and alerts fire when a backup fails, is overdue, or WAL
  archiving fails.
- **Uploads:** rclone copies uploaded files to a versioned backup bucket.
- **Restore test:** CI runs it on every pull request: back up, write data after the backup,
  destroy the volume, restore, compare every table and a checksum, then restart and verify.
- **Migration rollback:** expand/contract migrations, a backup before each release, and
  `deploy.sh --rollback`.

## 15. Remaining production dependencies

These need people, accounts or approvals outside the software.

| Dependency                                                                                              | Needs                                                     |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Production server, domains, DNS, TLS (automatic once DNS resolves)                                      | Owner: infrastructure purchase                            |
| S3 buckets (uploads; backups in another account/region) and least-privilege keys                        | Owner: cloud account                                      |
| PayMongo **live** activation, live keys, webhook registration, first real payment and refund per method | Business verification with PayMongo (merchant onboarding) |
| Optional PayMongo wallet for automatic payouts                                                          | PayMongo                                                  |
| Maya Business / Xendit                                                                                  | Merchant onboarding and adapter completion                |
| Semaphore SMS account and approved sender name                                                          | Semaphore                                                 |
| Transactional SMTP with SPF/DKIM/DMARC                                                                  | Email provider and DNS                                    |
| Courier API accounts                                                                                    | Each courier                                              |
| VAPID keys for web push                                                                                 | Manual configuration                                      |
| Error-tracking DSNs (Sentry/GlitchTip), alert e-mail recipients                                         | Manual configuration                                      |
| First super admin, staff accounts with two-step verification, platform settings, categories             | Manual configuration                                      |
| Terms of service, privacy notice, seller agreement, refund policy                                       | **Legal approval**                                        |
| Data Privacy Act: DPO, NPC registration, breach procedure                                               | **Legal approval**                                        |
| BIR: receipts/invoices registration, withholding rules                                                  | **Legal/tax approval**                                    |
| Internet Transactions Act / DTI requirements                                                            | **Legal approval**                                        |
| External penetration test; restore drill timed on the real server; load test on the real server         | Owner                                                     |
