# Phase 1 report: Foundation and infrastructure

- Branch: `phase-1-foundation` (PR #1)
- Date: 2026-11-24
- Verified on: GitHub Actions run `45374684117`, commit `0c0d926` (all three jobs green)
- Status: **Complete, awaiting review and approval.** Phase 2 has not been started.

This report covers the full Phase 1 specification (sections 1–10 of the Phase 1 brief). The first
iteration of this branch built the core foundation. The second added the requested layout,
shared components, queues, storage service, Mailpit, start/stop scripts and documentation set.

## 1. Implemented features, by requirement

### 1. Monorepo

The repository matches the requested structure, plus `scripts/` and `e2e/`:

```
apps/{storefront,seller-portal,admin-portal,api,worker}
packages/{ui,shared-types,validation,api-client,config}
prisma/{schema.prisma,migrations/,seed.ts}      ← workspace package @marketplace/database
docker/docker-compose.yml
docs/{architecture,database,api,development,testing}
```

It is a pnpm workspace with TypeScript 6 strict mode, ESLint 10, Prettier and EditorConfig, and
CRLF line endings for `.ps1` files.

### 2. Frontend

- Three independent apps built with **React 19, TypeScript, Vite 8, Tailwind CSS 4, shadcn/ui,
  React Router 8, TanStack Query 5, React Hook Form and Zod**.
- **Shared design system** (`@marketplace/ui`) with light and dark tokens:
  - **Buttons**: `Button` (6 variants, 4 sizes, `asChild`)
  - **Inputs**: `Input`, `Textarea`, `Label`
  - **Select controls**: `Select` (Radix, keyboard accessible)
  - **Modal dialogs**: `Dialog`; `Sheet` (slide-out panel)
  - **Confirmation dialogs**: `ConfirmDialog` (async action with spinner; stays open if the action
    fails; destructive variant)
  - **Tables**: `Table` primitives and `DataTable` (loading skeleton, empty state, error with
    retry, columns hidden on mobile)
  - **Pagination**: `Pagination` ("Showing x–y of z", page window, compact mode on mobile)
  - **Breadcrumbs**: `Breadcrumbs` (router links, `aria-current`)
  - **Sidebar navigation**: `SidebarLayout` (fixed on desktop, sheet on tablet and phone, skip link)
  - **Toast notifications**: `Toaster` / `toast` (sonner)
  - **Loading indicators**: `Spinner`, `LoadingState`, `Skeleton`, `Progress`
  - **Empty states**: `EmptyState`, plus `ErrorState`, `NotFound` and `RouteError`
  - **Forms**: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`,
    `FormMessage` (React Hook Form + `zodResolver`, wiring ARIA attributes)
- **Layouts**:
  - storefront: header, navigation and footer shell;
  - Seller Center and Admin Console: the sidebar layout.
- **No marketplace modules.** The only pages are system status and, in the Admin Console, the
  development-only **Developer tools** (Background jobs, File storage). These use every shared
  component against real endpoints, and every button performs a real operation.

### 3. Backend

| Requirement                       | Implementation                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Application bootstrap             | `main.ts` + `bootstrap.ts` (same pipeline in tests)                                                                                         |
| Configuration module              | Zod-validated env → typed `AppConfig`; fails fast listing every bad variable, without printing secrets                                      |
| Global validation pipe            | `ZodGlobalValidationPipe` + `createZodDto(schema)`; shared schemas; field-level errors                                                      |
| Global exception handling         | `GlobalExceptionFilter` → standard error envelope; unknown errors hidden, logged with request id                                            |
| Request logging                   | pino-http: JSON logs, request ids, redaction of secrets                                                                                     |
| Health check                      | `GET /api/v1/health`: status, version, uptime, database, Redis, storage and worker with latency; no secrets                                 |
| Swagger                           | `/api/docs`, generated from the Zod schemas                                                                                                 |
| CORS                              | Allow-list from `CORS_ORIGINS`, with credentials                                                                                            |
| API versioning                    | URI versioning, `/api/v1`                                                                                                                   |
| Database module                   | `PrismaModule` using `@marketplace/database` (Prisma 7 + `pg` adapter)                                                                      |
| Redis module                      | Shared ioredis client with graceful shutdown                                                                                                |
| Authentication module placeholder | `AuthModule` registering global `AuthGuard` (secure by default) and `RolesGuard`                                                            |
| Decorators and guards             | `@Public()`, `@Roles(...)`, `@CurrentUser()`; 14 roles defined in `shared-types`                                                            |
| Extras                            | helmet, Redis-backed rate limiting, body limits, `ObjectStorage`, `FilesService`, BullMQ producers for all queues, development-tools module |

### 4. Database

- PostgreSQL 17 with Prisma 7. Conventions are documented in
  [DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md) and applied in the schema:
  - UUIDv7 primary keys
  - `created_at` / `updated_at` as `timestamptz(3)` in UTC
  - `status` columns with `<Entity>Status` enums
  - PascalCase enums mapped to snake_case PostgreSQL types, with UPPER_SNAKE values
  - snake_case tables and columns
  - `CHECK` constraints
- No business tables yet. The only tables are `currencies` (reference data) and `stored_files`
  (metadata for the storage service).
- Migration and seeding infrastructure: `pnpm db:migrate`, `db:deploy`, `db:seed`, `db:reset`,
  `db:status`, `db:studio`, plus `db:check` (drift check, enforced in CI).

### 5. Redis and background workers

- **Queues:** `email`, `notifications`, `image-processing`, `reports`, `payment-events`,
  `order-processing`, plus `system` and `dead-letter`. They are defined once in
  `@marketplace/config` and registered by both the API and the worker.
- **Retry policies:**
  - per-queue attempts (3–10) with **exponential backoff**;
  - retention limits (completed 24 h, failed 7 days);
  - per-queue concurrency.
- **Dead-letter handling:** a job that fails its last attempt, has an invalid payload, or has no
  handler is copied to the `dead-letter` queue (idempotently). From the Admin Console you can
  list dead letters, view their payload, retry them on the original queue, or discard them.
- **Sample job, development only:** `system.dev-sample` can simulate failures, which shows
  retries and dead-lettering. A second job, `email.dev-test`, sends a real email through SMTP
  to Mailpit. Both refuse to run unless `DEV_TOOLS_ENABLED=true`.
- **Worker heartbeat:** a BullMQ job scheduler runs it every 15 s and `/health` reports it.

### 6. Local storage

- MinIO for development, using Chainguard's maintained image. MinIO Inc. stopped publishing
  images in 2025.
- **`ObjectStorage` abstraction:**
  - upload (buffer or stream)
  - download (stream)
  - delete
  - file metadata (head)
  - signed download URLs and signed upload URLs
- `S3ObjectStorage` implements it for any S3-compatible provider, and `S3_PUBLIC_ENDPOINT`
  controls which host appears in signed URLs.
- **`FilesService`:**
  - detects the content type from the file bytes and checks it against an allow-list;
  - enforces the size limit;
  - generates object keys on the server and records a SHA-256 checksum;
  - stores metadata in `stored_files`;
  - removes the object if saving the metadata fails (no orphans);
  - deletes softly (metadata marked deleted, object removed).

### 7. Docker

- `docker/docker-compose.yml` runs **PostgreSQL 17, Redis 7, MinIO and Mailpit**. Each has a
  **health check** and a **named persistent volume**, and ports are bound to 127.0.0.1.
- Windows scripts:
  - `start.ps1` (`-InfraOnly`, `-Only <app>`)
  - `stop.ps1` (`-RemoveData`)
  - `setup.ps1`, `test.ps1`, `reset-db.ps1`, `backup-db.ps1`, `restore-db.ps1`
  - `dev.ps1` (alias of `start.ps1`)

### 8. Documentation

| Document                                                                      | Content                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| [README.md](../../README.md)                                                  | Layout, start instructions, URLs, commands             |
| [development/WINDOWS_SETUP.md](../development/WINDOWS_SETUP.md)               | Install, setup, start/stop, verify, environment        |
| [development/LOCAL_DATABASE.md](../development/LOCAL_DATABASE.md)             | Connection, commands, schema changes, backups          |
| [development/TROUBLESHOOTING.md](../development/TROUBLESHOOTING.md)           | Common problems and fixes                              |
| [architecture/SYSTEM_ARCHITECTURE.md](../architecture/SYSTEM_ARCHITECTURE.md) | Components, request lifecycle, jobs, storage, security |
| [architecture/adr/](../architecture/adr/)                                     | 9 decision records                                     |
| [database/DATABASE_CONVENTIONS.md](../database/DATABASE_CONVENTIONS.md)       | Naming, ids, timestamps, status, enums, money          |
| [api/API_REFERENCE.md](../api/API_REFERENCE.md)                               | Conventions, error codes, every endpoint               |
| [testing/TESTING_GUIDE.md](../testing/TESTING_GUIDE.md)                       | Test layers, commands, CI, requirement coverage        |

## 2. Created and modified files

Everything in the branch is new except `README.md` and `.gitignore`. The full list is in the
PR's **Files changed** tab. The main areas:

- **Root:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.react.json`,
  `eslint.config.js`, `jest.nest-preset.cjs`, `vite.shared.mts`, `vitest.setup.ts`,
  `playwright.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `.vscode/*`
- **`prisma/`:** schema, 2 migrations, seed, config, `src/{index,pg-adapter}.ts`
- **`apps/api/src`:**
  - `config/`, `bootstrap.ts`, `main.ts`, `app.module.ts`
  - `common/{auth,errors,validation,openapi}/`
  - `infrastructure/{prisma,redis,storage,queue,throttling,logging}/`
  - `modules/{health,auth,files,dev-tools}/`
  - `test/*.e2e-spec.ts` (7 suites)
- **`apps/worker/src`:** `config/`, `queues/` (registry processors, dead letters), `jobs/`,
  `mail/`, `test/worker.integration-spec.ts`
- **Frontends:** each app's `src/app`, `src/pages` and layouts; Admin Console `pages/dev-tools/*`,
  `components/job-status-panel.tsx`, `lib/*`
- **`packages/*/src`:**
  - `ui`: 14 components, 12 patterns, 1 layout
  - `validation`: env, health, dev-tools contracts
  - `config`: queue registry
  - `shared-types`: roles, errors, health, money
  - `api-client`: client, dev-tools client, hooks
- **`docker/docker-compose.yml`; `scripts/*.ps1`; `e2e/*.spec.ts`; `docs/**`**

## 3. Database changes

| Migration                        | Changes                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20261124090000_init_foundation` | Table `currencies` (`code` CHAR(3) PK, name, symbol, minor_units, is_active, timestamps) + CHECKs (ISO format, minor units 0–4)                                                                                                                                                                                                                                                |
| `20261124120000_file_storage`    | Enums `file_status` (PENDING, AVAILABLE, DELETED) and `file_purpose` (DEV_TEST); table `stored_files` (UUID id, bucket, object_key, original_name, content_type, size_bytes BIGINT, checksum_sha256, purpose, status, timestamps, deleted_at); unique (bucket, object_key); index (purpose, status, created_at); CHECKs (size ≥ 0, hex SHA-256, status/deleted_at consistency) |

Seed: `PHP` (Philippine Peso, ₱, 2 minor units). CI confirms the migrations match
`schema.prisma` exactly ("No difference detected").

## 4. API endpoints

| Method | Path                                  | Access                                 |
| ------ | ------------------------------------- | -------------------------------------- |
| GET    | `/api/v1/health`                      | Public                                 |
| GET    | `/api/v1/health/live`                 | Public                                 |
| POST   | `/api/v1/dev/jobs/sample`             | Development only (`DEV_TOOLS_ENABLED`) |
| POST   | `/api/v1/dev/jobs/test-email`         | Development only                       |
| GET    | `/api/v1/dev/jobs/{queue}/{jobId}`    | Development only                       |
| GET    | `/api/v1/dev/queues`                  | Development only                       |
| GET    | `/api/v1/dev/dead-letters`            | Development only                       |
| POST   | `/api/v1/dev/dead-letters/{id}/retry` | Development only                       |
| DELETE | `/api/v1/dev/dead-letters/{id}`       | Development only                       |
| POST   | `/api/v1/dev/files`                   | Development only                       |
| GET    | `/api/v1/dev/files`                   | Development only                       |
| GET    | `/api/v1/dev/files/{id}`              | Development only                       |
| GET    | `/api/v1/dev/files/{id}/download-url` | Development only                       |
| GET    | `/api/v1/dev/files/{id}/content`      | Development only                       |
| DELETE | `/api/v1/dev/files/{id}`              | Development only                       |
| GET    | `/api/docs`, `/api/docs-json`         | When `SWAGGER_ENABLED=true`            |

Details: [API_REFERENCE.md](../api/API_REFERENCE.md).

## 5. Environment variables

All in `.env.example`, grouped and explained in
[WINDOWS_SETUP.md §5](../development/WINDOWS_SETUP.md#5-environment-configuration).

New in this iteration:

- `S3_PUBLIC_ENDPOINT`, `STORAGE_SIGNED_URL_TTL_SECONDS`, `UPLOAD_MAX_BYTES`
- `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`
- `DEV_TOOLS_ENABLED`, `VITE_MAILPIT_URL`
- `MINIO_IMAGE` now defaults to `cgr.dev/chainguard/minio:latest-dev`
- `WORKER_CONCURRENCY` is now an optional override of the per-queue defaults

## 6. Starting the entire project (Windows PowerShell)

```powershell
# One-time prerequisites (then reopen PowerShell; start Docker Desktop)
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
corepack enable
corepack prepare pnpm@10.28.0 --activate

# Get the code and set up (safe to re-run)
git clone https://github.com/neilfurry/ecommerce.git
cd ecommerce
git checkout phase-1-foundation        # until PR #1 is merged
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1

# Start everything: Docker services, API, worker, 3 frontends
.\scripts\start.ps1

# Stop: Ctrl+C for the apps, then
.\scripts\stop.ps1

# Tests (download the Playwright browser once first)
pnpm exec playwright install chromium
.\scripts\test.ps1
```

| Open          | URL                            |
| ------------- | ------------------------------ |
| Storefront    | http://localhost:5173          |
| Seller Center | http://localhost:5174          |
| Admin Console | http://localhost:5175          |
| Swagger       | http://localhost:3000/api/docs |
| Mailpit       | http://localhost:8025          |
| MinIO console | http://localhost:9001          |

## 7. Test results

All results come from executed runs. The final run is GitHub Actions `45374684117` on commit
`0c0d926`. Playwright is configured to fail the run if any test passes only on retry, and this
run had no flaky tests.

| Suite                                                              | Result                                                                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit: `validation`                                                 | 55 passed                                                                                                                                                                    |
| Unit: `ui`                                                         | 27 passed                                                                                                                                                                    |
| Unit: `api-client`                                                 | 18 passed                                                                                                                                                                    |
| Unit: `config`                                                     | 8 passed                                                                                                                                                                     |
| Unit: `database` (`prisma/`)                                       | 2 passed                                                                                                                                                                     |
| Unit: API                                                          | 51 passed                                                                                                                                                                    |
| Unit: worker                                                       | 17 passed                                                                                                                                                                    |
| Unit: storefront / seller portal / admin portal                    | 4 / 5 / 12 passed                                                                                                                                                            |
| **Unit total**                                                     | **199 passed, 0 failed**                                                                                                                                                     |
| API e2e: real PostgreSQL, Redis, MinIO (7 suites)                  | **40 passed** (CI service containers, and again via `test.ps1` against Docker Compose)                                                                                       |
| Worker integration: real Redis/BullMQ + SMTP                       | **7 passed** (heartbeat ×2, sample job, retry with backoff, dead-letter after retries, dead-letter without handler, email delivery)                                          |
| Playwright: desktop + Pixel 7                                      | **13 passed**, 1 skipped (phone-only test on desktop), 0 flaky                                                                                                               |
| Migration drift (`prisma migrate diff`)                            | No difference detected                                                                                                                                                       |
| Scripts on real Docker Compose (PowerShell 7)                      | `setup` (all 4 containers healthy), `test -Suite integration`, `backup`, `restore`, `reset`, `stop`, `start -InfraOnly`, `stop -RemoveData` (volumes removed): all succeeded |
| Typecheck (all 11 workspaces), ESLint, Prettier, production builds | Clean                                                                                                                                                                        |

Coverage of each item in the brief's §9 Testing list:

| Brief item                  | Evidence                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| All three frontends start   | Playwright loads all three Vite dev servers                                             |
| Backend starts              | Playwright starts the built API; e2e boots the full module                              |
| PostgreSQL connection works | `health`, `database` and `dev-tools` e2e suites                                         |
| Prisma commands work        | CI: `generate`, `migrate diff`, `migrate deploy`, `db seed`, `migrate reset`            |
| Redis connection works      | `health`, `rate-limit` e2e; worker integration                                          |
| Worker processes a test job | Worker integration; Playwright sample job → Completed; failing job → dead letter        |
| MinIO accepts a test upload | `object-storage` e2e (upload, metadata, signed URLs); Playwright upload/download/delete |
| Swagger accessible          | `http-pipeline` e2e (`/api/docs-json` lists the endpoints)                              |
| Health endpoint works       | `health` e2e (ok and degraded); Playwright status pages                                 |
| Email via Mailpit           | Playwright checks the message through Mailpit's API                                     |

I also checked the Admin Console developer-tools pages visually at desktop and phone sizes,
including the form validation state and the confirmation dialog. There were no console errors.

## 8. Remaining issues

1. **Not yet run on Windows itself.** The PowerShell scripts were executed with PowerShell 7 on
   Linux against Docker Compose in CI. Windows PowerShell 5.1 with Docker Desktop on your PC is
   acceptance item 1 below. The scripts avoid PowerShell 7-only syntax and non-ASCII characters
   for that reason.
2. **Developer tools are unauthenticated until Phase 2.** They only exist when
   `DEV_TOOLS_ENABLED=true`, which production configuration rejects, and they listen on
   localhost. Phase 2 restricts them to `SUPER_ADMIN`.
3. **Seller Center and storefront have no forms yet.** The form components are shared and
   proven in the Admin Console. Sign-in (Phase 2) is the first form in the other apps.
4. **MinIO upstream is archived.** Development uses Chainguard's maintained image. The storage
   abstraction keeps production on any managed S3 service (decided in Phase 10).
5. **Dead letters keep their payload as-is.** Later phases with sensitive payloads (payments)
   must store references, not secrets, in job data. This is documented in ADR 0008.

## 9. Acceptance criteria

1. `powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1` completes on your Windows 11 PC
   with "Setup complete."
2. `pnpm infra:ps` shows `postgres`, `redis`, `minio` and `mailpit` all **healthy**.
3. `.\scripts\start.ps1` starts the API, worker and three frontends without errors. The three URLs
   load on desktop and phone widths.
4. Admin Console → **System health** shows all four components **Up**.
5. **Developer tools → Background jobs:**
   - **Run job** reaches **Completed**.
   - With "Fail the first 5 attempts" the job retries (Attempt 3 of 3) and ends **Failed**, then
     appears in the **Dead-letter queue**, where **Retry** and **Discard** work.
6. **Send test email** reaches Completed and the email is visible at http://localhost:8025.
7. **Developer tools → File storage:**
   - upload a PNG, PDF or text file, view its details, download it and delete it;
   - a renamed `.exe` is rejected;
   - the file appears in the MinIO console (http://localhost:9001) while it exists.
8. http://localhost:3000/api/docs lists the health and developer-tools endpoints.
   `GET /api/v1/health` shows no secrets.
9. `pnpm db:status` shows 2 applied migrations. `pnpm db:migrate` reports the schema is in sync.
10. `.\scripts\test.ps1` passes. Run `pnpm exec playwright install chromium` once first.
11. `.\scripts\stop.ps1` stops the services. `.\scripts\start.ps1 -InfraOnly` brings them back
    with the data intact.

## 10. Dependencies on Phase 2 (Identity and access)

Phase 2 builds on:

- `AuthModule` / `AuthGuard` / `RolesGuard` / `@CurrentUser()`;
- `USER_ROLES`;
- the Zod DTO pipeline and the Redis throttler (stricter limits on sign-in);
- the log redaction list (passwords and tokens are already covered);
- the email queue + SMTP adapter (verification and password-reset emails);
- cookie parsing + CORS with credentials (refresh cookies);
- the database conventions for `users`, `roles`, `permissions`, `sessions` and `audit_logs`.

Decisions needed before Phase 2 starts:

1. Which roles may self-register (customers? sellers?) and which only an admin can create.
2. Whether customers sign in with email only, or also with a Philippine mobile number and OTP
   (needs an SMS provider; a mock adapter would come first).
