# System architecture

## Overview

```
 Browsers                          Server side                                      Data and services
┌────────────────┐  /api (JSON,  ┌───────────────────────────────┐  Prisma   ┌──────────────────────┐
│ Storefront     │   cookies)    │ API — NestJS modular monolith │──────────▶│ PostgreSQL 17        │
│ Seller Center  │──────────────▶│ health · auth* · files ·      │           └──────────────────────┘
│ Admin Console  │               │ dev-tools · sellers* · ...    │  ioredis  ┌──────────────────────┐
└───────┬────────┘               └──────┬─────────────┬──────────┘──────────▶│ Redis 7              │
        │ signed URLs                   │ BullMQ      │ S3 API              │ rate limits, queues, │
        │ (direct download/upload)      │ producers   │                     │ worker heartbeat     │
        │                               ▼             │                     └──────────────────────┘
        │                ┌───────────────────────────┐│                     ┌──────────────────────┐
        │                │ Worker — NestJS + BullMQ  │└────────────────────▶│ S3-compatible storage│
        └───────────────▶│ 7 domain processors,      │                      │ (MinIO locally)      │
                         │ dead-letter handling      │──── SMTP ───────────▶└──────────────────────┘
                         └───────────────────────────┘                      ┌──────────────────────┐
                                                                            │ Mailpit (dev SMTP)   │
                                * later phases                              └──────────────────────┘
```

- **Modular monolith API.** One deployable organized by business domain (`apps/api/src/modules/<domain>`).
  It is stateless, so it scales horizontally behind a load balancer. Rate-limit counters live in
  Redis so all instances share them.
- **Separate worker.** Slow, retryable or scheduled work runs in `apps/worker`, which is deployed
  and scaled independently. Producers (API) and consumers (worker) share queue definitions and
  retry policies from `@marketplace/config`.
- **Three independent frontends.** Static Vite builds with no business rules. They call the API
  through `@marketplace/api-client`, which validates every response against shared Zod schemas.
- **One database package.** `prisma/` (`@marketplace/database`) owns the schema, migrations, seed and
  generated client. The API imports the client from it, and the worker will too when it needs the
  database.

Decisions and their reasons are recorded in [adr/](adr/).

## Repository layout

| Path                    | Responsibility                                                                  |
| ----------------------- | ------------------------------------------------------------------------------- |
| `apps/api`              | HTTP API, business rules, authorization, transactions                           |
| `apps/worker`           | Queue consumers: email, notifications, images, reports, payment events, orders  |
| `apps/storefront`       | Customer-facing shop                                                            |
| `apps/seller-portal`    | Seller Center for seller staff                                                  |
| `apps/admin-portal`     | Admin Console for platform staff (plus developer tools in development)          |
| `packages/ui`           | Design system: tokens, shadcn/ui components, layouts, form bindings, data table |
| `packages/shared-types` | Types shared by everything: roles, API error codes, health, money               |
| `packages/validation`   | Zod schemas: request/response contracts and env-variable helpers                |
| `packages/api-client`   | Typed fetch client (app header, CSRF, token refresh) and TanStack Query hooks   |
| `packages/auth-ui`      | Sign-in, password, invitation screens, route guards and the account menu        |
| `packages/config`       | Non-secret constants: queue registry and retry policies, Redis keys, locale     |
| `prisma`                | Schema, migrations, seed, generated client                                      |
| `docker`                | Local infrastructure (Compose)                                                  |
| `scripts`               | Windows PowerShell automation                                                   |

## API internals

```
apps/api/src
├── main.ts / bootstrap.ts   HTTP pipeline (shared with e2e tests)
├── config/                  Zod-validated env → typed AppConfig; fails fast at start-up
├── common/
│   ├── auth/                @Public() @Roles() @RequirePermissions() @SkipCsrf() @CurrentUser(); RolesGuard;
│   │                        sellerScope(user) for seller-isolated queries
│   ├── errors/              ApiException + GlobalExceptionFilter (standard error envelope)
│   ├── validation/          createZodDto, ZodGlobalValidationPipe, ZodValidationPipe
│   └── openapi/             zodToOpenApi: Swagger schemas from the same Zod schemas
├── infrastructure/          Global technical modules: prisma, redis, storage, queue, throttling, logging
└── modules/                 Domain modules: health, auth (incl. MFA), users, roles, wholesale, sellers, stores,
                             seller-members, audit, notifications, files, dev-tools,
                             catalog (categories, brands), products (incl. photos),
                             pricing (price engine, quotes), inventory (warehouses, ledger, reservations),
                             storefront (search provider, catalog, home page, banners, featured),
                             locations, addresses, wishlist, reviews, cart, promotions (coupons,
                             flash sales), shipping (provider interface, mock), checkout (pricing,
                             placing orders), orders, settings
```

