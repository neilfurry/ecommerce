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
| Authentication | Every route requires a signed-in user unless marked `@Public()`. See _Authentication_ below                   |
| Rate limit     | `RATE_LIMIT_MAX_REQUESTS` per `RATE_LIMIT_WINDOW_SECONDS` per IP. Exceeding it returns 429 with `Retry-After` |
| Tracing        | Every response carries `X-Request-Id`. A well-formed incoming id is reused                                    |
| Status codes   | 200 read/update · 201 create · 202 queued for background processing · 204 delete                              |

### Authentication

Browsers authenticate with HttpOnly cookies set by the sign-in endpoints (ADR 0010). Every
request must also say which app it comes from, and state-changing requests must carry the CSRF
token:

| Header         | Value                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| `X-Client-App` | `storefront`, `seller` or `admin`: selects the session cookies and who may sign in there |
| `X-CSRF-Token` | For POST, PUT, PATCH and DELETE: the token from `GET /api/v1/auth/csrf`                  |

`@marketplace/api-client` does all of this, including refreshing once on `401 TOKEN_EXPIRED`.
Authentication errors: `UNAUTHENTICATED` (401, sign in), `TOKEN_EXPIRED` (401, refresh),
`INVALID_CREDENTIALS` (401), `ACCOUNT_LOCKED` (423), `ACCOUNT_SUSPENDED` (403),
`EMAIL_NOT_VERIFIED` (403), `OTP_INVALID` / `OTP_EXPIRED` / `OTP_TOO_MANY_ATTEMPTS` (400),
`CSRF_FAILED` (403), `FORBIDDEN` (403, missing role or permission), `RATE_LIMITED` (429).

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

## Endpoints

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
`NODE_ENV=production`, and when disabled every route below answers 404. Every route requires
the `dev-tools.use` permission (super admin by default).

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
| GET    | `/api/v1/dev/sms-outbox`              | Texts captured by the mock SMS provider, newest first (at most 50) `{ messages: [{ to, body, sentAt }] }`                        |

### Authentication (`/api/v1/auth`)

Public unless marked _signed in_. Sign-in, sign-up and code endpoints have strict per-address
limits (10 or 5 per minute).

| Method | Path                                 | Description                                                                                                                                                                                                                                              |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/auth/csrf`                         | `{ csrfToken }` and the matching cookie                                                                                                                                                                                                                  |
| POST   | `/auth/customers/sign-up`            | Storefront only. `{ firstName, lastName, email, mobile, password, accountType: RETAIL\|WHOLESALE, business? }` → 202 SMS challenge `{ challengeId, destination, expiresAt, resendAvailableAt }`. 409 with field errors when the email or number is taken |
| POST   | `/auth/customers/sign-up/verify`     | `{ challengeId, code }` → 201 session; creates the account (and the wholesale application) and emails a confirmation link                                                                                                                                |
| POST   | `/auth/otp/resend`                   | `{ challengeId }` → new challenge (after 60 s; max 3 per challenge, 5 per number per hour)                                                                                                                                                               |
| POST   | `/auth/customers/sign-in/otp`        | `{ mobile }` → 202 challenge. Same answer for unknown numbers, but nothing is sent                                                                                                                                                                       |
| POST   | `/auth/customers/sign-in/otp/verify` | `{ challengeId, code }` → session                                                                                                                                                                                                                        |
| POST   | `/auth/sign-in`                      | `{ email, password }` → session, for every app; the account must hold a role allowed in the app named by `X-Client-App`                                                                                                                                  |
| POST   | `/auth/refresh`                      | Rotates the refresh token → session. 409: another tab refreshed at the same moment (retry the request). 401: sign in again                                                                                                                               |
| POST   | `/auth/sign-out`                     | Ends this device's session → 204 (works with an expired access token)                                                                                                                                                                                    |
| POST   | `/auth/sign-out-everywhere`          | _Signed in._ Ends every session of the account → 204                                                                                                                                                                                                     |
| GET    | `/auth/session`                      | _Signed in._ `{ user: { id, names, email, emailVerified, mobile, mobileVerified, roles, permissions, wholesaleStatus }, app, accessTokenExpiresAt }`                                                                                                     |
| POST   | `/auth/email/verify`                 | `{ token }` from the confirmation email → 204                                                                                                                                                                                                            |
| POST   | `/auth/email/resend-verification`    | _Signed in._ Emails a new confirmation link → 202                                                                                                                                                                                                        |
| POST   | `/auth/password/forgot`              | `{ email }` → 202, whether or not the account exists. The link works once and expires in 30 minutes                                                                                                                                                      |
| POST   | `/auth/password/reset`               | `{ token, password }` → 204; signs out every device                                                                                                                                                                                                      |
| POST   | `/auth/password/change`              | _Signed in._ `{ currentPassword, newPassword }` → 204; signs out other devices                                                                                                                                                                           |
| POST   | `/auth/invitations/accept`           | `{ token, password }` → 204; activates an invited staff account                                                                                                                                                                                          |

### Account (customers)

| Method | Path                                    | Description                                                                              |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/v1/account/wholesale-application` | `{ application }` (null if none)                                                         |
| POST   | `/api/v1/account/wholesale-application` | `{ businessName, tin, businessAddress }` → application; also resubmits after a rejection |

