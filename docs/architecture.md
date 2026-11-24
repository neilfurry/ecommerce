# Architecture overview

## Shape of the system

```
 Browser                         Server side                                   Data
┌───────────────┐   /api   ┌──────────────────────────────┐            ┌──────────────┐
│ Storefront    │─────────▶│  API  (NestJS modular        │──Prisma──▶ │ PostgreSQL   │
│ Seller Center │  JSON +  │        monolith)             │            └──────────────┘
│ Admin Console │  cookies │  health · auth* · sellers*   │──ioredis─▶ ┌──────────────┐
└───────────────┘          │  catalog* · orders* · ...    │            │ Redis        │
                           └──────────┬───────────────────┘            │ cache, rate  │
                                      │ enqueue (BullMQ)               │ limits, jobs │
                           ┌──────────▼───────────────────┐            └──────────────┘
                           │  Worker (NestJS, no HTTP)    │──────────▶ ┌──────────────┐
                           │  heartbeat · notifications*  │   S3 API   │ MinIO / S3   │
                           │  settlements* · reports*     │            └──────────────┘
                           └──────────────────────────────┘
                                                        * delivered in later phases
```

- **One API process type**, organized by business domain (`apps/api/src/modules/<domain>`). It is
  stateless, so any number of instances can run behind a load balancer. Rate limits live in Redis
  so every instance shares them.
- **One worker process type** for slow or retryable work. It is deployed and scaled separately
  from the API. Producers (API) and consumers (worker) share queue names from `@marketplace/config`.
- **Three independent frontends**, each a static Vite build. They never contain business rules.
  They call the API through `@marketplace/api-client`, which validates every response against
  shared Zod schemas.

## Backend layering

```
apps/api/src
├── main.ts / bootstrap.ts     HTTP pipeline: helmet, CORS, body limits, versioning, Swagger, errors
├── config/                    Zod-validated environment → typed AppConfig (fails fast at start-up)
├── common/                    Cross-cutting: error envelope, Zod validation pipe, OpenAPI helpers
├── infrastructure/            Technical adapters (global modules): prisma, redis, storage, queue,
│                              throttling, logging. Domain modules depend on these, not vice versa.
└── modules/<domain>/          Business domains: controller (HTTP) → service (rules) → Prisma
```

Rules that every domain module follows (enforced in review):

1. Controllers only translate HTTP: parse with `ZodValidationPipe`, call a service, return a DTO.
2. Services own business rules and run multi-step writes inside `prisma.$transaction`.
3. A module accesses another module's tables only through that module's exported service.
4. Seller-scoped queries always filter by the authenticated seller's id (Phase 2/3 guards).
5. Money is `Decimal` in the database and a decimal string in JSON ([ADR 0004](adr/0004-money-and-currency.md)).

## Request lifecycle

1. `pino-http` assigns a request id (reusing a safe incoming `X-Request-Id`) and returns it in the
   response header.
2. `helmet` sets security headers. CORS allows only the configured origins, with credentials.
3. Express parses JSON (1 MB limit).
4. The Redis-backed `ThrottlerGuard` enforces the per-IP rate limit.
5. The controller runs. Input is validated by Zod schemas from `@marketplace/validation`.
6. Any error becomes the standard envelope
   `{ error: { code, message, statusCode, requestId, fieldErrors? } }`. Unknown errors become a
   generic 500 and are logged with the request id.

## Shared packages

| Package                  | Consumed by           | Build                                           |
| ------------------------ | --------------------- | ----------------------------------------------- |
| `@marketplace/types`     | all                   | `tsc` → CommonJS `dist/` (API/worker); source for Vite |
| `@marketplace/validation`| all                   | same                                            |
| `@marketplace/config`    | all                   | same                                            |
| `@marketplace/api-client`| frontends             | source only (Vite)                              |
| `@marketplace/ui`        | frontends             | source only (Vite + Tailwind `@source`)         |

Vite and Vitest resolve the custom `source` export condition, so frontends always use live
TypeScript sources. Jest maps the packages to `src/` for the same reason.

## Health and observability

- `GET /api/v1/health/live`: liveness, no dependency checks.
- `GET /api/v1/health`: readiness. It returns 200 when the database, Redis and storage are up,
  503 otherwise. The worker is non-critical; when it is down the status is `degraded`. The worker
  proves the whole queue pipeline by processing a scheduled heartbeat job every 15 s.
- Structured JSON logs (pino) with secrets redacted, correlated by request id.

See the [decision records](adr/) for the reasoning behind each choice.