### Catalog, pricing and inventory (Phase 3)

- **Products** belong to a seller's store; seller endpoints are limited by `sellerScope(user)`
  and staff endpoints need `catalog.products.*`. Content changes to approved products go back
  to review ([ADR 0015](adr/0015-catalog-approval-and-product-images.md)).
- **Prices** are always computed by the pure `price-engine.ts`; the quote returns a snapshot
  that orders will store ([ADR 0016](adr/0016-server-side-pricing-engine.md)).
- **Stock** changes are single guarded SQL updates plus an append-only ledger row in one
  transaction; reservations lock the variant's stock rows
  ([ADR 0017](adr/0017-inventory-ledger-and-reservations.md)).
- **Product photos** are validated (extension, content, size, pixel limits) and re-encoded to
  WebP with sharp inside the API request (large 1600 px + 400 px thumbnail, metadata removed).
  The `image-processing` queue is kept for heavier work later.

### Storefront, cart and checkout (Phase 4)

- **Search** goes through the `SearchProvider` interface; `PostgresSearchProvider` uses
  full-text prefix search, trigram similarity and a per-product current-price subquery
  ([ADR 0018](adr/0018-storefront-search-behind-a-provider.md)).
- **Locations** are the PSGC tables in `ph_locations`, imported by `pnpm db:import-locations`;
  addresses and warehouses store the codes
  ([ADR 0020](adr/0020-philippine-locations-from-psgc.md)).
- **Carts** are stored for signed-in customers and kept in the browser for guests (variant ids
  and quantities only), merged at sign-in. Every read re-prices the lines.
- **Checkout** has one calculation, `CheckoutPricingService.plan()`, used for the quote and
  again inside the order transaction. It produces one parent order, one seller order per
  seller with its shipping group, and order items with price snapshots, discounts, VAT and
  commission. Coupon uses, flash-sale units and stock are taken with guarded updates or row
  locks, so parallel checkouts cannot oversell. Placing an order needs an idempotency key
  ([ADR 0019](adr/0019-checkout-pricing-and-multi-seller-orders.md)).
- **Shipping** quotes come from a `ShippingProvider`; the development `MockShippingProvider`
  uses an editable rate table and is refused in production
  ([ADR 0021](adr/0021-shipping-provider-interface-and-mock-rates.md)).
- **Settings** (VAT, charges, payment methods and window, shipping rates) are validated JSON
  in `platform_settings` with defaults in code; commission rates are in `commission_rules`.
- **Order cancellation** (`cancelOrderInTx` in `@marketplace/database`) is shared by the API
  (customer cancels) and the worker (unpaid orders expire).

### Request lifecycle

1. **pino-http** assigns a request id (reusing a well-formed incoming `X-Request-Id`), logs the
   request with secrets redacted, and echoes the id in the response header.
2. **helmet** sets security headers. **CORS** allows only `CORS_ORIGINS`, with credentials.
3. Body parsing: JSON and forms up to 1 MB. Multipart uploads go through multer, limited by
   `UPLOAD_MAX_BYTES`.
4. Global guards, in order:
   1. **ThrottlerGuard**: per-IP rate limit, stored in Redis (stricter on credential routes).
   2. **CsrfGuard**: state-changing requests must echo the CSRF cookie in `X-CSRF-Token`.
   3. **AuthenticationGuard**: resolves `request.user` from the access-token cookie of the app
      named in `X-Client-App`. Secure by default: only `@Public()` routes pass without a user.
   4. **RolesGuard**: enforces `@Roles(...)`.
   5. **PermissionsGuard**: enforces `@RequirePermissions(...)`.
5. **ZodGlobalValidationPipe** validates every `@Body()`, `@Query()` and `@Param()` typed with a
   `createZodDto(schema)` class, using the schema shared with the frontends.
6. The controller calls a service, and services own the business rules. Multi-row writes use
   `prisma.$transaction`.
7. Any error becomes `{ error: { code, message, statusCode, requestId, fieldErrors? } }`. Unknown
   errors become a generic 500; details go only to logs.

### Authentication and authorization

Decisions: ADR 0010 (sessions), ADR 0011 (roles and permissions), ADR 0012 (SMS codes),
ADR 0013 (sellers and isolation), ADR 0014 (two-step verification).

- **Who signs in where.** Customers sign up themselves in the storefront (mobile number
  confirmed by SMS; email confirmed by link) and sign in with mobile + SMS code or email +
  password. Wholesale customers shop at retail prices until an admin approves their business.
  Sellers register their business in the Seller Center and become its owner; owners and
  managers invite their own employees. Platform staff are created by an administrator and
  activated by an emailed invitation. Platform staff use the Admin Console; seller staff use
  the Seller Center. Any account can turn on two-step verification (authenticator app).
