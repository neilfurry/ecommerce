# Phase 8 report: Final quality assurance, security and production deployment

- Branch: `phase-8-production` (PR #8, based on `phase-7-engagement`)
- Date: 2026-11-28
- Verified on: GitHub Actions run `46043489394`, commit `e012465` (all five jobs green)
- Status: **Complete, awaiting review and approval.**

The full deliverable for §11 is [FINAL_TECHNICAL_REPORT.md](../production/FINAL_TECHNICAL_REPORT.md).
This report lists what Phase 8 changed and how it was verified.

**Production readiness.** The software meets every acceptance criterion that can be checked
without the business's accounts and a server (§7 below). The marketplace is **not yet
declared production-ready**. Live PayMongo, SMS and SMTP accounts, the production server,
legal and tax approvals, and merchant onboarding are still outstanding (final report §15,
[GO_LIVE_CHECKLIST.md](../production/GO_LIVE_CHECKLIST.md) §2–6).

## 1. What was done, by brief section

| §   | Brief               | Done                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | System audit        | [AUDIT_REPORT.md](../production/AUDIT_REPORT.md): prioritized list. Fixed: 2 critical, 8 high and 7 medium findings from the code audit, plus 5 issues found by the load test and production-stack runs (V1 critical, V2–V3 high). 9 low items are documented. No critical or high item is open.                                                    |
| 2   | Automated testing   | All suites run in CI. New tests: three role journeys (Playwright `journeys.spec.ts`), an integrity suite, a route-access inventory, worker crash recovery and backlog draining, production configuration guards, and search by brand words.                                                                                                         |
| 3   | Load testing        | k6 against the production images with synthetic data (5,000 products), seven scenarios, resource sampling, integrity checks and a database analysis on every pull request. Two bottlenecks were found and fixed. [LOAD_TEST_REPORT.md](../production/LOAD_TEST_REPORT.md)                                                                           |
| 4   | Security audit      | [SECURITY_GUIDE.md](../production/SECURITY_GUIDE.md) maps the controls to OWASP ASVS and Top 10. Staff two-step verification is now required in production; dependency vulnerabilities, production secret and test-key guards, log and error-report redaction, and webhook rejection alerts were fixed.                                             |
| 5   | Data integrity      | All ten cases have tests (final report §10). The concurrent-refund bug (C2) was found and fixed.                                                                                                                                                                                                                                                    |
| 6   | Backup and recovery | pgBackRest: WAL archiving, weekly full and daily differential backups, AES-256 encryption, retention, metrics and alerts. Uploads go to a versioned bucket. A restore test runs in CI, and migration rollback is documented. [BACKUP_AND_RECOVERY.md](../production/BACKUP_AND_RECOVERY.md)                                                         |
| 7   | Production config   | Dockerfile (api, worker, edge, tools, postgres) and production Compose with Caddy (HTTPS, headers, load balancing, optional CDN). Environment template, Release workflow with environment approval, and `deploy.sh` (backup, migrate, health check, automatic rollback). Development credentials and test payment settings are refused at start-up. |
| 8   | Monitoring          | Prometheus metrics for the API, worker, queues, payments, webhooks, the notification backlog and stock holds, plus exporters (node, cAdvisor, PostgreSQL, Redis, blackbox). 30 alert rules, Alertmanager, a Grafana dashboard, Loki logs and Sentry-compatible error tracking (server and browser), with backup alerts.                             |
| 9   | Documentation       | `docs/production/` (deployment, environment variables, backup and recovery, security, go-live checklist, audit, load test, final report) and `docs/user/` (admin, seller, customer guides).                                                                                                                                                         |
| 10  | Readiness checklist | §7 below; [GO_LIVE_CHECKLIST.md](../production/GO_LIVE_CHECKLIST.md)                                                                                                                                                                                                                                                                                |
| 11  | Final report        | [FINAL_TECHNICAL_REPORT.md](../production/FINAL_TECHNICAL_REPORT.md)                                                                                                                                                                                                                                                                                |

## 2. Main changes to working modules

Changes were made only where the audit or tests found a problem. No module was rewritten.

- **Refunds** take the order lock before reading balances (C2).
- **Product search** matching was rewritten to use its indexes, with the same rules (V2).
- **Checkout** wakes the notification dispatcher after commit, and the dispatcher drains its
  backlog (V3).
- **Configuration** has new production guards and settings: `SHIPPING_PROVIDER=rate_table`,
  `STAFF_MFA_REQUIRED`, `ALLOW_TEST_PAYMENTS`, `AUTH_SIGN_IN_LIMIT_PER_MINUTE`, and the
  `connection_limit` pool size.
- **Observability:** metrics endpoints on a separate internal port, and error reporting.
- **Admin Console staff** without two-step verification can only enrol until it is on, in
  production (ADR 0039).

New ADRs: 0036 (production deployment), 0037 (observability), 0038 (backups with pgBackRest)
and 0039 (staff two-step verification).

## 3. Created and modified files

120 files changed against `phase-7-engagement` (excluding the lockfile). The main ones:

- **Production:**
  - `docker/production/` (Dockerfile, compose files, Caddyfile, deploy script, PostgreSQL and
    pgBackRest image, backup and restore scripts, environment template);
  - `docker/production/monitoring/` (Prometheus, alert rules, Alertmanager, Grafana, Loki,
    Alloy, blackbox);
  - `docker/production/ci/` (smoke, backup/restore, environment and certificates);
  - `.github/workflows/release.yml`, and production-stack and load-test jobs in `ci.yml`.
- **Load testing:** `load/` (k6 script, runner, integrity and analysis SQL) and
  `prisma/load-test-data.ts`.
- **Observability:**
  - `apps/api/src/infrastructure/observability/`;
  - `apps/worker/src/observability/`;
  - `packages/ui/src/lib/error-reporting.ts` (browser).
- **Fixes:**
  - refunds, product search, checkout notification kick, notification dispatcher;
  - API and worker configuration (production guards, sign-in limit);
  - staff two-step verification guard;
  - shipping rate table;
  - Prisma pool size.
- **Tests:**
  - `apps/api/test/integrity.e2e-spec.ts`, `route-access.e2e-spec.ts`,
    `staff-mfa-required.e2e-spec.ts`;
  - `e2e/journeys.spec.ts` and `e2e/support/api.ts`;
  - worker integration additions;
  - configuration tests;
  - a storefront search test.
- **Documentation:**
  - `docs/production/` (8 documents);
  - `docs/user/` (3 guides);
  - ADRs 0036–0039;
  - the testing guide, roadmap and this report.

## 4. Database changes

None. No migration was added in Phase 8. The search rewrite uses the indexes created in
Phase 4. The 10 existing migrations are applied from zero by the production `tools` image in
both production-stack CI jobs.

## 5. Starting the project

**Development (Windows PowerShell)** is unchanged:

```powershell
git pull
pnpm install
.\scripts\setup.ps1
.\scripts\dev.ps1
```

**Production:** follow [DEPLOYMENT_GUIDE.md](../production/DEPLOYMENT_GUIDE.md). Server
commands are marked as Linux (bash); workstation commands are marked as PowerShell.

## 6. Test results

All of these were executed in CI run `46043489394`, commit `e012465`.

| Suite                                    | Result                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, format, builds          | Pass                                                                                                                                                                                                                                                                                                                         |
| Unit tests (all packages and apps)       | 521 passed                                                                                                                                                                                                                                                                                                                   |
| API e2e                                  | 310 passed in 26 suites (new: `integrity.e2e-spec.ts`, `route-access.e2e-spec.ts`, `staff-mfa-required.e2e-spec.ts`)                                                                                                                                                                                                         |
| Worker integration                       | 15 passed (new: crash between commit and enqueue, killed job re-run once, backlog drained in one run, metrics)                                                                                                                                                                                                               |
| Playwright (desktop + mobile)            | 40 passed, 1 skipped (a mobile-only check on desktop), no flaky tests; includes the customer, seller and administrator journeys                                                                                                                                                                                              |
| Migration drift (`prisma migrate diff`)  | No difference detected                                                                                                                                                                                                                                                                                                       |
| PowerShell scripts                       | Pass                                                                                                                                                                                                                                                                                                                         |
| Production stack (`NODE_ENV=production`) | Smoke test passed: TLS and security headers on the three apps, HTTP→HTTPS, health, Swagger/dev tools/metrics hidden, forged webhook refused, secure cookies, CSRF, 13 Prometheus targets up, 30 alert rules, Alertmanager/Grafana/Loki ready, logs in Loki                                                                   |
| Backup and restore                       | Encrypted full backup → row written after it → volume destroyed → restored with WAL replay → all 115 tables and the money/stock checksum identical (on the CI database: reference data and 43,760 PSGC locations, 51 MB; application tables mostly empty), post-backup row present, application healthy, repository verified |
| Load test                                | All thresholds met, all integrity checks passed ([LOAD_TEST_REPORT.md](../production/LOAD_TEST_REPORT.md))                                                                                                                                                                                                                   |
| Dependency audit (`pnpm audit --prod`)   | No known vulnerabilities (run locally on 2026-11-28; not part of CI)                                                                                                                                                                                                                                                         |

During verification, CI failures were fixed rather than retried:

- the pgBackRest role and archive command (V1);
- Loki readiness in the smoke test;
- the load-test rate-limit value and load-test data (V5);
- the restore test's checksum column and volume removal;
- sign-in rate limiting in the parallel browser tests (V4);
- one cold-start render timeout in an Admin Console unit test (all frontend tests now wait up
  to 5 s for a first render).

## 7. Production readiness checklist (§10)

| Item                                        | Status              | Evidence                                                                                                                                            |
| ------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| All modules function                        | Verified            | All suites, including the three role journeys (§6)                                                                                                  |
| No critical test failures                   | Verified            | Run `46043489394`. A test that passes only on retry fails the run.                                                                                  |
| No known critical security vulnerabilities  | Verified (software) | AUDIT_REPORT.md: nothing critical or high open; `pnpm audit --prod` clean. External penetration test still recommended.                             |
| Database migrations reproducible            | Verified            | Drift check; migrations applied from zero by the production image in two CI jobs                                                                    |
| Payment webhooks secure                     | Verified            | Forged PayMongo webhook refused (401) on the production stack; mock webhook disabled; duplicates and concurrency applied once                       |
| Seller data isolation verified              | Verified            | Route inventory and cross-seller matrix tests                                                                                                       |
| Financial ledger balances                   | Verified            | Reconciliation after the integrity suite and after the load test                                                                                    |
| Backups are restorable                      | Verified in CI      | Backup → destroy → restore → identical. **A timed drill on the real server is still needed.**                                                       |
| Monitoring is operational                   | Verified in CI      | Every Prometheus target up, rules loaded, Grafana, Alertmanager and Loki ready, logs arriving. **Alert delivery to real addresses not yet tested.** |
| Documentation is complete                   | Done                | `docs/production/*`, `docs/user/*`                                                                                                                  |
| Production environment variables configured | **Template only**   | `.env.production.example` and guards. The real values need the business's accounts and server.                                                      |

## 8. Assumptions

- **Deployment target:** a single Linux VM with Docker Compose, scaled out by moving
  PostgreSQL and Redis to managed services (ADR 0036). Kubernetes manifests were not produced:
  the brief allowed either, and Compose matches the size of the launch.
- **Production shipping** is the rate table with self-arranged couriers until courier APIs
  are contracted.
- **Load-test figures** come from a CI runner and are not a capacity claim for any server.

## 9. Remaining issues and limitations

See final report §12 (known limitations) and §15 (external dependencies). The main ones:

- PayMongo live mode, Semaphore and SMTP have never been used with real accounts.
- There are no courier APIs, and web push uses a mock provider.
- PostgreSQL and Redis run as single nodes.
- Legal and tax approvals are outstanding.

## 10. Acceptance

| Criterion                                                      | Status                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Declare production-ready only if acceptance criteria verified  | Not declared. Software criteria verified; business and infrastructure items listed with their owners.                  |
| External credentials, legal approval, onboarding identified    | Final report §15, GO_LIVE_CHECKLIST.md §4–5                                                                            |
| Do not claim traffic levels without tests                      | LOAD_TEST_REPORT.md states the measured levels and hardware only                                                       |
| Do not deploy development credentials or test payment settings | Refused at start-up (tests in `app-config.spec.ts` and `worker-config.spec.ts`; smoke test runs `NODE_ENV=production`) |
