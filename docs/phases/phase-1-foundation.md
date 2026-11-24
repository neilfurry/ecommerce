# Phase 1 report: Foundation

- Branch: `phase-1-foundation` (PR #1)
- Date: 2026-11-24
- Status: **Complete, awaiting review and approval.** Phase 2 has not been started.

## 1. Implemented features

**Monorepo and tooling**

- pnpm workspace with 5 apps and 5 shared packages. TypeScript 6 strict mode everywhere.
- ESLint 10 (typescript-eslint, React Hooks rules), Prettier, EditorConfig, `.gitattributes`
  (CRLF for `.ps1`), VS Code recommended extensions and settings.
- GitHub Actions CI with three jobs: quality (typecheck, lint, format, unit tests, build);
  integration (migration drift check, migrate, seed, API e2e, worker integration, Playwright);
  and scripts (PowerShell scripts and `docker-compose.yml` end to end).

**API (`apps/api`, NestJS 12)**

- Zod-validated environment configuration with a typed `AppConfig`. Start-up fails fast and lists
  every invalid variable without printing secret values.
- Prisma 7 with the `pg` driver adapter. First migration: `currencies` reference table with
  database `CHECK` constraints. Idempotent seed (PHP).
- Health endpoints: liveness, and readiness checking PostgreSQL, Redis, S3 storage (bucket
  reachable) and the worker heartbeat. Each check has a 3 s timeout. Returns 503 when a critical
  component is down and `degraded` when only the worker is down.
- HTTP pipeline: helmet security headers, CORS allowlist with credentials, 1 MB body limit, URI
  versioning (`/api/v1`), cookie parser, graceful shutdown.
- Standard error envelope `{ error: { code, message, statusCode, requestId, fieldErrors? } }` for
  every error (404s, validation, malformed JSON, oversized bodies, rate limiting, unknown errors).
  Internal details never reach clients.
- `ZodValidationPipe` that uses the shared schemas (ready for Phase 2 endpoints).
- Swagger/OpenAPI at `/api/docs`, generated from the same Zod schemas.
- Redis-backed global rate limiting with an atomic Lua script, shared by all API instances.
- Structured pino logging with request ids (safe incoming ids reused) and redaction of
  authorization headers, cookies, passwords, tokens, card numbers, CVVs and account numbers.
- Infrastructure modules for Prisma, Redis, S3 storage (bucket auto-created in development only)
  and BullMQ producers.

**Worker (`apps/worker`)**

- NestJS application context with BullMQ: the `system` queue, an idempotent job scheduler and a
  heartbeat processor. This proves the whole Redis → BullMQ → worker path, and the API reports
  it. Unknown jobs fail loudly. Concurrency is configurable.

**Frontends (`apps/storefront`, `apps/seller-portal`, `apps/admin-portal`)**

- React 19, React Router 8, TanStack Query 5, Tailwind CSS 4, shadcn/ui components, Inter font.
- Storefront: responsive header and footer, launch landing page, live **System status** page,
  404 page.
- Seller Center and Admin Console: responsive sidebar layout (fixed on desktop, slide-out sheet
  on mobile), skip-to-content link, live **System status / System health** page with refresh,
  loading skeleton, error state with request id, and stale-data notice.
- Router error boundary. Production bundles are split into cached vendor chunks.

**Shared packages**

- `types`: API error codes, error envelope, pagination, health and money types.
- `validation`: Zod schemas for decimal-string money (rejects JS numbers), ISO 4217 currency,
  pagination, health responses, error envelope, and env-variable helpers.
- `config`: queue names, Redis key namespace, PHP/en-PH/Asia-Manila defaults, ports.
- `api-client`: typed fetch client (validates every response, `ApiError` with code and request
  id, cookies included), React provider, `useSystemHealth`, QueryClient defaults (no retries on
  4xx).
- `ui`: design tokens (light and dark), Button, Card, Badge, Alert, Skeleton, Separator, Sheet,
  Toaster, plus SidebarLayout, PageHeader, EmptyState, ErrorState, NotFound, RouteError,
  BrandMark and SystemStatusPanel.

**Developer environment**

- `docker-compose.yml`: PostgreSQL 17, Redis 7 (AOF, `noeviction` for BullMQ), MinIO (Chainguard
  image, configurable). Health checks; ports bound to `127.0.0.1`.
- PowerShell scripts: `setup`, `dev`, `test`, `reset-db` (refuses non-localhost databases),
  `backup-db` (with retention), `restore-db`. Windows Task Scheduler instructions for automatic
  daily backups.
- Documentation: README, Windows setup, troubleshooting, architecture, roadmap, 7 ADRs.

## 2. Files

All 203 files in the branch are new except `README.md` and `.gitignore` (replaced). The full
list is in the PR's **Files changed** tab. Grouped:

| Area           | Files                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root config    | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.react.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitattributes`, `.gitignore`*, `.npmrc`, `.nvmrc`, `.env.example`, `jest.nest-preset.cjs`, `vite.shared.mts`, `vitest.setup.ts`, `playwright.config.ts`, `docker-compose.yml`, `.vscode/*`, `.github/workflows/ci.yml` |
| API            | `apps/api/{package.json,nest-cli.json,tsconfig*.json,jest.config.js,prisma.config.ts}`; `prisma/{schema.prisma,seed.ts,migrations/**}`; `src/{main,bootstrap,app.module}.ts`; `src/config/*`; `src/common/{errors,validation,openapi}/*`; `src/infrastructure/{prisma,redis,storage,queue,throttling,logging}/*`; `src/modules/health/*`; `test/*`                                                         |
| Worker         | `apps/worker/{package.json,nest-cli.json,tsconfig*.json,jest.config.js}`; `src/{main,worker.module,redis.provider}.ts`; `src/config/*`; `src/heartbeat/*`; `test/*`                                                                                                                                                                                                                                        |
| Frontends (×3) | `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, `public/favicon.svg`, `src/{main.tsx,styles.css,vite-env.d.ts}`, `src/app/{api.ts,providers.tsx,routes.tsx,routes.test.tsx}`, `src/pages/*`, storefront `src/layouts/store-layout.tsx`                                                                                                                                                    |
| Packages       | `packages/{types,validation,config}/{package.json,tsconfig*.json,src/**}`; `packages/api-client/{package.json,tsconfig.json,vitest.config.ts,src/**}`; `packages/ui/{package.json,tsconfig.json,vitest.config.ts,src/{components,layouts,patterns,styles,lib,test}/**}`                                                                                                                                    |
| Scripts        | `scripts/{setup,dev,test,reset-db,backup-db,restore-db}.ps1`, `scripts/lib/common.ps1`                                                                                                                                                                                                                                                                                                                     |
| E2E            | `e2e/system-status.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                |
| Docs           | `README.md`*, `docs/{windows-setup,troubleshooting,architecture,roadmap}.md`, `docs/adr/0001…0007`, `docs/phases/phase-1-foundation.md`                                                                                                                                                                                                                                                                    |

\* modified

## 3. Database changes

Migration `20261124090000_init_foundation`:

| Table        | Columns                                                                                                                                           | Constraints                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `currencies` | `code CHAR(3)` PK, `name VARCHAR(64)`, `symbol VARCHAR(8)`, `minor_units SMALLINT`, `is_active BOOLEAN`, `created_at`/`updated_at TIMESTAMPTZ(3)` | `CHECK code ~ '^[A-Z]{3}$'`, `CHECK minor_units BETWEEN 0 AND 4` |

Seed: `PHP`, Philippine Peso, `₱`, 2 minor units, active. Every future monetary column will
reference this table ([ADR 0004](../adr/0004-money-and-currency.md)). The migration SQL was
checked against `schema.prisma` with `prisma migrate diff`: no difference.

## 4. API endpoints

| Method | Path                  | Auth | Purpose                                      |
| ------ | --------------------- | ---- | -------------------------------------------- |
| GET    | `/api/v1/health`      | none | Readiness + per-component status (200 / 503) |
| GET    | `/api/v1/health/live` | none | Liveness (exempt from rate limiting)         |
| GET    | `/api/docs`           | none | Swagger UI (when `SWAGGER_ENABLED=true`)     |
| GET    | `/api/docs-json`      | none | OpenAPI 3 document                           |

## 5. Environment variables

Documented in `.env.example` and [windows-setup.md §4](../windows-setup.md#4-environment-configuration):
`API_PORT`, `CORS_ORIGINS`, `TRUST_PROXY`, `LOG_LEVEL`, `RATE_LIMIT_WINDOW_SECONDS`,
`RATE_LIMIT_MAX_REQUESTS`, `SWAGGER_ENABLED`, `APP_VERSION` (optional), `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `DATABASE_URL`, `SHADOW_DATABASE_URL`
(optional), `REDIS_PORT`, `REDIS_URL`, `MINIO_IMAGE`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`,
`MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_AUTO_CREATE_BUCKET`,
`WORKER_CONCURRENCY`, `WORKER_HEARTBEAT_INTERVAL_SECONDS`, `VITE_API_BASE_URL`,
`VITE_API_PROXY_TARGET`. `NODE_ENV` is deliberately not set in `.env` (see the file's comment).

## 6. Windows PowerShell commands

```powershell
git clone https://github.com/neilfurry/ecommerce.git
cd ecommerce
git checkout phase-1-foundation          # until PR #1 is merged
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
.\scripts\dev.ps1
pnpm exec playwright install chromium    # once, before browser tests
.\scripts\test.ps1
```

## 7. Test results

All results below come from runs that actually executed. Final CI run: GitHub Actions run
`45367791034` on commit `8d4fbbf`, all three jobs green.

| Suite                                          | Where it ran                                      | Result                                                        |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Unit: `@marketplace/config`                    | CI + build workspace                              | 3 passed                                                      |
| Unit: `@marketplace/validation`                | CI + build workspace                              | 45 passed                                                     |
| Unit: `@marketplace/api-client`                | CI + build workspace                              | 15 passed                                                     |
| Unit: `@marketplace/ui`                        | CI + build workspace                              | 10 passed                                                     |
| Unit: API                                      | CI (26 passed); build workspace 18 of 26*         | 26 passed                                                     |
| Unit: worker                                   | CI + build workspace                              | 4 passed                                                      |
| Unit: storefront / seller / admin              | CI + build workspace                              | 4 / 5 / 5 passed                                              |
| **Unit total**                                 |                                                   | **117 passed, 0 failed**                                      |
| API e2e (real Postgres, Redis, MinIO)          | CI (twice: service containers and docker compose) | 19 passed                                                     |
| Worker integration (real Redis + BullMQ)       | CI + build workspace                              | 2 passed                                                      |
| Playwright (desktop + Pixel 7)                 | CI                                                | 8 passed, 1 skipped†                                          |
| Migration drift (`prisma migrate diff`)        | CI                                                | No difference detected                                        |
| PowerShell scripts + docker compose            | CI (PowerShell 7 on Linux)                        | setup, test integration, backup, restore, reset all succeeded |
| Typecheck, ESLint, Prettier, production builds | CI + build workspace                              | Clean                                                         |

\* The build workspace cannot download Prisma's engine, so the 8 tests in
`health.service.spec.ts`, which import the generated client, ran only in CI.
† The mobile-navigation test runs only in the mobile project and is skipped on desktop by design.

Also checked by hand: built worker started and wrote heartbeats to Redis; desktop and phone
screenshots of all three apps, with no console errors.

## 8. Remaining issues and limitations

1. **Not executed on Windows itself.** The scripts were run with PowerShell 7 on Linux in CI.
   Windows PowerShell 5.1 and Docker Desktop on your PC have not been exercised; they are
   acceptance items 1 and 2 below.
2. **No sign-in yet.** All Phase 1 endpoints are intentionally public. The health endpoint
   exposes only component names, up/down status and latency. Authentication, RBAC and CSRF
   protection arrive in Phase 2.
3. **Portals show only the system status page.** By design: navigation lists only working
   pages, and later phases add their sections.
4. **MinIO upstream is archived.** Development uses Chainguard's maintained image. Production
   storage is decided in Phase 10 ([ADR 0007](../adr/0007-object-storage.md)).
5. **Playwright on Windows needs a one-time** `pnpm exec playwright install chromium`.
6. **Bundle size.** About 165 kB gzipped across chunks, mostly React, React Router and Zod.
   Route-level code splitting will be added as pages grow.

## 9. Acceptance criteria

1. `.\scripts\setup.ps1` completes on your Windows 11 PC and prints "Setup complete."
2. `docker compose ps` shows `postgres` and `redis` as healthy and `minio` as running.
3. `.\scripts\dev.ps1` starts all five apps without errors.
4. http://localhost:5175 redirects to **System health** and shows all four components **Up**
   within 20 seconds.
5. Stopping the worker turns the status **Degraded** within about 60 seconds. Stopping
   PostgreSQL (`docker compose stop postgres`) makes `/api/v1/health` return 503 and the page shows
   **Service disruption**.
6. http://localhost:3000/api/docs lists both health endpoints with response schemas.
7. http://localhost:5173 renders the storefront; resizing to phone width keeps it usable. The
   seller portal's menu button opens the navigation sheet.
8. `.\scripts\test.ps1` passes (typecheck, lint, unit, integration and browser tests).
9. `.\scripts\backup-db.ps1` creates a file in `.\backups`, and `.\scripts\restore-db.ps1 -File <it>`
   restores it.
10. `pnpm db:migrate` reports the schema is in sync (no new migration created).

## 10. Dependencies on the next phase

Phase 2 (identity and access) builds directly on:

- `ZodValidationPipe`, the error envelope and `zodToOpenApi` for the sign-up and sign-in
  endpoints;
- `RedisThrottlerStorage` for stricter `@Throttle` limits on sign-in, password reset and refresh;
- `REDACTED_LOG_PATHS`, which already covers password and token fields;
- cookie parser and CORS-with-credentials, ready for HTTP-only refresh cookies;
- `api-client` (`credentials: 'include'`) and `ui` (`SidebarLayout.headerActions` for the user
  menu);
- the UUID, timestamp and constraint conventions in ADR 0003 for the `users`, `roles`,
  `permissions`, `sessions` and `audit_logs` tables.

Decisions needed before Phase 2 starts:

1. Which roles may sign up themselves (customers? sellers?) and which only an admin can create.
2. Whether customers sign in with email only, or also with a Philippine mobile number and OTP
   (SMS needs a provider; a mock adapter would be built first).
