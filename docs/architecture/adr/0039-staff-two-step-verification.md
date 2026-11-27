# ADR 0039: Two-step verification required for Admin Console staff

- Status: Accepted
- Date: 2026-11-27

## Context

The security audit (OWASP ASVS V2) found staff accounts — which approve payouts, issue
refunds and read customer and seller data — could use the Admin Console with a password only;
two-step verification (Phase 2, ADR 0014) was optional.

## Decision

- `STAFF_MFA_REQUIRED` (refused `false` in production). While a staff member has no
  authenticator app, the API accepts only their session, the two-step set-up routes, password
  change and sign-out (`@AllowWithoutMfa`); everything else answers 403
  `MFA_ENROLLMENT_REQUIRED`, and the Admin Console shows only the set-up screen.
- Turning two-step verification on or off invalidates the cached principal, so it takes effect
  on the next request without signing in again.
- Customers and the Seller Center are not affected (sellers can turn it on themselves).

## Consequences

- The first super admin turns it on at first sign-in. Losing the authenticator needs a
  recovery code, or another super admin resetting it (Phase 2).
