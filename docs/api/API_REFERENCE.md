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
| `INSUFFICIENT_STOCK`     | 409  | The change or reservation would make stock negative     |
| `SELLER_NOT_VERIFIED`    | 403  | Needs a verified (and not suspended) seller             |
| `NOT_READY`              | 422  | Something must be completed first (see `fieldErrors`)   |
| `RESERVATION_NOT_ACTIVE` | 409  | The stock reservation expired or was released           |
| `CHECKOUT_CHANGED`       | 409  | Total, prices, stock or coupons changed; quote again    |
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

| Method | Path                                              | Description                                                                                                                      |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/dev/jobs/sample`                         | Queue the sample job `{ message, simulateFailures (0–5), durationMs (0–10000) }` → 202 `{ queue, jobId }`                        |
| POST   | `/api/v1/dev/jobs/test-email`                     | Queue a test email `{ to }` → 202 `{ queue, jobId }`                                                                             |
| GET    | `/api/v1/dev/jobs/{queue}/{jobId}`                | Job state, attempts, progress, result or last error                                                                              |
| GET    | `/api/v1/dev/queues`                              | Every queue with retry policy and job counts                                                                                     |
| GET    | `/api/v1/dev/dead-letters`                        | Permanently failed jobs, newest first (paginated)                                                                                |
| POST   | `/api/v1/dev/dead-letters/{id}/retry`             | Re-queue on the original queue and remove the dead letter → 202                                                                  |
| DELETE | `/api/v1/dev/dead-letters/{id}`                   | Discard permanently → 204                                                                                                        |
| POST   | `/api/v1/dev/files`                               | Upload (multipart field `file`; PNG, JPEG, GIF, WebP, PDF or text, checked by content; ≤ `UPLOAD_MAX_BYTES`) → 201 file metadata |
| GET    | `/api/v1/dev/files`                               | Uploaded files, newest first (paginated)                                                                                         |
| GET    | `/api/v1/dev/files/{id}`                          | File metadata: name, type, size, SHA-256, status, timestamps                                                                     |
| GET    | `/api/v1/dev/files/{id}/download-url`             | Short-lived signed URL `{ url, expiresAt }` for direct download                                                                  |
| GET    | `/api/v1/dev/files/{id}/content`                  | Download through the API (streamed, `Content-Disposition: attachment`)                                                           |
| DELETE | `/api/v1/dev/files/{id}`                          | Delete from storage; metadata kept as `DELETED` → 204                                                                            |
| GET    | `/api/v1/dev/sms-outbox`                          | Texts captured by the mock SMS provider, newest first (at most 50) `{ messages: [{ to, body, sentAt }] }`                        |
| POST   | `/api/v1/dev/inventory/reservations`              | Reserve stock for a pretend checkout `{ checkoutReference, items: [{ variantId, quantity }], ttlMinutes }` → 201                 |
| POST   | `/api/v1/dev/inventory/reservations/{id}/release` | Give the stock back                                                                                                              |
| POST   | `/api/v1/dev/inventory/reservations/{id}/convert` | Turn the reservation into a stock deduction (`SALE` ledger row)                                                                  |
| POST   | `/api/v1/dev/inventory/reservations/expire`       | Run the expiry sweep now (the worker runs it every minute) → `{ expired }`                                                       |

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
| POST   | `/auth/customers/sign-in/otp/verify` | `{ challengeId, code }` → session, or an MFA challenge as for `/auth/sign-in`                                                                                                                                                                            |
| POST   | `/auth/sign-in`                      | `{ email, password }` → session, for every app; the account must hold a role allowed in the app named by `X-Client-App`. With two-step verification on: `{ mfaRequired: true, mfaToken, expiresAt }` and no cookies                                      |
| POST   | `/auth/mfa/verify`                   | `{ mfaToken, code }` (6-digit authenticator code or a recovery code) → session. The challenge lasts 5 minutes and allows 5 attempts                                                                                                                      |
| POST   | `/auth/sellers/sign-up`              | Seller Center only. `{ firstName, lastName, email, password, mobile, businessName, businessType }` → 201 session. Creates the owner account and a `PENDING` seller; emails a confirmation link                                                           |
| POST   | `/auth/seller-invitations/preview`   | `{ token }` → `{ sellerName, email, roles, existingAccount, expiresAt }`. 404 for an unknown, used or expired invitation                                                                                                                                 |
| POST   | `/auth/seller-invitations/accept`    | `{ token, firstName?, lastName?, password }` → 204. New people create an account; people with an account confirm its password. Refused for marketplace staff and for people already in a seller                                                          |
| POST   | `/auth/refresh`                      | Rotates the refresh token → session. 409: another tab refreshed at the same moment (retry the request). 401: sign in again                                                                                                                               |
| POST   | `/auth/sign-out`                     | Ends this device's session → 204 (works with an expired access token)                                                                                                                                                                                    |
| POST   | `/auth/sign-out-everywhere`          | _Signed in._ Ends every session of the account → 204                                                                                                                                                                                                     |
| GET    | `/auth/session`                      | _Signed in._ `{ user: { id, names, email, emailVerified, mobile, mobileVerified, roles, permissions, wholesaleStatus, mfaEnabled, seller }, app, accessTokenExpiresAt }`; `seller` (Seller Center only) is `{ id, businessName, status, isOwner }`       |
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

### Two-step verification (`/api/v1/auth/mfa`, signed in, every app)

Optional for every account (ADR 0014). The authenticator secret is stored encrypted
(`AUTH_MFA_ENCRYPTION_KEY`); recovery codes are stored hashed and shown once.

| Method | Path                       | Description                                                                         |
| ------ | -------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/auth/mfa`                | `{ enabled, enabledAt, recoveryCodesRemaining }`                                    |
| POST   | `/auth/mfa/totp/setup`     | `{ password }` → `{ secret, otpauthUrl }` for the QR code. Not active until enabled |
| POST   | `/auth/mfa/totp/enable`    | `{ code }` → `{ recoveryCodes }` (10, shown once)                                   |
| POST   | `/auth/mfa/recovery-codes` | `{ code }` → new `{ recoveryCodes }`; the old ones stop working                     |
| POST   | `/auth/mfa/disable`        | `{ password, code }` → 204                                                          |

Errors: `OTP_INVALID` (400, wrong or reused code), `OTP_TOO_MANY_ATTEMPTS` (400, sign in again).

### Users, roles and permissions (Admin Console)

