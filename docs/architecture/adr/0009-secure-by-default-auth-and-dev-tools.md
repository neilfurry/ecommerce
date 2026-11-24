# ADR 0009: Secure-by-default authorization, and development-only tools

- Status: Accepted
- Date: 2026-11-24

## Context

Authentication arrives in Phase 2, but the guard infrastructure should exist from the start so no
endpoint is ever accidentally public. Phase 1 also needs a way to prove jobs and storage end to
end from the UI without building business features.

## Decision

- **Global `AuthGuard`.** Every route requires `request.user` unless it is marked `@Public()`.
  The global `RolesGuard` enforces `@Roles(...)` and fails closed when misconfigured.
  `@CurrentUser()` injects the user. Phase 2 plugs token verification into this; no controller
  changes.
- **Developer tools** (`/api/v1/dev/*` and the Admin Console "Developer tools" pages) exist for
  development and CI only:
  - `DEV_TOOLS_ENABLED=true` is required, and the API and worker refuse to start with it when
    `NODE_ENV=production`.
  - When disabled, the routes answer 404, as if they did not exist.
  - The development job handlers also refuse to run when the flag is off.
  - They are `@Public()` until Phase 2, then restricted to `SUPER_ADMIN`.

## Consequences

Phase 1 exposes no unauthenticated write endpoints in production. Development builds expose
test-job and test-upload endpoints on localhost only; Docker ports are bound to 127.0.0.1.
