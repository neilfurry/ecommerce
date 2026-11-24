# API reference and conventions

Interactive documentation, generated from the same Zod schemas that validate requests:
**http://localhost:3000/api/docs** (OpenAPI JSON at `/api/docs-json`). Swagger is served when
`SWAGGER_ENABLED=true`.

## Conventions

| Topic          | Rule                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Base path      | `/api/v{n}`, currently `v1` (URI versioning)                                                                  |
| Resources      | Plural nouns, kebab-case: `/api/v1/stored-files`, `/api/v1/dead-letters`                                      |
| Format         | JSON, UTF-8. Money is a decimal string (`"1499.50"`), never a number                                          |
| Time           | ISO 8601 UTC (`2026-11-24T09:00:00.000Z`)                                                                     |
| Ids            | UUIDv7 strings                                                                                                |
| Pagination     | `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, totalItems, totalPages }`                         |
| Validation     | Shared Zod schemas from `@marketplace/validation`, applied by the global pipe                                 |
| Authentication | Every route requires a signed-in user unless marked `@Public()` (sign-in arrives in Phase 2)                  |
| Rate limit     | `RATE_LIMIT_MAX_REQUESTS` per `RATE_LIMIT_WINDOW_SECONDS` per IP. Exceeding it returns 429 with `Retry-After` |
| Tracing        | Every response carries `X-Request-Id`. A well-formed incoming id is reused                                    |
| Status codes   | 200 read/update · 201 create · 202 queued for background processing · 204 delete                              |

### Error envelope

Every non-2xx response has the same shape. Clients branch on `code`, never on `message`.

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed.",
    "statusCode": 400,
    "requestId": "8f0c6f1e-6a7d-4c0e-9d0b-3c3e9e1f2a10",
    "fieldErrors": [{ "path": "message", "message": "Enter a message" }]
  }
}
```

| Code                     | HTTP | Meaning                                                 |
| ------------------------ | ---- | ------------------------------------------------------- |
| `BAD_REQUEST`            | 400  | Malformed request (e.g. invalid JSON)                   |
| `VALIDATION_FAILED`      | 400  | Schema validation failed; see `fieldErrors`             |
| `UNAUTHENTICATED`        | 401  | Sign-in required                                        |
| `FORBIDDEN`              | 403  | Signed in but not allowed                               |
| `NOT_FOUND`              | 404  | Unknown route or resource                               |
| `CONFLICT`               | 409  | State conflict (e.g. duplicate)                         |
| `PAYLOAD_TOO_LARGE`      | 413  | Body or upload over the limit                           |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | File content type not allowed                           |
| `RATE_LIMITED`           | 429  | Too many requests                                       |
| `SERVICE_UNAVAILABLE`    | 503  | A dependency is down                                    |
| `INTERNAL_ERROR`         | 500  | Unexpected error (details only in logs, by `requestId`) |

### Adding an endpoint

```ts
// packages/validation/src/<domain>.ts — shared with the frontend form
export const createThingSchema = z.object({ name: z.string().min(1).max(120) });

// apps/api/src/modules/<domain>/<domain>.dtos.ts
export class CreateThingDto extends createZodDto(createThingSchema) {}

// apps/api/src/modules/<domain>/<domain>.controller.ts
@Post()
@Roles('ADMIN')                                   // omit for any signed-in user; @Public() for anonymous
@ApiBody({ schema: CreateThingDto.openApiSchema })
@ApiCreatedResponse({ schema: zodToOpenApi(thingSchema) })
create(@Body() body: CreateThingDto, @CurrentUser() user: AuthenticatedUser) {
  return this.things.create(body, user);          // body is already validated and parsed
}
```

## Endpoints (Phase 1)

### Health (public)

| Method | Path                  | Description                                                                                                                                                                                                                                                                             |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/health`      | Readiness: `status` (`ok`/`degraded`/`down`), `version`, `uptimeSeconds`, `timestamp` and per-component status, latency and safe message for `database`, `redis`, `storage`, `worker`. 200, or 503 when a critical component is down. Never exposes connection strings or error details |
| GET    | `/api/v1/health/live` | Liveness: `{ status: "ok", timestamp }`. No dependency checks; not rate limited                                                                                                                                                                                                         |

Example `GET /api/v1/health`:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 3725,
  "timestamp": "2026-11-24T09:00:00.000Z",
  "components": [
    { "name": "database", "status": "up", "critical": true, "latencyMs": 3 },
    { "name": "redis", "status": "up", "critical": true, "latencyMs": 1 },
    { "name": "storage", "status": "up", "critical": true, "latencyMs": 11 },
    { "name": "worker", "status": "up", "critical": false, "latencyMs": 1 }
  ]
}
```

### Developer tools (development only)

Available only when `DEV_TOOLS_ENABLED=true`. The API refuses that setting when
`NODE_ENV=production`, and when disabled every route below answers 404. They are public until
Phase 2, which restricts them to `SUPER_ADMIN`.

| Method | Path                                  | Description                                                                                                                      |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/dev/jobs/sample`             | Queue the sample job `{ message, simulateFailures (0–5), durationMs (0–10000) }` → 202 `{ queue, jobId }`                        |
| POST   | `/api/v1/dev/jobs/test-email`         | Queue a test email `{ to }` → 202 `{ queue, jobId }`                                                                             |
| GET    | `/api/v1/dev/jobs/{queue}/{jobId}`    | Job state, attempts, progress, result or last error                                                                              |
| GET    | `/api/v1/dev/queues`                  | Every queue with retry policy and job counts                                                                                     |
| GET    | `/api/v1/dev/dead-letters`            | Permanently failed jobs, newest first (paginated)                                                                                |
| POST   | `/api/v1/dev/dead-letters/{id}/retry` | Re-queue on the original queue and remove the dead letter → 202                                                                  |
| DELETE | `/api/v1/dev/dead-letters/{id}`       | Discard permanently → 204                                                                                                        |
| POST   | `/api/v1/dev/files`                   | Upload (multipart field `file`; PNG, JPEG, GIF, WebP, PDF or text, checked by content; ≤ `UPLOAD_MAX_BYTES`) → 201 file metadata |
| GET    | `/api/v1/dev/files`                   | Uploaded files, newest first (paginated)                                                                                         |
| GET    | `/api/v1/dev/files/{id}`              | File metadata: name, type, size, SHA-256, status, timestamps                                                                     |
| GET    | `/api/v1/dev/files/{id}/download-url` | Short-lived signed URL `{ url, expiresAt }` for direct download                                                                  |
| GET    | `/api/v1/dev/files/{id}/content`      | Download through the API (streamed, `Content-Disposition: attachment`)                                                           |
| DELETE | `/api/v1/dev/files/{id}`              | Delete from storage; metadata kept as `DELETED` → 204                                                                            |

### Documentation

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| GET    | `/api/docs`      | Swagger UI         |
| GET    | `/api/docs-json` | OpenAPI 3 document |
