# Phase 2 report: Authentication, user management and seller management

- Branch: `phase-2-identity` (PR #2, based on `phase-1-foundation`)
- Date: 2026-11-26
- Verified on: GitHub Actions run `45510410245`, commit `c35d678` (all three jobs green)
- Status: **Complete, awaiting review and approval.** Phase 3 has not been started and will
  not start until you send the Phase 3 details.

Phase 2 was delivered in two parts on the same branch: identity and access (customers, staff,
sessions, roles), then the extended brief (sellers, verification, stores, seller staff,
permission scopes, two-step verification). This report covers both.

Decisions applied:

1. `CUSTOMER` and `WHOLESALE_CUSTOMER` sign up themselves; every other role is created by an
   administrator.
2. Customers sign in with **either** mobile number + SMS code **or** email + password. Both
   the mobile number (SMS code) and the email address (link) are verified at sign-up.
3. Wholesale customers shop at retail prices immediately; wholesale unlocks when an admin
   approves their business details.
4. **Sellers apply themselves** in the Seller Center and become the owner of a `PENDING`
   seller. Owners (and managers) invite their own employees. Marketplace staff remain
   admin-invited only.

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
  - **Roles**: grouped as marketplace staff, seller teams and customers; each role shows only
    permissions of its own scope; super admins edit them (changes apply on the next request).
  - **Permissions**: the catalog of platform and seller permissions with the roles holding each.
  - **Sellers**: applications by status (under review oldest first), search; seller detail with
    business details, private documents (viewed through the API, each view audited), history and
    stores; approve, reject with a reason, request more information, suspend, reinstate, close.
  - **Stores**: every store by status, search, per seller; suspend with a reason, reinstate.
  - **User detail** also shows two-step verification and seller membership, with **Reset
    two-step verification**.
  - **Audit log**: every sign-in and administrative action, filterable by action.
  - **Developer tools → SMS outbox** (development only): texts the mock provider captured.
- Navigation lists only pages the signed-in role may open.

### Sellers (Seller Center)

- **Register** (`/register`): business name and type, owner, business mobile, email, password.
  Creates the owner account, a `PENDING` seller and signs in; a confirmation link is emailed.
- **Dashboard**: status, next step (finish application, under review, fix and resubmit, create
  your first store), store and employee counts. A banner shows when the seller is suspended or
  closed.
- **Business profile**: legal details (name, type, DTI/SEC/CDA number, TIN, VAT) editable only
  until submitted; contact and address.
- **Verification**: checklist of what is missing, document upload (PDF, JPEG, PNG; type checked
  by content), view and remove own documents, submit, status message (including the reviewer's
  note) and history.
- **Stores** (verified sellers, up to 5): create with a live link check; details, contact,
  address, social links; logo and banner; colours, announcement, shipping and return policies,
  vacation mode; open or hide. A suspended store shows the marketplace's reason and is read-only.
- **Employees**: team and pending invitations; invite by email with roles and extra
  permissions; edit access; suspend, reactivate, remove; resend or cancel invitations. The owner
  row and your own row cannot be changed.
- **Join** (`/join`): invitees create an account, or confirm the password of an existing one.
- **Account settings**: profile, email confirmation, change password, two-step verification,
  sign out of all devices.

### Two-step verification (every app)

- Optional authenticator-app codes (TOTP) for any account, from the account menu (staff) or
  My account (customers): QR code and manual key, first code to confirm, 10 one-time recovery
  codes, regenerate, turn off with password and code.
- When on, password and SMS sign-in ask for the code before the session starts.

### API and security

- Sessions in HttpOnly cookies per app, 15-minute access tokens, rotating refresh tokens with
  reuse detection, revocation that takes effect on the next request, CSRF double-submit,
  Argon2id passwords (12+ characters), lock-out after 5 failures for 15 minutes, no account
  enumeration, strict per-address limits on credential routes, per-number SMS limits (ADR 0010,
  ADR 0012).
- 14 roles, a 20-permission catalog in two scopes (16 platform, 4 seller), configurable role
  permissions limited to each role's scope, locked `SUPER_ADMIN` and `SELLER_OWNER`,
  hierarchical granting, last-super-admin protection, invitation-only staff accounts (ADR 0011,
  ADR 0013).
- **Seller data isolation**: seller roles count only with an active membership; every
  seller-side query is filtered by the signed-in person's seller, so another seller's stores,
  documents and employees answer 404 (ADR 0013).
- **Seller verification** state machine with compare-and-set transitions, history, audit
  entries and owner emails; private documents streamed only through the API.
- **Two-step verification**: TOTP with replay protection, AES-256-GCM-encrypted secrets, hashed
  recovery codes, 5-minute / 5-attempt sign-in challenge in Redis, audited admin reset
  (ADR 0014).
- Endpoint paths follow the brief: `/users`, `/roles`, `/permissions`, `/sellers`, `/stores`,
  `/seller/members` (the Phase 1 `/admin/*` paths were renamed).
- Append-only audit log enforced by a database trigger.
- Worker: transactional email templates (confirm email, password reset, staff invitation,
  wholesale decision, seller status changes, seller employee invitation) and SMS delivery through an `SmsProvider` port with `mock` and
  `semaphore` adapters. Codes are removed from dead letters and never logged.
- Developer tools now require the `dev-tools.use` permission.
- `pnpm db:bootstrap-admin` creates the first super admin outside development.

## 2. Created and modified files

230 files compared with `phase-1-foundation` (151 added, 77 modified, 1 renamed, 1 removed).
The seller extension alone: 122 files (54 added, 68 modified). Main locations:

| Area         | Files                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts    | `packages/shared-types/src/{auth,sellers}.ts` (roles, scoped permission catalog, seller and store constants), `packages/validation/src/{identity,sellers,notifications}.ts`                                                                                                                       |
| Database     | `prisma/schema.prisma`, migrations `20261125090000_identity_and_access/` and `20261126090000_sellers_stores_mfa/`, `prisma/src/seed-identity.ts` (scoped permissions, demo seller), `prisma/seed.ts`, `prisma/bootstrap-super-admin.ts`                                                           |
| API          | `apps/api/src/modules/{auth,users,roles,wholesale,audit,notifications,sellers,stores,seller-members}/`, `modules/auth/{mfa.service,mfa.controller,totp}.ts`, `common/auth/seller-scope.ts`, config (`AUTH_MFA_ENCRYPTION_KEY`)                                                                    |
| Worker       | `apps/worker/src/mail/templates.ts`, `jobs/transactional-email.handlers.ts` (seller status, seller invitation), `jobs/sms-otp.handler.ts`, `sms/`                                                                                                                                                 |
| Client       | `packages/api-client/src/{client,auth,admin,react,auth-react}.ts(x)` (seller, store, member, MFA and permission clients and hooks; blob downloads)                                                                                                                                                |
| UI           | `packages/ui` (Checkbox, Tabs, DropdownMenu, PasswordInput, AuthShell, sidebar `content` slot); `packages/auth-ui` (sign-in with two-step step, `TwoStepDialog`, shared `VerifyEmailPage`)                                                                                                        |
| Frontends    | Seller Center `pages/{auth,dashboard,profile,verification,stores,employees,account}`, `app/{routes,navigation,seller-layout}`; Admin Console `pages/{sellers,stores,permissions,roles,users}`, `components/{reason-dialog,seller-status,store-status}`; storefront account and sign-in (two-step) |
| Tests        | API `sellers`, `stores`, `seller-members`, `mfa` e2e suites, `totp.spec.ts`; frontend `seller-pages.test.tsx`, `marketplace.test.tsx`, auth-ui two-step test; Playwright `sellers.spec.ts`                                                                                                        |
| Docs         | ADR 0010–0014, API reference, architecture, Windows setup, local database, testing guide, this report                                                                                                                                                                                             |
| Scripts / CI | `setup.ps1` adds new settings to an existing `.env`; CI checks `AUTH_MFA_ENCRYPTION_KEY` too                                                                                                                                                                                                      |

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

Migration `20261126090000_sellers_stores_mfa`:

- Enums `seller_status`, `business_type`, `seller_document_type`, `seller_event_type`,
  `seller_member_status`, `store_status`; new values for `file_purpose` (`SELLER_DOCUMENT`,
  `STORE_LOGO`, `STORE_BANNER`) and `session_revoke_reason` (`SELLER_MEMBERSHIP_ENDED`);
  `permissions.scope`.
- Tables `user_mfa`, `mfa_recovery_codes`, `sellers`, `seller_documents`, `seller_events`,
  `seller_members` (one seller per person), `seller_member_permissions`, `seller_invitations`,
  `stores` (unique slug), `store_settings`.
- Indexes for status queues (sellers by status and submission date, stores by seller and
  status, invitations by seller and email) and the foreign keys used in lookups.
- CHECK constraints: permission scope; lowercase emails; E.164 mobiles; 4-digit postal codes;
  TIN format; status and timestamp consistency (submitted, verified, closed, suspended); slug
  format; hex colours; social links as an object; invitation states.
- Seed: roles and permissions (with scopes) synchronised on every `db:seed`; out-of-scope grants
  removed; demo accounts in development only, now including a verified demo seller with an
  owner, an employee and the store `sam-sari-sari`.

## 4. API endpoints

Listed with request and response shapes in [API_REFERENCE.md](../api/API_REFERENCE.md), and in
Swagger at http://localhost:3000/api/docs:

| Group                                                                                                                     | Endpoints |
| ------------------------------------------------------------------------------------------------------------------------- | --------- |
| `/api/v1/auth/*` (sign-up, sign-in, seller sign-up, sessions, email, passwords, invitations, seller invitations, `mfa/*`) | 26        |
| `/api/v1/account/*`                                                                                                       | 2         |
| `/api/v1/users/*`, `/roles/*`, `/permissions`                                                                             | 12        |
| `/api/v1/sellers/*` (6 for the seller, 7 for admins)                                                                      | 13        |
| `/api/v1/stores/*` (public, seller and admin)                                                                             | 15        |
| `/api/v1/seller/members/*`                                                                                                | 8         |
| `/api/v1/wholesale-applications/*`, `/audit-logs`                                                                         | 3         |

## 5. Environment variables

New (all present in `.env.example`; `setup.ps1` adds them to an existing `.env`):

| Variable                                                                                                  | Purpose                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`, `AUTH_OTP_SECRET`                                                                      | Access-token signing and SMS-code hashing keys (different, 32+ characters; replace in production) |
| `AUTH_MFA_ENCRYPTION_KEY`                                                                                 | Encrypts authenticator secrets (32+ characters, different from the others; replace in production) |
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

| App                                 | Account                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Admin Console http://localhost:5175 | `superadmin@marketplace.local` (also `admin@…`, `support@…`)                                                                     |
| Seller Center http://localhost:5174 | `seller.owner@marketplace.local` (owner of the verified "Sam Sari-Sari Trading"), `seller.staff@marketplace.local` (its encoder) |
| Storefront http://localhost:5173    | `customer@marketplace.local`, or by SMS to `0917 000 0001`                                                                       |

SMS codes appear in Admin Console → Developer tools → **SMS outbox**; emails in Mailpit
(http://localhost:8025). To try the seller journey: register at http://localhost:5174/register,
confirm the email from Mailpit, fill in **Business profile**, upload the three required
documents and submit; approve it in Admin Console → **Sellers**; then create a store and invite
an employee.

## 7. Test results

All results below come from real runs; nothing was counted from a run that did not happen.

GitHub Actions run `45510410245`, commit `c35d678` (all three jobs green):

| Suite                                                     | Result                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (11 packages)                                  | **337 passed**: api 93, validation 83, worker 39, ui 27, api-client 26, admin-portal 24, seller-portal 14, storefront 10, config 8, database 7, auth-ui 6                                                                                                     |
| API e2e (real PostgreSQL, Redis, MinIO)                   | **134 passed** in 13 suites (42 new: sellers 15, stores 9, seller employees 10, two-step verification and tokens 8)                                                                                                                                           |
| Worker integration (real Redis, in-process SMTP)          | **9 passed**                                                                                                                                                                                                                                                  |
| Playwright (desktop + Pixel 7)                            | **26 passed**, 1 skipped (a mobile-only test in the desktop project), 0 flaky. Includes the full journey: register → confirm email → profile → 3 documents → submit → admin approves → create store → invite employee → employee joins with restricted access |
| Typecheck, lint, formatting, production builds            | Passed                                                                                                                                                                                                                                                        |
| Migration drift check (`prisma migrate diff --exit-code`) | No differences                                                                                                                                                                                                                                                |
| PowerShell scripts on pwsh + Docker Compose               | Passed                                                                                                                                                                                                                                                        |

The API suites were also run locally against PostgreSQL 16, Redis and an S3-compatible server
(134 passed), as were all unit suites.

Brief §9 coverage: registration and login, invalid credentials, email verification, password
reset, token expiration, refresh rotation, unauthorized access, seller data isolation, seller
verification workflow, staff invitation and permission enforcement each have API e2e tests;
the mapping is in [TESTING_GUIDE.md](../testing/TESTING_GUIDE.md).

Fixed during verification: the first browser run of the new specs failed on two selectors (an
ambiguous "Corporation" option and the Seller Center's new start page); both specs were
corrected and the next run was green. Earlier fixes: seeding before packages were built, the
storefront header on narrow phones, uppercase test emails.

## 8. Remaining issues and limitations

- **Semaphore adapter not exercised live.** It is unit-tested against Semaphore's documented
  format; sending a real SMS needs your API key (`SMS_PROVIDER=semaphore`).
- **Custom domains** are prepared only: `stores.custom_domain` exists and is returned, but it
  cannot be set or routed yet (a later phase with DNS verification).
- **Storefront store pages** are not built yet: the public API (`/stores/by-slug/{slug}`, logos,
  banners) is ready for the catalog phase.
- **One seller per person.** A person can work for one seller at a time (enforced by a unique
  constraint). Several would need a seller switcher.
- **Two-step verification is optional** for everyone. Making it mandatory for staff is a small
  policy change (ADR 0014) that I recommend before production.
- **Seller documents** are checked by type and size but not scanned for malware; add a scanning
  step before production.
- Mobile apps would need a header-based session variant (not in scope).

## 9. Acceptance

| Requirement (brief §)                                                                                                                                                             | Status                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| §1 Customer and seller registration, admin login, email verification, login, logout, password recovery and reset, refresh rotation, session management, activation and suspension | Done                                                                    |
| §1 Optional MFA infrastructure                                                                                                                                                    | Done (authenticator app, recovery codes, admin reset)                   |
| §2 14 roles, configurable roles and permissions, guards and decorators                                                                                                            | Done (scoped permissions, locked owner roles)                           |
| §3 Seller business information, documents, verification status, review, approval, rejection with reason, request information                                                      | Done                                                                    |
| §3 Statuses PENDING, UNDER_REVIEW, VERIFIED, REJECTED, SUSPENDED, CLOSED                                                                                                          | Done                                                                    |
| §3 Sensitive documents protected, no public access                                                                                                                                | Done (API-streamed only; staff views audited)                           |
| §4 Stores: name, unique slug, logo, banner, description, contact, address, social links, status, settings                                                                         | Done                                                                    |
| §4 Prepared for custom domains and branding                                                                                                                                       | Branding done; custom domain field reserved                             |
| §5 Staff invitation, expiration, activation, roles and permissions, suspension, removal; own seller only                                                                          | Done                                                                    |
| §6 Admin pages (users, roles, permissions, seller applications, verification, details, stores, suspension)                                                                        | Done                                                                    |
| §6 Seller pages (dashboard, business profile, verification, store settings, employees, account)                                                                                   | Done                                                                    |
| §7 Prisma models, migrations, indexes, constraints, audit logs for sensitive admin actions                                                                                        | Done                                                                    |
| §8 Documented endpoints under the requested paths                                                                                                                                 | Done (API reference and Swagger)                                        |
| §9 Tests                                                                                                                                                                          | Done, see section 7                                                     |
| Secrets, passwords, codes, bank or card data never in responses or logs                                                                                                           | Done (no card or bank data is stored in this phase)                     |
| Windows PowerShell setup                                                                                                                                                          | Done (`setup.ps1` adds `AUTH_MFA_ENCRYPTION_KEY` to an existing `.env`) |

## 10. Dependencies for the next phase

The next phase can build on:

- `sellerScope(user)` for every seller-side query (products, inventory, orders);
- verified sellers with stores and the public store lookup by slug;
- seller-scope permissions, which new modules add to the catalog with defaults;
- the seller status emails and the audit log for new approval workflows.

I will wait for your review and the Phase 3 details before starting anything else.
