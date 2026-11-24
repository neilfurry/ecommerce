# ADR 0014: Optional two-step verification (TOTP)

- Status: Accepted
- Date: 2026-11-26

## Context

The Phase 2 brief asks for optional MFA infrastructure. Admin and seller accounts control money
and personal data, so the sign-in flow must support a second factor without making it mandatory
yet.

## Decision

- **Authenticator apps (TOTP, RFC 6238):** SHA-1, 6 digits, 30-second steps, one step of clock
  drift accepted either way. The last accepted step is stored, so a code cannot be replayed.
  The implementation is a small, dependency-free module (`totp.ts`) tested against the RFC 6238
  vectors.
- **Secrets are encrypted at rest** with AES-256-GCM using `AUTH_MFA_ENCRYPTION_KEY` (at least 32
  characters, different from the token secrets; configuration validation enforces both).
- **Recovery codes:** 10 single-use codes, stored as hashes and shown once. Using one counts as
  a code; regenerating requires a current code.
- **Turning it on or off needs proof:** setup needs the password; enabling needs a first valid
  code; disabling needs the password and a code.
- **Sign-in:** when enabled, password sign-in and SMS sign-in return
  `{ mfaRequired, mfaToken, expiresAt }` and set no cookies. The challenge lives in Redis for 5
  minutes with at most 5 attempts; `POST /auth/mfa/verify` then issues the session. All apps use
  the same flow and the shared sign-in form handles it.
- **Recovery by an administrator:** `POST /users/{id}/mfa/reset` (`users.update`) turns it off
  and signs the account out; it is audited. Staff are told to confirm the person's identity first.

## Consequences

- Making two-step verification mandatory for staff later is a policy check in `finishSignIn`;
  no schema change is needed.
- WebAuthn/passkeys can be added as another factor type alongside `user_mfa`.
