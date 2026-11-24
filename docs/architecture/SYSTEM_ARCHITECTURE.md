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
│   ├── auth/                @Public() @Roles() @RequirePermissions() @SkipCsrf() @CurrentUser(); RolesGuard
│   ├── errors/              ApiException + GlobalExceptionFilter (standard error envelope)
│   ├── validation/          createZodDto, ZodGlobalValidationPipe, ZodValidationPipe
│   └── openapi/             zodToOpenApi: Swagger schemas from the same Zod schemas
├── infrastructure/          Global technical modules: prisma, redis, storage, queue, throttling, logging
└── modules/                 Domain modules: health, auth, users, roles, wholesale, audit, notifications, files, dev-tools
```

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

Decisions: ADR 0010 (sessions), ADR 0011 (roles and permissions), ADR 0012 (SMS codes).

- **Who signs in where.** Customers sign up themselves in the storefront (mobile number
  confirmed by SMS; email confirmed by link) and sign in with mobile + SMS code or email +
  password. Wholesale customers shop at retail prices until an admin approves their business.
  Every other role is created by an administrator and activated by an emailed invitation.
  Platform staff use the Admin Console; seller staff use the Seller Center.
- **Sessions** live in HttpOnly cookies, one pair per app; access tokens last 15 minutes and
  refresh tokens rotate with reuse detection. Roles and permissions are resolved per request
  (cached 60 s in Redis and invalidated on change), so suspensions and permission changes apply
  immediately.
- **Authorization**: `@RequirePermissions(...)` for platform operations, `@Roles(...)` for
  audiences. `SUPER_ADMIN` always has every permission. Seller-scoped services (Phase 3) will
  always filter by `user.sellerId`.
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
  - since Phase 2: Checkbox, Tabs, DropdownMenu, PasswordInput.
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