### Administration (Admin Console)

| Method | Path                                               | Permission              | Description                                                                                                                                         |
| ------ | -------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/admin/users`                              | `users.read`            | Accounts; filters `search` (name, email, mobile), `kind` (`staff`/`customers`), `role`, `status`; paginated                                         |
| POST   | `/api/v1/admin/users`                              | `users.create`          | `{ firstName, lastName, email, roles }` → 201 invited account; emails an invitation (7 days)                                                        |
| GET    | `/api/v1/admin/users/{id}`                         | `users.read`            | Account with signed-in device count and lock-out                                                                                                    |
| PATCH  | `/api/v1/admin/users/{id}`                         | `users.update`          | `{ firstName, lastName, roles }`. Staff roles only; only roles the caller may grant                                                                 |
| POST   | `/api/v1/admin/users/{id}/suspend`                 | `users.suspend`         | Blocks sign-in and ends every session at once. Not yourself; never the last super admin                                                             |
| POST   | `/api/v1/admin/users/{id}/reactivate`              | `users.suspend`         | Reactivates and clears any lock-out                                                                                                                 |
| POST   | `/api/v1/admin/users/{id}/sessions/revoke`         | `users.sessions.revoke` | Signs the account out everywhere → 204                                                                                                              |
| POST   | `/api/v1/admin/users/{id}/invitation/resend`       | `users.create`          | New invitation link; earlier links stop working → 204                                                                                               |
| GET    | `/api/v1/admin/roles`                              | `roles.read`            | Roles with permissions and account counts, and the permission catalog                                                                               |
| PUT    | `/api/v1/admin/roles/{code}/permissions`           | `roles.update`          | `{ permissions }` replaces the role's permissions (not `SUPER_ADMIN`); effective on the next request                                                |
| GET    | `/api/v1/admin/wholesale-applications`             | `wholesale.read`        | `?status=PENDING\|APPROVED\|REJECTED`; pending oldest first; paginated                                                                              |
| POST   | `/api/v1/admin/wholesale-applications/{id}/review` | `wholesale.review`      | `{ decision: APPROVE\|REJECT, note }` (note required to reject); approval grants `WHOLESALE_CUSTOMER`; emails the customer. 409 if already reviewed |
| GET    | `/api/v1/admin/audit-logs`                         | `audit.read`            | Newest first; filters `action`, `actorId`, `entityId`; paginated (50)                                                                               |

### Documentation

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| GET    | `/api/docs`      | Swagger UI         |
| GET    | `/api/docs-json` | OpenAPI 3 document |
