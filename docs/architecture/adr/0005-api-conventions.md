# ADR 0005: REST API conventions

- Status: Accepted
- Date: 2026-11-24

## Decision

- **Paths:** `/api/v{n}/<resource>` (URI versioning, default `v1`). Plural nouns, kebab-case.
- **Validation:** request bodies, params and queries are validated with **Zod schemas from
  `@marketplace/validation`**. The global `ZodGlobalValidationPipe` validates parameters typed with a
  `createZodDto(schema)` class, and `ZodValidationPipe` handles one-off schemas. These are the same schemas the frontends use for
  forms. NestJS 12 also offers `StandardSchemaValidationPipe`. We use our own pipe because it
  produces our error envelope with per-field errors.
- **OpenAPI:** Swagger at `/api/docs` (JSON at `/api/docs-json`). Response and request schemas are
  generated from the Zod schemas with `zodToOpenApi()` (Zod 4 `toJSONSchema`, OpenAPI 3.0 target),
  so documentation cannot drift from validation. Swagger is enabled with `SWAGGER_ENABLED`.
- **Errors:** every non-2xx response is
  `{ "error": { "code", "message", "statusCode", "requestId", "fieldErrors"? } }`. Clients branch
  on `code` (a closed list in `@marketplace/shared-types`). Unknown errors are a generic `INTERNAL_ERROR`;
  details go to logs only.
- **Pagination:** `?page=&pageSize=` (max 100), responses `{ items, page, pageSize, totalItems,
totalPages }`.
- **Request ids:** `X-Request-Id` on every response and in error bodies. A well-formed incoming
  id is reused for tracing across services.
- **Rate limiting:** global per-IP limit stored in Redis (`RedisThrottlerStorage`, atomic Lua
  script). Sensitive endpoints (login, password reset, checkout) add stricter `@Throttle` limits.
- **Security headers:** `helmet` defaults. The CSP is relaxed only for the Swagger UI path.

## Consequences

Frontends get typed, validated responses through `@marketplace/api-client` and a single error
shape to handle.