- **Sessions** live in HttpOnly cookies, one pair per app; access tokens last 15 minutes and
  refresh tokens rotate with reuse detection. Roles and permissions are resolved per request
  (cached 60 s in Redis and invalidated on change), so suspensions and permission changes apply
  immediately.
- **Authorization**: `@RequirePermissions(...)` for operations, `@Roles(...)` for audiences.
  Permissions are scoped `platform` or `seller`, and roles only contribute permissions of their
  own scope. `SUPER_ADMIN` and `SELLER_OWNER` always hold every permission of their scope.
- **Seller isolation**: a seller role counts only with an active membership of a seller. In the
  Seller Center the principal carries `seller.id`, and every seller-side query filters by it
  through `sellerScope(user)`; another seller's records answer 404.
- **Audit**: `AuditService.record()` writes to the append-only `audit_logs` table, inside the
  same transaction as the change it describes.
- **Notifications**: the API enqueues email and SMS jobs after committing; the worker renders
  templates and sends through SMTP and the `SmsProvider` port (mock or Semaphore).

## Background jobs

| Queue              | Purpose                                 | Attempts | First retry | Concurrency |
| ------------------ | --------------------------------------- | -------- | ----------- | ----------- |
| `system`           | Heartbeat, development diagnostics      | 3        | 1 s         | 5           |
| `email`            | Transactional email                     | 5        | 30 s        | 10          |
| `notifications`    | In-app, SMS, push                       | 5        | 10 s        | 10          |
| `image-processing` | Product image variants                  | 3        | 15 s        | 2           |
| `reports`          | Reports and exports                     | 3        | 60 s        | 1           |
| `payment-events`   | Payment webhooks (idempotent handlers)  | 10       | 5 s         | 5           |
| `order-processing` | Order transitions, stock, settlements   | 8        | 5 s         | 5           |
| `dead-letter`      | Permanently failed jobs (not processed) | n/a      | n/a         | n/a         |

- **Exponential backoff.** Each retry waits twice as long as the previous one.
- **Retention.** Completed jobs are kept for 24 h (max 1,000); failed jobs for 7 days.
- **Dead-lettering.** When a job fails its last attempt, or throws BullMQ's
  `UnrecoverableError` (bad payload, no handler), the worker copies it to the `dead-letter` queue
  with the source queue, payload, error and attempt count. Admins inspect, retry or discard dead
  letters; nothing is lost silently.
- **Routing.** Each queue has one processor (`apps/worker/src/queues/processors.ts`) that routes
  jobs to handlers by job name (`<queue>.<action>`). Business phases register their handlers
  there. A job without a handler is dead-lettered immediately.
- **Heartbeat.** A BullMQ job scheduler runs `system.heartbeat` every 15 s. The handler writes a
  Redis key that `GET /api/v1/health` reads, which proves the whole Redis → BullMQ → worker
  pipeline.
- **Database access.** The worker connects to PostgreSQL (`DATABASE_URL`, required in
  production) for jobs that change data. A job scheduler on `order-processing` runs
  `order.release-expired-reservations` every 60 s, using the same `releaseExpiredReservations`
  function as the API (from `@marketplace/database`).
- **Catalog emails.** `email.product-decision` (approved, rejected, taken down) and
  `email.low-stock` are sent through the email queue.
