# Security guide

The marketplace's security controls, the Phase 8 review against **OWASP Top 10 (2021)** and
**OWASP ASVS 4.0.3**, the operational rules for running it, and incident response. The
prioritized list of what the review found and fixed is in [AUDIT_REPORT.md](AUDIT_REPORT.md).

## 1. Summary

- No known critical or high-severity vulnerability is open (AUDIT_REPORT.md: 2 critical and 8
  high findings, all fixed and covered by tests; `pnpm audit --prod` reports none).
- Card data never touches the marketplace: online payments go to PayMongo's hosted checkout;
  the database has no card number or CVV column, and logs redact `cardNumber`/`cvv` fields.
- Every control below is enforced by the server; the frontends only reflect it.

## 2. Controls by area (ASVS chapters)

| Area                              | ASVS       | Control                                                                                                                                                                                                                                                                                                                                                   | Where / how verified                                                                                                                                                                |
| --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**                  | V1         | Modular monolith; every request passes rate limit → CSRF → authentication → roles → permissions guards; services re-check ownership. Deny by default: a route needs `@Public`, `@Roles` or `@RequirePermissions`.                                                                                                                                         | `app.module.ts` guard order; `route-access.e2e-spec.ts` inventories every route (over 400) against reviewed lists.                                                                  |
| **Authentication**                | V2         | Argon2id password hashes; minimum length, maximum 128; lockout after 5 failures for 15 minutes; generic sign-in errors (no account enumeration); SMS one-time codes (HMAC-stored, attempt-limited, rate-limited); TOTP two-step verification with recovery codes; **required for Admin Console staff in production**.                                     | `auth.e2e-spec.ts`, `mfa.e2e-spec.ts`, `staff-mfa-required.e2e-spec.ts`.                                                                                                            |
| **Sessions**                      | V3         | 15-minute signed access tokens (HS256, issuer/audience/app checked) in HttpOnly, Secure, SameSite=Lax cookies scoped per app; rotating single-use refresh tokens (hashes stored), reuse detection revokes the family; revocation and suspension take effect on the next request; sign out everywhere.                                                     | `auth.e2e-spec.ts`; CI smoke test checks the cookie flags over HTTPS.                                                                                                               |
| **Access control**                | V4         | Roles → permissions catalogue; seller scope taken from the active membership, never from the request; staff routes permission-gated; customers see only their own orders, addresses, tickets.                                                                                                                                                             | `integrity.e2e-spec.ts` (isolation matrix), `sellers/products/fulfilment/engagement/checkout` e2e isolation tests.                                                                  |
| **Validation**                    | V5         | Zod schemas for every body, query and parameter (shared with the frontends); prices, totals and discounts always computed by the server (`expectedGrandTotal` only detects changes); money as decimals.                                                                                                                                                   | `ZodGlobalValidationPipe`; checkout and promotion tests.                                                                                                                            |
| **Injection**                     | V5.3       | Prisma queries and tagged-template raw SQL (parameters bound); no string-built SQL with input (the only `Prisma.raw` uses are constants). React escapes output; no `dangerouslySetInnerHTML`; e-mail templates escape values; CSV exports neutralise formula injection.                                                                                   | Code review; `notifications.spec.ts`, `analytics.spec.ts`.                                                                                                                          |
| **Cryptography**                  | V6         | TOTP secrets and seller bank account numbers encrypted with AES-256-GCM (separate keys); backups encrypted with AES-256-CBC before leaving the server; TLS 1.2+ at the edge with HSTS.                                                                                                                                                                    | `crypto.spec.ts`, `finance.e2e-spec.ts`.                                                                                                                                            |
| **Errors and logging**            | V7         | Unexpected errors return a generic 500 with a request id; full details only in logs/Sentry. Logs are JSON with redaction of passwords, tokens, secrets, cookies, authorization headers, card and account numbers; access logs drop `?token=`. Append-only **audit log** (database trigger blocks UPDATE/DELETE/TRUNCATE) for staff and financial actions. | `global-exception.filter.spec.ts`, logging module, migration `identity_and_access`.                                                                                                 |
| **Data protection**               | V8         | Private buckets with short-lived signed URLs; seller documents and payment proofs served only to their owner or authorised staff, `no-store`; API responses never include password hashes, secrets or full bank account numbers.                                                                                                                          | `sellers.e2e-spec.ts` document privacy; finance tests (masked numbers).                                                                                                             |
| **Communications**                | V9         | HTTPS only (HTTP → 308), HSTS, automatic certificates; internal services on private networks; only 80/443 published.                                                                                                                                                                                                                                      | CI smoke test.                                                                                                                                                                      |
| **Malicious code / supply chain** | V10, V14.2 | Lockfile installs (`--frozen-lockfile`), dependency audit, images built in CI with SBOM and provenance, pinned base image tags, non-root containers.                                                                                                                                                                                                      | `release.yml`, `pnpm audit --prod`.                                                                                                                                                 |
| **Business logic**                | V11        | Idempotency keys for orders, payments, refunds, payouts; row locks in a fixed order (order → payment → stock); state machines; database constraints for stock (`reserved ≤ on hand`), money (amount checks) and the ledger (balanced journals, immutable once posted); per-route rate limits on sign-in, OTP, invitations, affiliate clicks.              | `integrity.e2e-spec.ts` (webhook bursts, concurrent refunds and remittances, rollback), `checkout.e2e-spec.ts` (oversell, duplicate submit, coupon limits), finance reconciliation. |
| **Files**                         | V12        | Size limits; type detected from content (magic bytes), not the name; images decoded with a pixel limit (40 MP), re-encoded and stripped of metadata; downloads with `Content-Disposition: attachment` and `nosniff`.                                                                                                                                      | `detect-file-type.spec.ts`, `object-storage.e2e-spec.ts`.                                                                                                                           |
| **API and web services**          | V13        | CSRF double-submit token on every state-changing request plus SameSite cookies; CORS closed (same-origin); webhooks authenticated by HMAC signature over the raw body with a timestamp window, stored once per event id.                                                                                                                                  | `http-pipeline.e2e-spec.ts`, `payments.e2e-spec.ts`; CI smoke test (forged PayMongo webhook → 401, mock webhook disabled → 404).                                                    |
| **Configuration**                 | V14        | Helmet security headers on the API; CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy on the frontends; Swagger and developer tools off; production refuses development secrets, test payment keys, mock providers, insecure cookies and optional staff MFA.                                                                                      | `app-config.spec.ts`, `worker-config.spec.ts`, CI smoke test.                                                                                                                       |