| Method | Path                                         | Permission              | Description                                                                                                                                         |
| ------ | -------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/users`                              | `users.read`            | Accounts; filters `search` (name, email, mobile), `kind` (`staff`/`customers`), `role`, `status`; paginated                                         |
| POST   | `/api/v1/users`                              | `users.create`          | `{ firstName, lastName, email, roles }` → 201 invited staff account; emails an invitation (7 days)                                                  |
| GET    | `/api/v1/users/{id}`                         | `users.read`            | Account with signed-in device count, lock-out, `mfaEnabled` and seller membership                                                                   |
| PATCH  | `/api/v1/users/{id}`                         | `users.update`          | `{ firstName, lastName, roles }`. Marketplace staff roles only; only roles the caller may grant                                                     |
| POST   | `/api/v1/users/{id}/suspend`                 | `users.suspend`         | Blocks sign-in and ends every session at once. Not yourself; never the last super admin                                                             |
| POST   | `/api/v1/users/{id}/reactivate`              | `users.suspend`         | Reactivates and clears any lock-out                                                                                                                 |
| POST   | `/api/v1/users/{id}/sessions/revoke`         | `users.sessions.revoke` | Signs the account out everywhere → 204                                                                                                              |
| POST   | `/api/v1/users/{id}/mfa/reset`               | `users.update`          | Turns two-step verification off (lost phone and recovery codes) and signs the account out → 204. Audited                                            |
| POST   | `/api/v1/users/{id}/invitation/resend`       | `users.create`          | New invitation link; earlier links stop working → 204                                                                                               |
| GET    | `/api/v1/roles`                              | `roles.read`            | Roles with `scope` (`platform`/`seller`/`customer`), `locked`, permissions and account counts, and the permission catalog                           |
| PUT    | `/api/v1/roles/{code}/permissions`           | `roles.update`          | `{ permissions }` replaces the role's permissions; only permissions of the role's own scope (400 otherwise); not the locked roles                   |
| GET    | `/api/v1/permissions`                        | `roles.read`            | The catalog: `{ permissions: [{ code, description, scope, roles }] }`                                                                               |
| GET    | `/api/v1/wholesale-applications`             | `wholesale.read`        | `?status=PENDING\|APPROVED\|REJECTED`; pending oldest first; paginated                                                                              |
| POST   | `/api/v1/wholesale-applications/{id}/review` | `wholesale.review`      | `{ decision: APPROVE\|REJECT, note }` (note required to reject); approval grants `WHOLESALE_CUSTOMER`; emails the customer. 409 if already reviewed |
| GET    | `/api/v1/audit-logs`                         | `audit.read`            | Newest first; filters `action`, `actorId`, `entityId`; paginated (50)                                                                               |

Phase 2 renamed the Phase 1 `/api/v1/admin/*` paths to the resource paths above.

### Sellers

Seller statuses: `PENDING` → (submit) `UNDER_REVIEW` → `VERIFIED` or `REJECTED` (resubmit) or
back to `PENDING` (more information requested); `VERIFIED` ⇄ `SUSPENDED`; any → `CLOSED`
(final). Every change writes a history entry and an audit log entry and emails the owner.

Seller Center (`X-Client-App: seller`). Every query is limited to the signed-in person's own
seller; another seller's ids answer 404.

| Method | Path                                                | Permission              | Description                                                                                                            |
| ------ | --------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/sellers/me`                                | any seller role         | Profile, documents, history, `missingForSubmission`, `legalDetailsEditable`, store and member counts                   |
| PATCH  | `/api/v1/sellers/me`                                | `seller.profile.manage` | Partial profile. Legal details (name, type, registration number, TIN, VAT) only while `PENDING` or `REJECTED`          |
| POST   | `/api/v1/sellers/me/documents`                      | `seller.profile.manage` | Multipart `file` (PDF, JPEG, PNG; content checked), `type`, `description?` → 201. Only while `PENDING` or `REJECTED`   |
| DELETE | `/api/v1/sellers/me/documents/{documentId}`         | `seller.profile.manage` | → 204. Only while `PENDING` or `REJECTED`                                                                              |
| GET    | `/api/v1/sellers/me/documents/{documentId}/content` | any seller role         | The file, `Cache-Control: private, no-store`, as an attachment                                                         |
| POST   | `/api/v1/sellers/me/submit`                         | `seller.profile.manage` | → `UNDER_REVIEW`. 422 listing what is missing (confirmed email, address, registration number, TIN, required documents) |

Admin Console:

| Method | Path                                                  | Permission        | Description                                                                                                                               |
| ------ | ----------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/sellers`                                     | `sellers.read`    | `?status&search&page&pageSize`; `UNDER_REVIEW` oldest submission first, otherwise newest first                                            |
| GET    | `/api/v1/sellers/{id}`                                | `sellers.read`    | Full detail with documents and history                                                                                                    |
| GET    | `/api/v1/sellers/{id}/documents/{documentId}/content` | `sellers.read`    | The private file; each view is audited (`seller.document_viewed`)                                                                         |
| POST   | `/api/v1/sellers/{id}/review`                         | `sellers.review`  | `{ decision: APPROVE\|REJECT\|REQUEST_INFO, note? }`; note required to reject or request information. Only `UNDER_REVIEW` (409 otherwise) |
| POST   | `/api/v1/sellers/{id}/suspend`                        | `sellers.suspend` | `{ reason }`; `VERIFIED` only. Stores are hidden and the team can no longer make changes                                                  |
| POST   | `/api/v1/sellers/{id}/reinstate`                      | `sellers.suspend` | `{ reason }`; `SUSPENDED` only                                                                                                            |
| POST   | `/api/v1/sellers/{id}/close`                          | `sellers.suspend` | `{ reason }`; final. Stores are deactivated and every member's Seller Center sessions end                                                 |

Sensitive files are never public: there is no storage URL; they are streamed by the API after the
permission check.

### Stores

At most 5 stores per seller; only `VERIFIED` sellers create or change stores. A store link (slug)
is 3–60 lower-case letters, digits and hyphens, unique, not a reserved word, and cannot be
changed. Statuses: `ACTIVE` (open), `INACTIVE` (hidden by the seller), `SUSPENDED` (by the
marketplace).

| Method | Path                                  | Access                  | Description                                                                      |
| ------ | ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/v1/stores/slug-availability`    | public                  | `?slug` → `{ slug, available, reason? }`                                         |
| GET    | `/api/v1/stores/by-slug/{slug}`       | public                  | The public store page data; only open stores of verified sellers (404 otherwise) |
| GET    | `/api/v1/stores/{id}/logo`, `/banner` | public                  | The image (cache-busted by `?v=`). 404 without one                               |
| GET    | `/api/v1/stores/mine`                 | any seller role         | `{ stores, canCreate }`                                                          |
| POST   | `/api/v1/stores`                      | `seller.store.manage`   | `{ name, slug }` plus optional details → 201, open (`ACTIVE`)                    |
| GET    | `/api/v1/stores/{id}`                 | any seller role         | Own store only (404 for another seller's)                                        |
| PATCH  | `/api/v1/stores/{id}`                 | `seller.store.manage`   | Name, description, contact, address, `socialLinks` (https)                       |
| PUT    | `/api/v1/stores/{id}/settings`        | `seller.store.manage`   | Colours, announcement, shipping and return policies, vacation mode               |
| PUT    | `/api/v1/stores/{id}/logo`, `/banner` | `seller.store.manage`   | Multipart `file` (PNG, JPEG, WebP)                                               |
| DELETE | `/api/v1/stores/{id}/logo`, `/banner` | `seller.store.manage`   | Removes the image                                                                |
| POST   | `/api/v1/stores/{id}/open`, `/close`  | `seller.store.manage`   | Show or hide the store. Not while suspended                                      |
| GET    | `/api/v1/stores`                      | `stores.read` (admin)   | Every store; `?status&search&sellerId`; paginated                                |
| POST   | `/api/v1/stores/{id}/suspend`         | `stores.manage` (admin) | `{ reason }`; the reason is shown to the seller                                  |
| POST   | `/api/v1/stores/{id}/reinstate`       | `stores.manage` (admin) | `{ reason }`; the store becomes `ACTIVE` again                                   |

`customDomain` is reserved on the store record for a later phase; it cannot be set yet.

### Seller employees (`/api/v1/seller/members`, Seller Center)

A seller's owner and managers manage only their own seller's people. Invitations last 7 days; a
new invitation to the same address replaces the open one. The owner can assign every seller role
except owner; a manager can assign roles below manager. Nobody can grant a permission they don't
hold, manage the owner, or manage themselves.

| Method | Path                                                | Permission              | Description                                                        |
| ------ | --------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| GET    | `/seller/members`                                   | `seller.members.read`   | `{ members, invitations, assignableRoles, assignablePermissions }` |
| POST   | `/seller/members/invitations`                       | `seller.members.manage` | `{ email, roles, permissions? }` → 201; emails a join link         |
| POST   | `/seller/members/invitations/{id}/resend`           | `seller.members.manage` | New link, 7 more days → 204                                        |
| DELETE | `/seller/members/invitations/{id}`                  | `seller.members.manage` | Cancels the invitation → 204                                       |
| PATCH  | `/seller/members/{memberId}`                        | `seller.members.manage` | `{ roles, permissions? }`; effective on the person's next request  |
| POST   | `/seller/members/{memberId}/suspend`, `/reactivate` | `seller.members.manage` | Suspending ends their Seller Center sessions                       |
| DELETE | `/seller/members/{memberId}`                        | `seller.members.manage` | Removes them from the seller (their account stays) → 204           |

### Categories

The global category tree (three levels at most), kept by marketplace staff. A category's
attributes (e.g. "Net weight", "Storage") are filled in by products in it and in its
subcategories.

| Method | Path                                 | Access                      | Description                                                                                                                                                      |
| ------ | ------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/categories`                 | public                      | Active categories under active parents, parents first, with their own attributes                                                                                 |
| GET    | `/api/v1/categories/all`             | `catalog.categories.manage` | Every category, including inactive ones                                                                                                                          |
| GET    | `/api/v1/categories/{id}`            | public                      | One category                                                                                                                                                     |
| GET    | `/api/v1/categories/{id}/attributes` | public                      | Attributes products fill in: inherited ones first, then the category's own                                                                                       |
| GET    | `/api/v1/categories/{id}/image`      | public                      | The category image (WebP, cache-busted by `?v=`)                                                                                                                 |
| POST   | `/api/v1/categories`                 | `catalog.categories.manage` | `{ name, slug?, parentId?, description?, status?, sortOrder? }` → 201; 422 below the third level                                                                 |
| PATCH  | `/api/v1/categories/{id}`            | `catalog.categories.manage` | Name, link, description, status, sort order                                                                                                                      |
| DELETE | `/api/v1/categories/{id}`            | `catalog.categories.manage` | Only without subcategories or products (409 otherwise; make it inactive instead) → 204                                                                           |
| PUT    | `/api/v1/categories/{id}/attributes` | `catalog.categories.manage` | `{ attributes: [{ code, name, type: TEXT\|NUMBER\|BOOLEAN\|SELECT, options, unit, isRequired }] }` replaces the category's own; a code may not repeat a parent's |
| PUT    | `/api/v1/categories/{id}/image`      | `catalog.categories.manage` | Multipart `file` (JPEG, PNG, WebP); stored as WebP                                                                                                               |
| DELETE | `/api/v1/categories/{id}/image`      | `catalog.categories.manage` | Removes the image                                                                                                                                                |

### Brands

| Method | Path                         | Access                   | Description                                                                                         |
| ------ | ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/brands`             | staff and seller roles   | `?status&search`; staff see all, sellers see active brands and their own requests; paginated        |
| POST   | `/api/v1/brands`             | `catalog.brands.manage`  | `{ name, description? }` → 201 active brand; 409 if the name (ignoring case and punctuation) exists |
| POST   | `/api/v1/brands/requests`    | `seller.products.manage` | A seller asks for a missing brand → 201 `PENDING`; usable on the seller's products at once          |
| PATCH  | `/api/v1/brands/{id}`        | `catalog.brands.manage`  | Rename, describe, retire (`INACTIVE`) or reactivate                                                 |
| POST   | `/api/v1/brands/{id}/review` | `catalog.brands.manage`  | `{ decision: APPROVE\|REJECT, note? }` (note required to reject); 409 if already decided            |

### Products

Products belong to a seller and one of its stores. Every seller-side query is limited to the
caller's seller (another seller's products answer 404). Writing needs a verified seller.

Statuses: `DRAFT` → (submit) `PENDING_APPROVAL` → `ACTIVE` or `REJECTED` (fix and resubmit).
`ACTIVE` ⇄ `INACTIVE` (hidden by the seller). Staff can take a product down (`INACTIVE` with
`takenDown: true`); the seller must change it, which sends it back to review. Any status →
`ARCHIVED` → (restore) `DRAFT`. **Content changes** (name, description, category, brand,
specifications, attributes, options, added or replaced photos) to an approved product send it
back to `PENDING_APPROVAL`; price, stock and SKU changes do not.

| Method | Path                                            | Access                                 | Description                                                                                                                                                                                                                    |
| ------ | ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/products/mine`                         | seller roles                           | My products; `?status&search&categoryId&storeId&brandId`; paginated                                                                                                                                                            |
| GET    | `/api/v1/products`                              | `catalog.products.read`                | Every seller's products, same filters plus `sellerId`; `PENDING_APPROVAL` oldest submission first                                                                                                                              |
| GET    | `/api/v1/products/{id}`                         | own seller, or `catalog.products.read` | Full detail: variants with stock, photos, tiers, history, `missingForSubmission`                                                                                                                                               |
| POST   | `/api/v1/products`                              | `seller.products.manage`               | `{ storeId, categoryId, brandId?, name, slug?, description?, specifications?, attributeValues?, seo…, sku, regularPrice }` → 201 `DRAFT` with one default variant                                                              |
| PATCH  | `/api/v1/products/{id}`                         | `seller.products.manage`               | Edit details; attribute values are checked against the category                                                                                                                                                                |
| PUT    | `/api/v1/products/{id}/options`                 | `seller.products.manage`               | `{ options: [{ name, values }], generate: { skuPrefix, regularPrice } }` sets up to 3 options and creates a variant per new combination (at most 100); removed combinations are deleted, or 409 when they have stock records   |
| PATCH  | `/api/v1/products/{id}/variants/{variantId}`    | see description                        | SKU, barcode, measures, stock tracking, status (`seller.products.manage`); regular and sale price with dates (`seller.pricing.manage`)                                                                                         |
| POST   | `/api/v1/products/{id}/submit`                  | `seller.products.manage`               | Draft or rejected → `PENDING_APPROVAL`; 422 `NOT_READY` listing what is missing                                                                                                                                                |
| POST   | `/api/v1/products/{id}/deactivate`, `/activate` | `seller.products.manage`               | Hide / show an approved product (not one that was taken down)                                                                                                                                                                  |
| POST   | `/api/v1/products/{id}/archive`, `/restore`     | `seller.products.manage`               | Archive; restore as a draft                                                                                                                                                                                                    |
| POST   | `/api/v1/products/{id}/review`                  | `catalog.products.review`              | `{ decision: APPROVE\|REJECT, note? }` (note required to reject); 409 if the brand is not active yet; emails the seller                                                                                                        |
| POST   | `/api/v1/products/{id}/take-down`               | `catalog.products.review`              | `{ reason }`; hides the product; emails the seller                                                                                                                                                                             |
| POST   | `/api/v1/products/{id}/images`                  | `seller.products.manage`               | Multipart `file` (+ `altText?`, `variantId?`). JPEG, PNG or WebP by extension **and** content, ≤ 5 MB, ≥ 200 × 200 px, at most 10 per product. Stored as WebP (longest side 1600 px) plus a 400 px thumbnail, metadata removed |
| PUT    | `/api/v1/products/{id}/images/order`            | `seller.products.manage`               | `{ imageIds }` listing every photo once; the first is the main photo                                                                                                                                                           |
| PATCH  | `/api/v1/products/{id}/images/{imageId}`        | `seller.products.manage`               | `{ altText?, variantId? }`                                                                                                                                                                                                     |
| PUT    | `/api/v1/products/{id}/images/{imageId}/file`   | `seller.products.manage`               | Replace the photo, keeping its place                                                                                                                                                                                           |
| DELETE | `/api/v1/products/{id}/images/{imageId}`        | `seller.products.manage`               | Delete the photo and its files                                                                                                                                                                                                 |
| GET    | `/api/v1/products/images/{imageId}/{size}`      | public                                 | `large` or `thumbnail` WebP; `Cache-Control: public, immutable` (URLs carry `?v=`)                                                                                                                                             |

### Pricing

The server calculates every price; clients send only variant ids and quantities. Order: a
price agreed with the customer wins; otherwise the retail price (sale price while the sale
runs); approved wholesale customers, on products with wholesale on and at or above the
wholesale minimum, get the tier for the highest quantity break reached when it is lower.
Each quote line carries the rule that produced it (`source`, `rule`), which orders store as a
snapshot.

| Method | Path                                              | Access                  | Description                                                                                                                                                                                                    |
| ------ | ------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/pricing/quote`                           | public (no CSRF)        | `{ items: [{ variantId, quantity }] }` (extra top-level fields are refused) → `{ lines, evaluatedAt }` for the signed-in customer or a guest; 422 for unavailable items or quantities outside the order limits |
| PUT    | `/api/v1/products/{id}/pricing`                   | `seller.pricing.manage` | `{ currency, minOrderQuantity, maxOrderQuantity?, wholesaleEnabled, wholesaleMinOrderQuantity }`                                                                                                               |
| PUT    | `/api/v1/products/{id}/price-tiers`               | `seller.pricing.manage` | `{ tiers: [{ variantId?, minQuantity, unitPrice, startsAt?, endsAt? }] }` replaces the tiers. Tiers in force at the same time need different quantities, and more units may not cost more each                 |
| GET    | `/api/v1/products/{id}/customer-prices`           | seller roles            | Prices agreed with individual customers                                                                                                                                                                        |
| POST   | `/api/v1/products/{id}/customer-prices`           | `seller.pricing.manage` | `{ customerEmail, variantId?, minQuantity, unitPrice, startsAt?, endsAt?, note? }`; only customer accounts; 409 for an overlapping duplicate                                                                   |
| DELETE | `/api/v1/products/{id}/customer-prices/{priceId}` | `seller.pricing.manage` | Remove                                                                                                                                                                                                         |
| POST   | `/api/v1/products/{id}/price-preview`             | seller roles            | `{ variantId, quantity, buyer: RETAIL\|WHOLESALE, customerEmail? }` → one quote line                                                                                                                           |

### Storefront: search, products and home page (public)

Only products shoppers may see: approved, from verified sellers, in open stores and active
categories. Prices are for the person asking (guests and retail customers: retail; approved
wholesale customers: their tiers; agreed customer prices). Search runs behind a provider
interface (PostgreSQL full-text and trigram search today, see ADR 0018).

| Method | Path                                           | Description                                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/catalog/products`                     | `?q&categoryId\|category (slug, includes subcategories)&storeId&sellerId&brandIds&minPrice&maxPrice&minRating&inStock&wholesale&sort&page&pageSize`; `sort`: `relevance`, `newest`, `price_asc`, `price_desc`, `best_selling`, `rating` → cards plus `facets` (categories, brands, stores, price range) and `engine` |
| GET    | `/api/v1/catalog/suggest`                      | `?q` → up to 6 products, categories and stores for search-as-you-type                                                                                                                                                                                                                                                |
| GET    | `/api/v1/catalog/products/{id}`                | Product page: variants with availability, options, photos, specifications, rating, store, retail/sale/flash and wholesale prices                                                                                                                                                                                     |
| GET    | `/api/v1/catalog/products/{productId}/reviews` | Published reviews, newest first; `?rating`                                                                                                                                                                                                                                                                           |
| GET    | `/api/v1/storefront/home`                      | Hero and promo banners, categories, the running flash sale with units left, featured products, best sellers, recommended (from the customer's orders, wishlist and cart when signed in; top rated otherwise), featured stores                                                                                        |
| GET    | `/api/v1/storefront/banners/{id}/image`        | Banner image (WebP)                                                                                                                                                                                                                                                                                                  |
| GET    | `/api/v1/locations`                            | Philippine locations (PSGC, ADR 0020): regions, or the next step under `?parentCode` (provinces and independent cities → cities and municipalities → barangays)                                                                                                                                                      |

### Customer account (`/api/v1/account/*`, signed-in customers)

| Method | Path                              | Description                                                                                                                                                                                  |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/account/addresses`              | Delivery addresses, default first                                                                                                                                                            |
| POST   | `/account/addresses`              | `{ label?, recipientName, mobile, regionCode, provinceCode?, cityCode, barangayCode, postalCode, streetAddress, addressLine2?, isDefault? }`; codes must form a valid PSGC chain; at most 20 |
| PUT    | `/account/addresses/{id}`         | Replace                                                                                                                                                                                      |
| DELETE | `/account/addresses/{id}`         | Delete (orders keep their own copy)                                                                                                                                                          |
| POST   | `/account/addresses/{id}/default` | Make it the default                                                                                                                                                                          |
| GET    | `/account/wishlist`               | Saved products as cards                                                                                                                                                                      |
| PUT    | `/account/wishlist/{productId}`   | Save (idempotent); DELETE removes                                                                                                                                                            |
| GET    | `/account/reviews`                | My reviews and bought items waiting for one                                                                                                                                                  |
| POST   | `/account/reviews`                | `{ orderItemId, rating 1–5, title?, body? }`; only for items in my placed orders, one per item                                                                                               |
| PUT    | `/account/reviews/{id}`           | Edit                                                                                                                                                                                         |
| GET    | `/account/orders`                 | My orders, newest first; `?status`                                                                                                                                                           |
| GET    | `/account/orders/{id}`            | One order with each seller's package, totals, coupons, address and history; another customer's order is 404                                                                                  |
| POST   | `/account/orders/{id}/cancel`     | `{ reason }`; while waiting for payment, or COD before any seller starts; releases stock, coupon uses and flash units                                                                        |

### Cart (`/api/v1/cart`, signed-in customers)

Every read re-prices the cart and checks stock now; lines are grouped by seller. Guests keep
their cart in the browser (variant ids and quantities only) and merge it when they sign in.

| Method | Path               | Description                                                                                                       |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/cart`            | `{ groups: [{ seller, store, lines, subtotal }], saved, itemCount, subtotal, wholesaleSavings, ready, problems }` |
| POST   | `/cart/items`      | `{ variantId, quantity, savedForLater? }`; adds to an existing line; at most 100 lines                            |
| PATCH  | `/cart/items/{id}` | `{ quantity?, savedForLater? }`                                                                                   |
| DELETE | `/cart/items/{id}` | Remove                                                                                                            |
| POST   | `/cart/merge`      | `{ items }` from the browser cart                                                                                 |
| POST   | `/cart/preview`    | Public. Prices a guest's `{ items }` without storing anything                                                     |

### Checkout (`/api/v1/checkout`, signed-in customers)

Request: `{ cartItemIds? | buyNow?: { variantId, quantity }, addressId?, shipping?: [{ sellerId,
method }], couponCodes?, paymentMethod?, notes?: [{ sellerId, note }] }` (unknown fields are
refused). Every amount is calculated by the server (ADR 0019).

| Method | Path               | Description                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/checkout/quote`  | → `{ groups (per seller: lines, shipping options and choice, discounts, charges, VAT, total), coupons (APPLIED or NOT_APPLIED with a reason), paymentMethods, totals, vat, problems }`                                                                                                                                                                                                  |
| POST   | `/checkout/orders` | Header `Idempotency-Key` (required); body as the quote plus `expectedGrandTotal`. → 201 order (200 with the same order when the key was used before). 409 `CHECKOUT_CHANGED` when the total differs or a coupon can no longer be used; 422 for blocking problems (stock, address, quantities). COD orders are `PLACED`; online methods `AWAITING_PAYMENT` until the payment window ends |

### Seller Center: orders and promotions (`/api/v1/seller/*`)

| Method | Path                                 | Access                    | Description                                                                                                                                                                                                           |
| ------ | ------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/seller/orders`                     | `seller.orders.read`      | My suborders; `?status&search`                                                                                                                                                                                        |
| GET    | `/seller/orders/{id}`                | `seller.orders.read`      | Items with price snapshots, shipping, customer and address, coupons, commission per item; others' 404                                                                                                                 |
| GET    | `/seller/coupons`                    | seller roles              | My coupons                                                                                                                                                                                                            |
| POST   | `/seller/coupons`                    | `seller.marketing.manage` | `{ code, name, description?, type: PERCENTAGE\|FIXED_AMOUNT\|FREE_SHIPPING, value, maxDiscount?, minSpend, startsAt, endsAt, usageLimit?, perCustomerLimit, status }`; seller-funded, my items only; verified sellers |
| PATCH  | `/seller/coupons/{id}`               | `seller.marketing.manage` | `{ name?, description?, endsAt?, usageLimit?, perCustomerLimit?, status? }`                                                                                                                                           |
| GET    | `/seller/flash-sales`                | seller roles              | Upcoming and running sales with my items                                                                                                                                                                              |
| POST   | `/seller/flash-sales/{id}/items`     | `seller.marketing.manage` | `{ variantId, flashPrice (below regular), quantityLimit, perOrderLimit? }`; 409 if the variant is in an overlapping sale                                                                                              |
| DELETE | `/seller/flash-sales/items/{itemId}` | `seller.marketing.manage` | Withdraw (switched off instead once units sold)                                                                                                                                                                       |

### Admin Console: orders, storefront content, promotions, reviews and settings

| Method | Path                              | Access             | Description                                                                                                                                                                                  |
| ------ | --------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orders`                         | `orders.read`      | Every order; `?status&paymentMethod&search` (number, customer name or email)                                                                                                                 |
| GET    | `/orders/{id}`                    | `orders.read`      | Order with every seller suborder and the commission total                                                                                                                                    |
| GET    | `/seller-orders`                  | `orders.read`      | Every suborder; `?sellerId&status&search`                                                                                                                                                    |
| GET    | `/seller-orders/{id}`             | `orders.read`      | One suborder (same shape as the seller's view)                                                                                                                                               |
| GET    | `/storefront/banners`             | `marketing.manage` | All banners including hidden and scheduled                                                                                                                                                   |
| POST   | `/storefront/banners`             | `marketing.manage` | Multipart: `file` (PNG, JPEG, WebP; stored as WebP, at most 1920 px) and `title, subtitle?, linkUrl? (a path inside the store), placement HERO\|PROMO, status, position, startsAt?, endsAt?` |
| PATCH  | `/storefront/banners/{id}`        | `marketing.manage` | Edit fields                                                                                                                                                                                  |
| PUT    | `/storefront/banners/{id}/image`  | `marketing.manage` | Replace the image                                                                                                                                                                            |
| DELETE | `/storefront/banners/{id}`        | `marketing.manage` | Delete with its image                                                                                                                                                                        |
| GET    | `/storefront/featured`            | `marketing.manage` | Featured products and stores                                                                                                                                                                 |
| PUT    | `/storefront/featured/products`   | `marketing.manage` | `{ productIds }` in order, at most 24                                                                                                                                                        |
| PUT    | `/storefront/featured/stores`     | `marketing.manage` | `{ storeIds }` in order, at most 12                                                                                                                                                          |
| GET    | `/coupons`                        | `marketing.manage` | Every coupon; `?scope&status&search`                                                                                                                                                         |
| POST   | `/coupons`                        | `marketing.manage` | Marketplace-funded coupon (same fields as the seller's)                                                                                                                                      |
| PATCH  | `/coupons/{id}`                   | `marketing.manage` | Edit a marketplace coupon                                                                                                                                                                    |
| GET    | `/flash-sales`                    | `marketing.manage` | Flash sales with every seller's items                                                                                                                                                        |
| POST   | `/flash-sales`                    | `marketing.manage` | `{ title, startsAt, endsAt, status }`                                                                                                                                                        |
| PATCH  | `/flash-sales/{id}`               | `marketing.manage` | Edit (a started sale keeps its start)                                                                                                                                                        |
| PATCH  | `/flash-sales/items/{itemId}`     | `marketing.manage` | `{ status }`: switch a seller's item off or on                                                                                                                                               |
| GET    | `/reviews`                        | `reviews.moderate` | Every review; `?status&rating&search`                                                                                                                                                        |
| PATCH  | `/reviews/{id}`                   | `reviews.moderate` | `{ status: HIDDEN\|PUBLISHED, note? }` (note required to hide); ratings are recalculated                                                                                                     |
| GET    | `/settings`                       | `settings.manage`  | Checkout settings, shipping rate table, commission rules                                                                                                                                     |
| PUT    | `/settings/checkout`              | `settings.manage`  | `{ vat: { rate, pricesIncludeVat: true }, charges, paymentWindowMinutes (5–60), paymentMethods }`                                                                                            |
| PUT    | `/settings/shipping-rates`        | `settings.manage`  | Mock provider rate table (ADR 0021)                                                                                                                                                          |
| PUT    | `/settings/commission-rules`      | `settings.manage`  | `{ categoryId \| null (default), ratePercent }`                                                                                                                                              |
| DELETE | `/settings/commission-rules/{id}` | `settings.manage`  | Remove a category rate (not the default)                                                                                                                                                     |

### Inventory (Seller Center)

Stock lives per variant and warehouse: `quantityOnHand`, `reservedQuantity` (held for
checkouts) and `damagedQuantity` (kept apart). Available = on hand − reserved, never below
zero: every change is one guarded UPDATE plus one row in the append-only ledger, in a
transaction, so concurrent requests cannot oversell.

| Method | Path                                        | Access                    | Description                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/inventory/summary`                 | seller roles              | Totals for the dashboard                                                                                                                                                                                                                                                                                      |
| GET    | `/api/v1/inventory/warehouses`              | seller roles              | Warehouses with stock totals                                                                                                                                                                                                                                                                                  |
| POST   | `/api/v1/inventory/warehouses`              | `seller.inventory.manage` | `{ name, code, address…, location?: { regionCode, provinceCode?, cityCode, barangayCode }, contactName?, phone?, isDefault? }` (at most 20; the first is the default). With `location`, the barangay, city and province text come from the PSGC names, and the warehouse can be a shipping origin (`canShip`) |
| PATCH  | `/api/v1/inventory/warehouses/{id}`         | `seller.inventory.manage` | Edit, or `status: INACTIVE` (not the default)                                                                                                                                                                                                                                                                 |
| POST   | `/api/v1/inventory/warehouses/{id}/default` | `seller.inventory.manage` | Make it the default (reservations take stock from it first)                                                                                                                                                                                                                                                   |
| GET    | `/api/v1/inventory/stock`                   | seller roles              | Stock levels; `?warehouseId&productId&search&lowStock=true`; paginated                                                                                                                                                                                                                                        |
| PUT    | `/api/v1/inventory/stock/{id}/threshold`    | `seller.inventory.manage` | `{ lowStockThreshold }` (null: no alert). One email when available stock falls to it; re-armed after restocking                                                                                                                                                                                               |
| POST   | `/api/v1/inventory/movements`               | `seller.inventory.manage` | `{ warehouseId, variantId, type, quantity, reason? }`; types `STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT` (signed), `DAMAGED`, `DAMAGED_WRITE_OFF`, `RETURN_RESTOCK`, `RETURN_DAMAGED`; reason required except for stock in and restocked returns → 201 `{ movement, stockLevel }`; 409 `INSUFFICIENT_STOCK`         |
| GET    | `/api/v1/inventory/movements`               | seller roles              | The ledger, newest first; `?warehouseId&variantId&productId&type&from&to`                                                                                                                                                                                                                                     |
| POST   | `/api/v1/inventory/transfers`               | `seller.inventory.manage` | `{ fromWarehouseId, toWarehouseId, items: [{ variantId, quantity }], note? }`; all items or none                                                                                                                                                                                                              |
| GET    | `/api/v1/inventory/transfers`               | seller roles              | Transfers, newest first                                                                                                                                                                                                                                                                                       |
| GET    | `/api/v1/inventory/reservations`            | seller roles              | Stock held for checkouts; `?status&variantId`                                                                                                                                                                                                                                                                 |
| GET    | `/api/v1/inventory/overview`                | `inventory.read` (staff)  | Totals and stock per seller; `?search`                                                                                                                                                                                                                                                                        |

Reservations are created by checkout through `ReservationsService`, linked to the order item:
all items or none, default warehouse first. Holds for cash-on-delivery orders have no expiry
(they last until fulfilment or cancellation); holds for orders paid online expire 5 minutes
after the payment deadline. The worker
releases expired holds every minute, and the API releases a variant's expired holds before
reserving it, so a late sweep never blocks a sale. A reservation becomes a `SALE` ledger row
when the order is fulfilled; converting an expired one is refused (`RESERVATION_NOT_ACTIVE`).

### Documentation

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| GET    | `/api/docs`      | Swagger UI         |
| GET    | `/api/docs-json` | OpenAPI 3 document |

## Phase 5: orders, payments, shipping, returns and refunds

Decisions: ADR 0022 (payments and webhooks), 0023 (state machine), 0024 (shipments),
0025 (COD, returns, refunds, payables). Amounts are decimal strings in pesos. `test: true` /
`livemode: false` marks mock or sandbox records (no real money or parcel).

### Customers (`/api/v1/account/*`, `/api/v1/dev/*`)

| Method    | Path                                                       | Description                                                                                                                                  |
| --------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST      | `/account/orders/{id}/payments`                            | Pay now: the open hosted checkout, or a new attempt → `{ payment, checkoutUrl }`; 409 when paid, cancelled or past the deadline              |
| POST      | `/account/orders/{id}/payments/verify`                     | After returning from the provider: the API asks the provider (server to server) → order                                                      |
| POST      | `/account/orders/{id}/bank-transfer-proofs`                | Multipart `file` (PDF, JPG, PNG) + `bankName, referenceNumber, amount, transferredAt` → order; 409 when one is already under review          |
| GET       | `/account/orders/{id}/bank-transfer-proofs/{proofId}/file` | My proof                                                                                                                                     |
| POST      | `/account/orders/{id}/notes`                               | `{ body }` message to the sellers and support                                                                                                |
| POST      | `/account/seller-orders/{id}/cancel`                       | `{ reason }` cancel one package while it is new (paid money refunded)                                                                        |
| POST      | `/account/seller-orders/{id}/cancellation-request`         | `{ reason }` ask the seller (once) while it is being prepared                                                                                |
| POST      | `/account/seller-orders/{id}/confirm-received`             | Seller-arranged deliveries                                                                                                                   |
| POST      | `/account/seller-orders/{id}/notes`                        | `{ body }`                                                                                                                                   |
| GET       | `/account/returns`, `/account/returns/{id}`                | My returns                                                                                                                                   |
| POST      | `/account/returns`                                         | Multipart `data` (JSON `{ sellerOrderId, items: [{ orderItemId, quantity }], reason, description, requestedResolution }`) + up to 5 `images` |
| POST      | `/account/returns/{id}/escalate`                           | `{ note }` after a rejection or no answer in time                                                                                            |
| POST      | `/account/returns/{id}/cancel`                             | Withdraw                                                                                                                                     |
| POST      | `/account/returns/{id}/ship-back`                          | `{ carrierName, trackingNumber }`                                                                                                            |
| GET, POST | `/dev/mock-payments/{sessionId}`                           | The mock provider's test checkout (owner only; `{ outcome: paid\|failed }` sends a signed webhook). Not in production                        |

### Webhooks (public; authenticated by signature over the raw body)

| Method | Path                              | Description                                                                                                                  |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/payments/webhooks/paymongo`     | `Paymongo-Signature`; 401 when invalid (nothing stored); 200 `{ received, duplicate }`; 500 when processing failed (retried) |
| POST   | `/payments/webhooks/mock`         | `x-mock-signature` (development)                                                                                             |
| POST   | `/shipping/webhooks/mock-courier` | `x-mock-courier-signature` (development)                                                                                     |

### Seller Center (`/api/v1/seller/*`; read `seller.orders.read`, act `seller.orders.manage`, returns `seller.returns.manage`)

| Method | Path                                                                                                                     | Description                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/seller/orders?tab=NEW\|PROCESSING\|READY_FOR_PICKUP\|SHIPPED\|COMPLETED\|CANCELLED&search`                             | Dashboard tabs (search covers tracking numbers)                                                              |
| GET    | `/seller/orders/counts`                                                                                                  | Orders per tab, returns to answer, cancellation requests                                                     |
| GET    | `/seller/orders/{id}`                                                                                                    | Adds shipments, COD, cancellation request, returns, refunds, notes, payables ledger and `actions`            |
| POST   | `/seller/orders/{id}/accept`, `/cancel` `{ reason }`                                                                     |                                                                                                              |
| POST   | `/seller/orders/{id}/cancellation-request/approve` `{ response? }`, `/reject` `{ response }`                             |                                                                                                              |
| POST   | `/seller/orders/{id}/notes`                                                                                              | `{ body, visibility: CUSTOMER\|SELLER }`                                                                     |
| GET    | `/seller/shipping/carriers`                                                                                              | Couriers enabled and set up                                                                                  |
| POST   | `/seller/orders/{id}/shipments`                                                                                          | `{ carrier: MOCK }` or `{ carrier: SELF, carrierName, trackingNumber }`                                      |
| POST   | `/seller/shipments/{id}/cancel`                                                                                          | Before pickup                                                                                                |
| POST   | `/seller/shipments/{id}/events`                                                                                          | `{ status, description?, location? }` self-arranged deliveries; 409 `INVALID_TRANSITION`                     |
| GET    | `/seller/shipments/{id}/waybill`                                                                                         | Label PDF                                                                                                    |
| GET    | `/seller/returns`, `/seller/returns/{id}`                                                                                |                                                                                                              |
| POST   | `/seller/returns/{id}/approve`                                                                                           | `{ resolution: FULL_REFUND\|PARTIAL_REFUND\|REPLACEMENT, refundAmount?, requiresReturnShipment, response? }` |
| POST   | `/seller/returns/{id}/reject` `{ response }`, `/receive` `{ restock }`, `/replacement` `{ carrierName, trackingNumber }` |                                                                                                              |
| GET    | `/seller/ledger`                                                                                                         | Seller payable lines of the double-entry ledger (Phase 6) with the total                                     |

### Admin Console

| Method | Path                                                                                                            | Access            | Description                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/orders/{id}/cancel` `{ reason }`                                                                              | `orders.manage`   | Whole order before anything ships                                                            |
| POST   | `/orders/{id}/notes`                                                                                            | `orders.manage`   | `{ body, visibility: CUSTOMER\|SELLER\|STAFF }`                                              |
| POST   | `/orders/{id}/payments/verify`                                                                                  | `payments.manage` | Ask the provider                                                                             |
| POST   | `/seller-orders/{id}/cancel`, `/transition` `{ to, note }`, `/cancellation-request/{approve\|reject}`, `/notes` | `orders.manage`   | Transition: accept for the seller or complete a delivered order                              |
| GET    | `/payments?queue=review\|failed&status&provider&method&search`, `/payments/{id}`                                | `payments.read`   | Attempts with history, proofs, refunds                                                       |
| POST   | `/payments/{id}/resolve` `{ note }`                                                                             | `payments.manage` | Review item handled                                                                          |
| GET    | `/payments/gateways`, `/payments/reconciliation?from&to`, `/payments/webhook-events`                            | `payments.read`   | Payload never shown                                                                          |
| POST   | `/payments/webhook-events/{id}/reprocess`                                                                       | `payments.manage` | Failed events only                                                                           |
| GET    | `/payments/bank-transfer-proofs?status`, `/{id}/file`                                                           | `payments.read`   | Queue oldest first                                                                           |
| POST   | `/payments/bank-transfer-proofs/{id}/approve`, `/reject` `{ reason }`                                           | `payments.manage` |                                                                                              |
| GET    | `/refunds`, `/refunds/{id}`                                                                                     | `payments.read`   |                                                                                              |
| POST   | `/refunds`                                                                                                      | `refunds.manage`  | `{ sellerOrderId \| paymentId, reason, kind: FULL\|PARTIAL, amount?, note, idempotencyKey }` |
| POST   | `/refunds/{id}/mark-paid` `{ payoutReference }`, `/retry`, `/resend`                                            | `refunds.manage`  |                                                                                              |
| GET    | `/sellers/{id}/ledger`                                                                                          | `payments.read`   |                                                                                              |
| GET    | `/cod/collections?status&carrier`, `/cod/remittances`                                                           | `payments.read`   |                                                                                              |
| POST   | `/cod/remittances`                                                                                              | `cod.manage`      | `{ carrier, reference, remittedAt, amount, collectionIds, discrepancyNote? }`                |
| GET    | `/shipping/carriers`, `/shipments`                                                                              | `orders.read`     |                                                                                              |
| PUT    | `/settings/orders`                                                                                              | `settings.manage` | Bank accounts and window, COD limits, return windows, couriers                               |
| POST   | `/shipments/{id}/events`, `/cancel`, `/simulate` (mock, development)                                            | `shipping.manage` |                                                                                              |
| GET    | `/shipments/{id}/waybill`                                                                                       | `orders.read`     |                                                                                              |
| GET    | `/returns?status`, `/returns/{id}`                                                                              | `orders.read`     | ESCALATED: the dispute queue                                                                 |
| POST   | `/returns/{id}/decide`, `/receive`                                                                              | `disputes.manage` | `{ resolution, refundAmount?, requiresReturnShipment?, note }`                               |

## Phase 6: commission, ledger, settlement, payouts, tax and accounting

Decisions: ADR 0026 (commission engine), 0027 (double-entry ledger), 0028 (settlement and
payouts), 0029 (tax, invoicing and Philippine compliance). Amounts are decimal strings in pesos;
dates in queries are Philippine calendar days (`YYYY-MM-DD`). Balances are always derived from
posted ledger lines. Bank account numbers are never returned (only `•••• 1234`).

### Seller Center (`/api/v1/seller/finance/*`; read `seller.finance.read`)

| Method    | Path                                                                                        | Access                       | Description                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET       | `/seller/finance/overview?from&to`                                                          | read                         | Balances (pending, held, available, reserved, in payout, paid, withdrawable), sales summary, current period, setup state                                                       |
| GET       | `/seller/finance/transactions?account=PENDING\|AVAILABLE\|RESERVED\|IN_PAYOUT&kind&from&to` | read                         | Statement of account (seller payable lines)                                                                                                                                    |
| GET       | `/seller/finance/settlements`, `/settlements/{id}`                                          | read                         | Statements with order lines, withholding and documents                                                                                                                         |
| GET       | `/seller/finance/documents`, `/documents/{id}`                                              | read                         | Service invoices and credit notes from the marketplace                                                                                                                         |
| GET, POST | `/seller/finance/bank-accounts`                                                             | POST `seller.payouts.manage` | `{ institutionName, institutionCode?, accountName, accountNumber, makeDefault }` (stored encrypted)                                                                            |
| POST      | `/seller/finance/bank-accounts/{id}/disable`                                                | `seller.payouts.manage`      | 409 while a payout to it is open                                                                                                                                               |
| GET       | `/seller/finance/payouts`, `/payouts/{id}`                                                  | read                         | History with the event log                                                                                                                                                     |
| POST      | `/seller/finance/payouts`                                                                   | `seller.payouts.manage`      | `{ amount, bankAccountId, idempotencyKey }`; 409 without verified tax profile; 422 over the available balance, under the minimum or unverified account; same key → same payout |
| POST      | `/seller/finance/payouts/{id}/cancel`                                                       | `seller.payouts.manage`      | While requested                                                                                                                                                                |
| GET, PUT  | `/seller/finance/tax-profile`                                                               | PUT `seller.profile.manage`  | `{ taxRegisteredName }` (clears finance's verification)                                                                                                                        |
| PUT       | `/seller/orders/{id}/sales-invoice`                                                         | `seller.orders.manage`       | `{ sellerInvoiceNumber, sellerInvoiceDate }` the seller's own invoice                                                                                                          |

`GET /seller/orders/{id}` now also returns the commission rule scope/type, per-item `taxes`,
`sellerInvoice` and `settlement`.

### Admin Console (`/api/v1/finance/*`; read `finance.read`)

| Method            | Path                                                                                                                                                      | Access                                                 | Description                                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET               | `/finance/dashboard?from&to`                                                                                                                              | read                                                   | GMV, revenue, fees, refunds, seller payables, cash, taxes, queues, reconciliation status                                                                                                                 |
| GET, PUT          | `/finance/settings`                                                                                                                                       | PUT `finance.manage`                                   | Fees per method and bearer per channel, settlement schedule, payout minimum, PayMongo payouts switch, invoice issuer                                                                                     |
| GET               | `/finance/commission-rules?scope&state&sellerId&q`, `/commission-rules/preview?productId&at`                                                              | read                                                   | Rules; which rule applies to a product                                                                                                                                                                   |
| POST              | `/finance/commission-rules`                                                                                                                               | `commission.manage` (+ `commission.exempt` for EXEMPT) | `{ scope, type, categoryId?, sellerId?, productId?, ratePercent?, fixedAmount?, effectiveFrom?, effectiveTo?, reason? }`; ends the current rule for the same target; 409 on a conflicting scheduled rule |
| POST              | `/finance/commission-rules/{id}/end`                                                                                                                      | `commission.manage`                                    | `{ effectiveTo? }`; the default can only be replaced                                                                                                                                                     |
| GET, POST         | `/finance/tax-rules`; POST `/tax-rules/{id}/end`                                                                                                          | POST `tax.manage`                                      | `{ code, name, jurisdiction, kind, appliesTo, sellerRegistration, ratePercent, basePercent, inclusive, effectiveFrom?, legalReference? }`                                                                |
| GET               | `/finance/tax-profiles`, `/sellers/{id}/tax-profile`                                                                                                      | read                                                   | Profiles to verify                                                                                                                                                                                       |
| POST              | `/finance/sellers/{id}/tax-profile/verify`                                                                                                                | `tax.manage`                                           | `{ verified, withholdingExemptUntil, note? }`                                                                                                                                                            |
| GET, POST         | `/finance/accounts`; PATCH `/accounts/{id}`                                                                                                               | write `ledger.post`                                    | Chart of accounts with balances                                                                                                                                                                          |
| GET               | `/finance/accounts/{code}/ledger?from&to&sellerId`                                                                                                        | read                                                   | General ledger of an account with running balance                                                                                                                                                        |
| GET               | `/finance/journals?type&status&from&to&accountCode&sellerId&q`, `/journals/{id}`                                                                          | read                                                   |                                                                                                                                                                                                          |
| POST, PUT, DELETE | `/finance/journals`, `/journals/{id}`                                                                                                                     | `ledger.post`                                          | Manual journals as drafts (`{ description, occurredAt, lines: [{ accountCode, debit, credit, sellerId? }] }`)                                                                                            |
| POST              | `/finance/journals/{id}/post`, `/reverse` `{ reason }`                                                                                                    | `ledger.post`                                          | Posting checks the balance; only manual journals are reversed here                                                                                                                                       |
| GET               | `/finance/balances?q&negativeOnly`, `/sellers/{id}/balances`, `/sellers/{id}/subledger`                                                                   | read                                                   |                                                                                                                                                                                                          |
| POST              | `/finance/sellers/{id}/reserve`                                                                                                                           | `settlements.manage`                                   | `{ action: PLACE\|RELEASE, amount, reason }`                                                                                                                                                             |
| GET               | `/finance/settlements?sellerId&from&to`, `/settlements/preview`, `/settlements/{id}`                                                                      | read                                                   |                                                                                                                                                                                                          |
| POST              | `/finance/settlements/run`                                                                                                                                | `settlements.manage`                                   | `{ periodContaining?, sellerId? }` closed periods only                                                                                                                                                   |
| GET               | `/finance/documents`, `/documents/{id}`                                                                                                                   | read                                                   |                                                                                                                                                                                                          |
| GET               | `/finance/bank-accounts?status&sellerId`                                                                                                                  | read                                                   |                                                                                                                                                                                                          |
| POST              | `/finance/bank-accounts/{id}/review`                                                                                                                      | `payouts.approve`                                      | `{ decision: VERIFY\|REJECT\|DISABLE, note? }`                                                                                                                                                           |
| GET               | `/finance/payouts?status&sellerId`, `/payouts/{id}`                                                                                                       | read                                                   | With `events` and allowed `actions`                                                                                                                                                                      |
| POST              | `/finance/payouts/{id}/approve` `{ note? }`, `/reject` `{ reason }`                                                                                       | `payouts.approve`                                      | The requester cannot approve                                                                                                                                                                             |
| POST              | `/finance/payouts/{id}/mark-paid` `{ transferReference, transferFee?, paidAt? }`, `/send`, `/check`, `/mark-failed` `{ reason }`, `/reverse` `{ reason }` | `payouts.process`                                      | `send`/`check`: PayMongo when configured                                                                                                                                                                 |
| GET, POST         | `/finance/expenses`; POST `/expenses/{id}/pay` `{ paymentReference }`, `/void` `{ reason }`                                                               | write `ledger.post`                                    |                                                                                                                                                                                                          |
| GET               | `/finance/reports/{trial-balance\|revenue\|commission\|refunds\|cod\|settlements}?from&to`                                                                | read                                                   |                                                                                                                                                                                                          |
| GET               | `/finance/reconciliation`                                                                                                                                 | read                                                   | Ledger checks (one consistent snapshot)                                                                                                                                                                  |

The Phase 4 `PUT/DELETE /settings/commission-rules` now need `commission.manage` and create or
end rule versions. `PUT /settings/checkout` no longer uses `vat` (taxes come from tax rules).

## Phase 7: promotions, loyalty, referrals, affiliates, reviews, support, notifications, analytics

Decisions: ADR 0030 (promotion engine and stacking), 0031 (loyalty points ledger), 0032
(referrals and affiliates), 0033 (notification outbox), 0034 (support tickets), 0035 (analytics
and exports). Every discount, point and commission is calculated by the server.

### Checkout and orders

- `POST /checkout/quote` and `POST /checkout/orders` also take `pointsToRedeem` (capped by the
  balance and the redeem limit; the quote's `loyalty` says what applies) and `affiliateCode`
  (the quote's `affiliate.applied` says whether it counts).
- Quotes and orders add per line `promotion`, `promotionDiscount`, `pointsDiscount`; per seller
  group / seller order `promotions[]`, `promotionDiscount`, `pointsDiscount`; totals
  `promotionDiscount`, `couponDiscount` (coupons only), `pointsDiscount`; orders `pointsRedeemed`;
  customer seller orders `sellerRated`.

### Coupons and campaigns

| Method      | Path                               | Access                                | Notes                                                                                                                                                                                                          |
| ----------- | ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST, PATCH | `/coupons`, `/seller/coupons`      | `marketing.manage` / seller marketing | New fields `appliesTo` (`ALL`/`PRODUCTS`/`CATEGORIES`), `productIds`, `categoryIds`, `firstOrderOnly`; sellers may only target their own products                                                              |
| GET, POST   | `/campaigns`                       | `marketing.manage`                    | Marketplace campaigns: `{ name, description?, season?, type, value, maxDiscount?, minQuantity, buyQuantity?, getQuantity?, minSpend, appliesTo, productIds, categoryIds, startsAt, endsAt, status, priority }` |
| PATCH       | `/campaigns/{id}`                  | `marketing.manage`                    | Same fields except `type`                                                                                                                                                                                      |
| GET, POST   | `/seller/campaigns`, PATCH `/{id}` | `seller.marketing.manage` (verified)  | Seller-funded campaigns on own products                                                                                                                                                                        |
| GET         | `/storefront/campaigns?storeId`    | public                                | Running campaigns with a `headline`                                                                                                                                                                            |

### Loyalty, referrals and affiliates

| Method     | Path                                                        | Access              | Notes                                                                                                           |
| ---------- | ----------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET        | `/account/loyalty`, `/account/loyalty/transactions`         | customer            | Balance, value, expiring in 30 days, points on the way; the ledger                                              |
| GET        | `/account/referrals`                                        | customer            | Code (created on first use), invite link, referred friends                                                      |
| POST       | `/auth/customers/sign-up`                                   | public              | Optional `referralCode` (422 if unknown)                                                                        |
| POST/GET   | `/account/affiliate`, `/report`, `/conversions`, `/payouts` | customer            | Apply; account, link and totals; monthly report; attributed orders                                              |
| POST       | `/storefront/affiliate-clicks`                              | public (throttled)  | `{ code, landingPath }`                                                                                         |
| GET, PUT   | `/settings/loyalty`                                         | `loyalty.manage`    | Rules and referral bonuses                                                                                      |
| GET        | `/loyalty/accounts`, `/{userId}`, `/{userId}/transactions`  | `loyalty.manage`    | Balances and ledger                                                                                             |
| POST       | `/loyalty/accounts/{userId}/adjustments`                    | `loyalty.manage`    | `{ points, reason }`; 409 below zero; audited and posted to the ledger                                          |
| GET, PUT   | `/settings/affiliates`                                      | `affiliates.manage` | Default rate, link window, minimum payout                                                                       |
| GET, PATCH | `/affiliates`, `/affiliates/{id}`                           | `affiliates.manage` | Review `{ status, commissionRate?, note? }`                                                                     |
| GET        | `/affiliates/{id}/report`, `/conversions`, `/payouts`       | `affiliates.manage` |                                                                                                                 |
| POST       | `/affiliates/{id}/payouts`                                  | `affiliates.manage` | `{ method, externalReference?, note?, paidAt? }` pays everything payable; 409 when nothing or below the minimum |

### Reviews and seller ratings

| Method      | Path                                                     | Access                 | Notes                                                                                    |
| ----------- | -------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| POST        | `/account/reviews/{id}/images` (multipart `images`)      | customer               | Up to 5 photos per review, re-encoded to WebP                                            |
| DELETE      | `/account/reviews/{id}/images/{imageId}`                 | customer               |                                                                                          |
| GET         | `/catalog/review-images/{fileId}`                        | public                 | Only while the review is published                                                       |
| POST        | `/catalog/reviews/{id}/report`                           | customer               | `{ reason, details? }`; 409 twice or on one's own review                                 |
| GET, POST   | `/reviews/{id}/reports`, `/reviews/{id}/reports/resolve` | `reviews.moderate`     | `{ action: UPHOLD\|DISMISS, note }` (UPHOLD hides; note required)                        |
| GET         | `/reviews?reported=true`                                 | `reviews.moderate`     | Reviews with open reports first                                                          |
| GET         | `/seller/reviews?replied&rating`                         | `seller.reviews.reply` |                                                                                          |
| PUT, DELETE | `/seller/reviews/{id}/reply`                             | `seller.reviews.reply` | `{ body }`                                                                               |
| PUT         | `/account/seller-orders/{id}/rating`                     | customer               | `{ productQuality, shippingSpeed, communication, comment? }` after delivery (422 before) |
| GET         | `/catalog/stores/{storeId}/ratings`, `/seller/ratings`   | public / seller        | Averages from delivered orders                                                           |

Review DTOs add `verifiedPurchase`, `images`, `sellerReply`; staff DTOs `openReports`.

### Support

`/account/support/tickets` (customers), `/seller/support/tickets` (`seller.support.manage`),
`/support/tickets` (`support.read`; actions need `support.manage`): `GET` list (`open`,
`status`, `category`, `search`), `GET /{id}`, `POST /{id}/messages` (multipart: `data` =
`{ body, internal }`, up to 5 `attachments`), `POST /{id}/actions` (`RESOLVE`, `CLOSE`,
`REOPEN`, `JOIN`, `TAKE_OVER`, `ASSIGN`, `PRIORITY`), `GET /{id}/attachments/{attachmentId}`.
Customers create with `POST /account/support/tickets` (multipart `data` = `{ subject, category,
sellerOrderId?, body }`). Tickets outside the caller's scope are 404.

### Notifications

| Method       | Path                                            | Access                 | Notes                                                      |
| ------------ | ----------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| GET          | `/notifications?unread`                         | signed in              | Inbox with `unread` count                                  |
| POST         | `/notifications/read`                           | signed in              | `{ ids }` or `{ all: true }`                               |
| GET, PUT     | `/notifications/preferences`                    | signed in              | Email, SMS, push on/off (in-app always on)                 |
| POST, DELETE | `/notifications/push-subscriptions`             | signed in              | Web Push subscription                                      |
| GET          | `/notification-templates`                       | `notifications.manage` | Templates and the event catalogue                          |
| PUT          | `/notification-templates/{event}/{channel}`     | `notifications.manage` | `{ subject?, body, enabled }`; unknown `{{variables}}` 422 |
| GET          | `/notification-deliveries?channel&status&event` | `notifications.manage` | Delivery log (destinations masked)                         |

### Analytics

`GET /reports/{sales|products|categories|sellers|customers|payments|refunds}?from&to&granularity=day|week|month|year&sellerId`
(`reports.read`) and `GET /seller/reports/{sales|products|inventory|ratings|commissions|settlements}`
(`seller.reports.read`) return `{ kpis, series, table }`; add `/export?format=csv|xlsx|pdf` to
download. Defaults: the last 30 days, daily.
