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

API e2e tests create their own users directly in the database and give each test client its
own address (`X-Forwarded-For` with `TRUST_PROXY=1`), so per-address limits never leak between
tests. They read SMS codes and email links from the queued jobs; Playwright reads them from the
SMS outbox and Mailpit, like a developer would. Playwright signs in to the staff apps once
(`e2e/auth.setup.ts`, using the seeded demo accounts) and reuses the saved cookies.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Quality:** install, typecheck, lint, Prettier check, all unit tests, production builds.
2. **Integration:** PostgreSQL, Redis, Mailpit and MinIO containers; migration drift check,
   migrate, seed, API e2e, worker integration, Playwright (HTML report uploaded on failure).
3. **Scripts:** the PowerShell scripts (`setup`, `test -Suite integration`, `backup`, `restore`,
   `reset`, `start -InfraOnly`, `stop -RemoveData`) run with PowerShell 7 against the real
   `docker/docker-compose.yml`.

A phase is complete only when all three jobs are green.

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