## 3. OWASP Top 10 (2021)

| Risk                                           | Status                     | Notes                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 Broken Access Control                      | Mitigated                  | Deny-by-default guards, route inventory test, seller isolation matrix, ownership checks in services, IDs are UUIDv7 (not guessable sequences) but never relied on for access. |
| A02 Cryptographic Failures                     | Mitigated                  | TLS everywhere public; AES-256-GCM for secrets at rest; Argon2id; no card data stored.                                                                                        |
| A03 Injection                                  | Mitigated                  | Parameterised SQL, schema validation, output encoding, CSV formula neutralisation.                                                                                            |
| A04 Insecure Design                            | Mitigated                  | Server-side pricing, idempotency, locks, ledger constraints; concurrency tests found and fixed C2.                                                                            |
| A05 Security Misconfiguration                  | Mitigated                  | Production configuration validation (fails closed), hardened headers, no default credentials, internal-only metrics.                                                          |
| A06 Vulnerable Components                      | Mitigated, ongoing         | Audit clean at release; re-run `pnpm audit --prod` and rebuild images monthly and on advisories.                                                                              |
| A07 Identification and Authentication Failures | Mitigated                  | Lockout, rate limits, MFA (required for staff), session rotation and revocation.                                                                                              |
| A08 Software and Data Integrity Failures       | Mitigated                  | Signed webhooks, CI-built images with provenance, append-only audit log and ledger.                                                                                           |
| A09 Logging and Monitoring Failures            | Mitigated                  | Structured logs to Loki, audit log, metrics and alerts (payments, webhooks, workers, backups), error tracking.                                                                |
| A10 SSRF                                       | Not applicable / mitigated | The server only calls fixed provider hosts (PayMongo, Semaphore, SMTP, S3); no user-supplied URLs are fetched.                                                                |

## 4. Rate limits

