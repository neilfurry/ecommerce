# Phase 2 report: Identity and access

- Branch: `phase-2-identity` (PR #2, based on `phase-1-foundation`)
- Date: 2026-11-25
- Verified on: GitHub Actions run `45447337672`, commit `600d1de` (all three jobs green)
- Status: **Complete, awaiting review and approval.** Phase 3 has not been started.

Decisions applied (from the Phase 1 review):

1. `CUSTOMER` and `WHOLESALE_CUSTOMER` sign up themselves; every other role is created by an
   administrator.
2. Customers sign in with **either** mobile number + SMS code **or** email + password. Both
   the mobile number (SMS code) and the email address (link) are verified at sign-up.
3. Wholesale customers shop at retail prices immediately; wholesale unlocks when an admin
   approves their business details.

## 1. Implemented features

### Customers (storefront)

- **Sign-up** (`/sign-up`): personal or business (wholesale) account; name, mobile, email,
  password; TIN and business address for wholesale. A 6-digit SMS code confirms the number
  _before_ the account exists. After confirmation the customer is signed in, and a link to
  confirm the email address is emailed.
- **Sign-in** (`/sign-in`): tabs for _Mobile number_ (SMS code) and _Email_ (password).
  Returns the customer to the page that required sign-in.
- **Forgot / reset password**, **email confirmation** (`/verify-email`), **My account**
  (`/account`): profile with verification status and "send confirmation email", wholesale
  application status / apply / re-apply after rejection, change password, sign out of all devices.
- Header shows _Sign in_ / _Create account_, or _My account_ and the account menu.

### Staff (Seller Center and Admin Console)

- Email + password sign-in, forgot/reset password, invitation acceptance (`/accept-invitation`),
  account menu (change password, sign out, sign out of all devices). Every page except these
  requires a session; signed-out visitors go to sign-in and back.
- **Admin Console** pages, each shown only to roles with the permission:
  - **Users**: search by name, email or mobile; filter by type, role, status; invite staff;
    account details; edit names and staff roles; suspend / reactivate; sign out everywhere;
    resend invitation.
  - **Wholesale approvals**: pending (oldest first), approved, rejected; approve, or reject with
    a reason the customer receives.
  - **Roles & permissions**: every role with its permissions and account count; super admins
    edit them (changes apply on the next request).
  - **Audit log**: every sign-in and administrative action, filterable by action.
  - **Developer tools → SMS outbox** (development only): texts the mock provider captured.
- Navigation lists only pages the signed-in role may open.

### API and security

- Sessions in HttpOnly cookies per app, 15-minute access tokens, rotating refresh tokens with
  reuse detection, revocation that takes effect on the next request, CSRF double-submit,
  Argon2id passwords (12+ characters), lock-out after 5 failures for 15 minutes, no account
  enumeration, strict per-address limits on credential routes, per-number SMS limits (ADR 0010,
  ADR 0012).
- 14 roles, an 11-permission catalog, configurable role permissions, hierarchical granting,
  last-super-admin protection, invitation-only staff accounts (ADR 0011).
- Append-only audit log enforced by a database trigger.
- Worker: transactional email templates (confirm email, password reset, staff invitation,
  wholesale decision) and SMS delivery through an `SmsProvider` port with `mock` and
  `semaphore` adapters. Codes are removed from dead letters and never logged.
- Developer tools now require the `dev-tools.use` permission.
- `pnpm db:bootstrap-admin` creates the first super admin outside development.

## 2. Created and modified files

171 files (97 added, 72 modified, 1 renamed, 1 removed). Main locations:

| Area         | Files                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts    | `packages/shared-types/src/auth.ts` (roles, permissions, apps), `packages/validation/src/identity.ts`, `notifications.ts`                                                                                                      |
| Database     | `prisma/schema.prisma`, `prisma/migrations/20261125090000_identity_and_access/`, `prisma/src/password.ts`, `prisma/src/seed-identity.ts`, `prisma/seed.ts`, `prisma/bootstrap-super-admin.ts`                                  |
| API          | `apps/api/src/modules/{auth,users,roles,wholesale,audit,notifications}/`, `dev-tools` (permission, SMS outbox), config (auth, app URLs)                                                                                        |
| Worker       | `apps/worker/src/mail/templates.ts`, `jobs/transactional-email.handlers.ts`, `jobs/sms-otp.handler.ts`, `sms/`                                                                                                                 |
| Client       | `packages/api-client/src/{client,auth,admin,auth-react}.ts(x)`                                                                                                                                                                 |
| UI           | `packages/ui`: Checkbox, Tabs, DropdownMenu, PasswordInput, AuthShell; new `packages/auth-ui` (sign-in, password and invitation screens, route guards, account menu)                                                           |
| Frontends    | storefront `pages/auth`, `pages/account`, `components/otp-step.tsx`; seller `app/seller-layout.tsx`; admin `pages/{users,roles,wholesale,audit}`, `pages/dev-tools/sms-outbox-page.tsx`, `app/{admin-layout,navigation}.ts(x)` |
| Tests        | API `auth.e2e-spec.ts`, `administration.e2e-spec.ts`, `auth-helpers.ts`, guard/token/crypto specs; worker handler, SMS and integration tests; frontend flow tests; Playwright `auth.setup.ts`, `identity.spec.ts`              |
| Docs         | ADR 0010–0012, API reference, architecture, Windows setup, local database, testing guide, this report                                                                                                                          |
| Scripts / CI | `setup.ps1` adds new settings to an existing `.env`; CI checks it                                                                                                                                                              |

## 3. Database changes

Migration `20261125090000_identity_and_access` (hand-written, verified against the schema by the
CI drift check):

- Enums `user_status`, `client_app`, `session_revoke_reason`, `otp_purpose`,
  `verification_token_purpose`, `wholesale_application_status`, `audit_outcome`.
- Tables `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`,
  `otp_challenges`, `verification_tokens`, `wholesale_applications`, `audit_logs`.
- CHECK constraints: lowercase email; E.164 mobile; non-negative counters; active accounts must
  have a password; consistent session revocation and wholesale review fields; valid TIN.
- Trigger `audit_logs_prevent_mutation` rejects UPDATE, DELETE and TRUNCATE on `audit_logs`.
- Seed: roles and permissions synchronised on every `db:seed`; demo accounts in development only.

## 4. API endpoints

Listed with request and response shapes in [API_REFERENCE.md](../api/API_REFERENCE.md):
17 under `/api/v1/auth`, 2 under `/api/v1/account`, 13 under `/api/v1/admin`, plus
`GET /api/v1/dev/sms-outbox`. All are in Swagger at http://localhost:3000/api/docs.

## 5. Environment variables

New (all present in `.env.example`; `setup.ps1` adds them to an existing `.env`):

| Variable                                                                                                  | Purpose                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`, `AUTH_OTP_SECRET`                                                                      | Access-token signing and SMS-code hashing keys (different, 32+ characters; replace in production) |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` (900), `AUTH_CUSTOMER_SESSION_DAYS` (30), `AUTH_STAFF_SESSION_HOURS` (12) | Session lifetimes                                                                                 |
| `AUTH_MAX_FAILED_SIGN_INS` (5), `AUTH_LOCKOUT_MINUTES` (15)                                               | Lock-out                                                                                          |
| `COOKIE_SECURE` (required `true` in production), `COOKIE_DOMAIN`                                          | Cookie attributes                                                                                 |
| `STOREFRONT_URL`, `SELLER_PORTAL_URL`, `ADMIN_PORTAL_URL`                                                 | Links in emails                                                                                   |
| `SMS_PROVIDER` (`mock`/`semaphore`), `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME`                         | SMS gateway (mock refused in production)                                                          |
| `SEED_DEMO_USERS`, `SEED_DEMO_PASSWORD`                                                                   | Development demo accounts                                                                         |
| `BOOTSTRAP_ADMIN_*` (set only when running `pnpm db:bootstrap-admin`)                                     | First super admin                                                                                 |

## 6. Starting the project (Windows PowerShell)

```powershell
git fetch
git checkout phase-2-identity
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1   # migrates, seeds, adds new .env settings
.\scripts\start.ps1
```

Sign in with the demo accounts (password `Marketplace-dev-2026!`):

| App                                 | Account                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| Admin Console http://localhost:5175 | `superadmin@marketplace.local` (also `admin@…`, `support@…`) |
| Seller Center http://localhost:5174 | `seller.owner@marketplace.local`                             |
| Storefront http://localhost:5173    | `customer@marketplace.local`, or by SMS to `0917 000 0001`   |

SMS codes appear in Admin Console → Developer tools → **SMS outbox**; emails in Mailpit
(http://localhost:8025).

## 7. Test results

All results below come from GitHub Actions; nothing was counted from a run that did not happen.

Run `45447337672`, commit `600d1de`:

| Suite                                                     | Result                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (11 packages)                                  | **309 passed**: validation 83, api 83, worker 37, ui 27, api-client 26, admin-portal 16, storefront 10, config 8, seller-portal 7, database 7, auth-ui 5 |
| API e2e (real PostgreSQL, Redis, MinIO)                   | **92 passed** in 9 suites (49 new identity and administration tests)                                                                                     |
| Worker integration (real Redis, in-process SMTP)          | **9 passed** (2 new: confirmation email, SMS outbox)                                                                                                     |
| Playwright (desktop + Pixel 7)                            | **22 passed**, 0 flaky (flaky tests fail CI)                                                                                                             |
| Typecheck, lint, formatting, production builds            | Passed                                                                                                                                                   |
| Migration drift check (`prisma migrate diff --exit-code`) | No differences                                                                                                                                           |
| PowerShell scripts on pwsh + Docker Compose               | Passed, including `setup.ps1` adding the new settings to an older `.env`                                                                                 |

Fixed during verification: seeding failed before packages were built (the seed now resolves
workspace packages from source), the storefront header overflowed on narrow phones, and one
e2e helper produced uppercase emails that the database correctly rejected.

## 8. Remaining issues and limitations

- **Semaphore adapter not exercised live.** It is unit-tested against Semaphore's documented
  request and response format; sending a real SMS needs your API key (`SMS_PROVIDER=semaphore`).
- **API not run on the development workstation used to build this phase.** The Prisma engine
  download is blocked there, so the API was compiled, tested and run only in CI (where every
  suite above passed). Frontends, worker and packages were also tested locally.
- Seller roles exist and seller staff can sign in to the Seller Center, but sellers, stores and
  seller-scoped access arrive with seller onboarding in Phase 3; admins cannot yet grant seller
  roles.
- Mobile apps would need a header-based session variant (not in scope).
- No two-factor authentication for staff yet (recommended before production; not in the brief).

## 9. Acceptance

| Requirement                                                   | Status                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Customers and wholesale customers sign up themselves          | Done (retail and wholesale)                                            |
| All other roles created only by an administrator              | Done (invitation; no other path)                                       |
| Mobile + SMS code and email + password sign-in, both verified | Done                                                                   |
| Wholesale unlocked by admin approval                          | Done                                                                   |
| 14 roles, configurable permissions                            | Done                                                                   |
| Secrets, passwords and codes never in responses or logs       | Done (redaction, HMAC/Argon2id, audit sanitisation; asserted in tests) |
| Windows PowerShell setup                                      | Done (`setup.ps1` upgrades an existing `.env`)                         |
| Tests executed                                                | See section 7                                                          |

## 10. Dependencies for Phase 3 (Sellers and stores)

Phase 3 builds on the session's `sellerId` (empty until sellers exist), the seller roles,
`@RequirePermissions` with new permissions (seller approval), the invitation flow (seller staff
invitations should land in the Seller Center, already supported), the audit log and the
notification jobs.
