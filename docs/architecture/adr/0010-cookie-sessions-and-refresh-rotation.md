# ADR 0010: Cookie sessions with rotating refresh tokens

- Status: Accepted
- Date: 2026-11-25

## Context

Three browser apps (storefront, Seller Center, Admin Console) share one API. Sessions must
survive page reloads, be revocable at once (suspension, "sign out everywhere", stolen device)
and never expose a token to JavaScript, where an XSS bug could steal it.

## Decision

- **HttpOnly cookies, one pair per app.** `mp_<app>_at` holds a 15-minute access token
  (path `/api`); `mp_<app>_rt` holds the refresh token (path `/api/v1/auth`, so it is sent
  only to auth routes). Each request names its app in the `X-Client-App` header, which picks
  the cookie pair and the roles allowed to sign in there. Signing in to the storefront and the
  Admin Console in one browser gives two independent sessions.
- **Access token**: a compact HS256 JWT signed with `AUTH_JWT_SECRET`, carrying only the user
  id, session id and app (audience). Roles and permissions are _not_ in the token: they are
  read per request from a 60-second Redis cache that is dropped whenever a user's roles or
  status change, or any role's permissions change. Revoked sessions are marked in Redis, so a
  suspended user is rejected on the next request, not when the token expires.
- **Refresh tokens rotate.** Each refresh issues a new token and revokes the old one. Only
  SHA-256 hashes are stored. Reusing a rotated token more than 10 seconds after rotation is
  treated as theft and revokes the whole sign-in (token family); within 10 seconds it is a
  concurrent refresh from another tab and answers 409, and the client simply retries.
- **Lifetimes.** Customers: 30 days, sliding. Staff: 12 hours, absolute (re-authenticate each
  working day).
- **CSRF**: double-submit. `GET /api/v1/auth/csrf` returns a random token and sets it in the
  HttpOnly `mp_csrf` cookie; every POST/PUT/PATCH/DELETE must echo it in `X-CSRF-Token`.
  `SameSite=Lax` cookies are a second layer. `COOKIE_SECURE=true` is required in production.
- **Passwords**: Argon2id (19 MiB, 2 iterations, 1 lane; OWASP's recommended minimum), at least
  12 characters with no composition rules (NIST SP 800-63B). Hashes are upgraded on sign-in
  when the parameters change. Five wrong passwords lock the account for 15 minutes; unknown
  emails take the same time as wrong passwords (dummy hash) and get the same message.
- The API client in `@marketplace/api-client` refreshes once (single flight) when a request
  answers `401 TOKEN_EXPIRED`, retries the request, and reports the end of the session when the
  refresh fails, so every app sends the user to sign-in the same way.

## Consequences

- No token is reachable from JavaScript; logout and suspension take effect immediately.
- The API needs Redis for every authenticated request (it already needed it for rate limits).
- Mobile apps (out of scope) would need a header-based variant of the same session store.