| Scope                                | Limit                              | Notes                                           |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| Every route, per client IP           | 300 requests / 60 s (configurable) | Redis-backed, shared by all replicas.           |
| Sign-in, password reset, invitations | 10 / minute per IP                 | Plus account lockout (5 failures → 15 minutes). |
| SMS codes                            | 5 / minute per IP                  | Plus per-number attempt limits.                 |
| Two-step codes                       | own limit                          |                                                 |
| Seller invitations                   | 10 / minute                        |                                                 |
| Affiliate clicks                     | 30 / minute                        |                                                 |

Behind a CDN, set `CDN_TRUSTED_PROXIES` and `TRUST_PROXY` correctly or every shopper will
share the CDN's address.

## 5. Payments and webhooks

- Card data, GCash, Maya and QR Ph details are entered on PayMongo's pages only.
- PayMongo webhooks: `Paymongo-Signature` HMAC over `timestamp.body` with the webhook
  secret, 10-minute replay window, live/test mode must match the key, stored once per event
  id, processed idempotently (a payment is applied once however often or concurrently the
  event arrives). Failed events can be re-processed by finance from the Admin Console.
- The mock provider and the mock courier are disabled in production (their endpoints answer 404) and the configuration refuses them.
- A reconciliation job asks PayMongo about open payments every five minutes, so a missed
  webhook cannot leave an order unpaid.

## 6. Operating securely

- **Secrets**: only in `.env.production` (mode 600) and the password vault; never in the
  repository, images, CI logs or tickets. Rotate after staff changes or suspected exposure:
  database and Redis passwords, S3 keys, SMTP/SMS keys and `AUTH_JWT_SECRET`/`AUTH_OTP_SECRET`
  can be rotated by changing them and restarting; `AUTH_MFA_ENCRYPTION_KEY` and
  `FINANCE_ENCRYPTION_KEY` cannot be rotated without re-encrypting data (plan it as a
  migration).
- **Access**: SSH keys only, from the office/VPN; GitHub environment approvals for every
  deployment; staff accounts are personal (no shared logins), least-privilege roles, two-step
  verification; remove leavers the same day (suspend the user: sessions end immediately).
- **Updates**: OS security updates automatically; rebuild and redeploy images monthly (new
  base images) and immediately for advisories affecting dependencies.
- **Reviews**: monthly review of the audit log for staff actions on refunds, payouts, bank
  accounts and role changes; quarterly restore drill (BACKUP_AND_RECOVERY.md §6).
- **Penetration test**: commission an external test before or shortly after launch; this
  review is not a substitute.

## 7. Incident response

| Signal                                                     | First steps                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiDown`, `SiteUnreachable`                               | `DC ps`, `DC logs --tail 200 api edge`; database and Redis health; roll back the last release (`./deploy.sh --rollback`) if it started after a deploy.                                                                                                               |
| `ApiHighErrorRate`, `ApiUnhandledErrors`                   | Error tracking for the stack trace (request id in the API response).                                                                                                                                                                                                 |
| `PaymentWebhooksStuck` / `…Failing`, `PaymentFailureSpike` | PayMongo status page; Admin Console › Payments › Provider events (re-process); check `PAYMONGO_WEBHOOK_SECRET` if signatures are rejected.                                                                                                                           |
| `WebhookSignatureRejections`                               | Wrong secret after a rotation, or someone forging webhooks: compare source IPs in the edge logs; nothing is applied without a valid signature.                                                                                                                       |
| `WorkerDown`, `JobsDeadLettered`, `QueueBacklog`           | `DC logs worker`; Admin Console › Developer tools is off in production, so inspect dead letters with `DC exec redis redis-cli` or temporarily on staging; restart the worker (jobs resume).                                                                          |
| `DatabaseBackup*`, `PostgresWalArchiveFailing`             | `DC logs backup`, `DC exec backup marketplace-backup info`; S3 credentials or bucket policy; disk space (WAL accumulates).                                                                                                                                           |
| Suspected account compromise                               | Suspend the user (sessions end at once), reset their two-step verification, review the audit log, rotate any secret they could see.                                                                                                                                  |
| Suspected data breach                                      | Contain (revoke keys, block access), preserve logs, notify the Data Protection Officer: the Philippine Data Privacy Act requires notifying the National Privacy Commission and affected people within 72 hours of knowledge of a breach that may cause serious harm. |

## 8. Reporting a vulnerability

Publish a security contact (e.g. `security@<domain>` and `/.well-known/security.txt` on the
storefront) before launch, and triage reports within one business day.