- **Order emails and expiry (Phase 4).** `email.order-placed` (customer), `email.seller-new-order`
  (one per seller, only that seller's items) and `email.order-cancelled`. A second scheduler on
  `order-processing` runs `order-processing.expire-unpaid-orders` every 60 s. It cancels orders
  waiting for an online payment past their deadline, gives back their stock, coupon uses and
  flash-sale units, and emails the customer.
- **Development samples.** `system.dev-sample` can simulate failures to demonstrate retries and
  dead-lettering, and `email.dev-test` sends a test email (to Mailpit locally). Both refuse to run
  unless `DEV_TOOLS_ENABLED=true`.

## File storage

- `ObjectStorage` is the provider-neutral abstraction (`apps/api/src/infrastructure/storage`):
  upload (buffer or stream), download (stream), head (metadata), delete, signed download URL
  and signed upload URL. `S3ObjectStorage` implements it with the AWS SDK for any S3-compatible
  service, and switching provider is a one-line binding change in `StorageModule`.
- `FilesService` keeps objects and the `stored_files` table consistent:
  - The file type is detected from the content (magic bytes) and checked against an allow-list
    per purpose.
  - Object keys are generated by the server (`<purpose>/<yyyy>/<mm>/<uuid>.<ext>`), never taken
    from the user's file name.
  - A SHA-256 checksum is stored with each file.
  - If saving the metadata fails, the uploaded object is removed.
  - Deletes are soft for metadata (`status = DELETED`, `deleted_at`) and hard for the object.
- Downloads use short-lived signed URLs (`STORAGE_SIGNED_URL_TTL_SECONDS`), or stream through
  the API with `Content-Disposition: attachment`.
- Seller verification documents (`SELLER_DOCUMENT`) are only ever streamed through the API after
  the seller-scope or `sellers.read` check (`Cache-Control: private, no-store`), never by URL.
  Staff views are audited. Store logos and banners are the only public seller files.
- Product photos (`PRODUCT_IMAGE`, `PRODUCT_IMAGE_THUMBNAIL`) and category images
  (`CATEGORY_IMAGE`) are public: the API streams them with `?v=<fileId>` URLs and
  `Cache-Control: public, max-age=31536000, immutable`. Only re-encoded WebP files are stored.

## Frontend architecture

- **Routing:** React Router 8 data routers. Routes live in `src/app/routes.tsx`, with a
  `RouteError` boundary and a 404 page.
- **Data:** TanStack Query with shared defaults from `createQueryClient()` (no retries on 4xx).
  Hooks live in `@marketplace/api-client`; cache keys come from the `queryKeys` factory.
- **Forms:** React Hook Form with `zodResolver` and the same `@marketplace/validation` schemas the
  API uses. `Form`/`FormField`/`FormMessage` from `@marketplace/ui` wire up labels, ARIA and errors.
- **Design system:** Tailwind CSS 4 tokens (light and dark) and shadcn/ui components in
  `@marketplace/ui`:
  - basic components: Button, Input, Textarea, Label, Select, Dialog, Sheet, Table, Badge,
    Card, Alert, Skeleton, Spinner, Progress, Toaster;
  - patterns: ConfirmDialog, DataTable (loading, empty, error, pagination), Pagination,
    Breadcrumbs, EmptyState, ErrorState, PageHeader, SidebarLayout, NotFound,
    SystemStatusPanel, AuthShell;
  - since Phase 2: Checkbox, Tabs, DropdownMenu, PasswordInput;
  - since Phase 4: `formatMoney`, `SellerOrderView` and `SellerOrderStatusBadge` (one suborder
    view shared by the Seller Center and the Admin Console). `@marketplace/auth-ui` also holds
    `CouponManager`, used by both portals.
- **Storefront shopping:** the guest cart lives in `localStorage` behind `useSyncExternalStore`
  (`lib/guest-cart.ts`). The checkout page shows only amounts from `POST /checkout/quote` and
  sends the shown total as `expectedGrandTotal`, with one idempotency key per attempt.
- **Sessions in the browser:** `useSession()` is the single source of truth. `RequireSession`
  sends signed-out users to `/sign-in` and back afterwards; `RequirePermission` hides pages a
  role may not open; navigation only lists permitted pages. `SessionSync` clears cached data
  when the API reports the session ended.
- **Layouts:** the storefront uses a header and footer shell. Both portals use `SidebarLayout`:
  a fixed sidebar on desktop, a slide-out sheet on tablet and phone, plus a skip link.
- **Builds:** vendor code is split into long-cached chunks (`react`, `data`, `vendor`).

## Health and observability

- `GET /api/v1/health/live`: liveness, no dependency checks, exempt from rate limiting.
- `GET /api/v1/health`: readiness. Database, Redis and storage are critical (503 when any is down);
  the worker is non-critical (`degraded`). Each check times out after 3 s, and failure messages
  never contain internal details.
- Structured JSON logs (pino) from the API and worker. Request ids appear in logs, response
  headers and error bodies.

## Security baseline

| Concern                   | Implementation                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Secure by default         | Global authentication guard; only `@Public()` routes are reachable without a user                  |
| Sessions                  | HttpOnly, SameSite=Lax cookies (Secure in production); rotating refresh tokens; CSRF double-submit |
| Passwords                 | Argon2id; 12+ characters; lock-out after 5 failures; no account enumeration                        |
| One-time codes            | HMAC-stored, 5-minute, 5 attempts, per-number and per-IP send limits                               |
| Audit                     | Append-only `audit_logs` (database trigger), no secrets in metadata                                |
| Input validation          | Zod everywhere (global pipe); request size limits                                                  |
| Injection                 | Prisma parameterized queries; no string-built SQL                                                  |
| Security headers          | helmet (CSP relaxed only on the Swagger path)                                                      |
| Rate limiting             | Redis-backed, per IP, shared across instances                                                      |
| Upload safety             | Content sniffing + allow-list, size limit, server-generated keys, attachment disposition           |
| Secrets                   | Environment variables only; validated at start-up; redacted in logs; never in responses            |
| Development-only features | `DEV_TOOLS_ENABLED` is rejected at start-up when `NODE_ENV=production`; disabled routes answer 404 |
| Network exposure (local)  | Docker ports bound to 127.0.0.1                                                                    |
| Backups                   | `backup-db.ps1` with retention, schedulable through Task Scheduler                                 |
