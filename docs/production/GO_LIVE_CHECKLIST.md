# Go-live checklist

Work through it top to bottom; every line needs a name and a date in the team's copy. Items
marked **[CI]** are verified automatically on every pull request (the evidence is the CI run
named in [the final report](FINAL_TECHNICAL_REPORT.md)); **[Server]** need doing on the real
server; **[Business]** need people, contracts or approvals outside the software.

## 1. Software (verified before release)

- [ ] **[CI]** All modules work: unit tests, API end-to-end tests, worker integration tests and
      browser tests (including the customer, seller and administrator journeys) pass.
- [ ] **[CI]** No critical test failures; no flaky browser test (a test passing only on retry
      fails the run).
- [ ] **[CI]** No known critical or high vulnerability: `pnpm audit --prod` clean; audit findings
      fixed ([AUDIT_REPORT.md](AUDIT_REPORT.md)).
- [ ] **[CI]** Migrations reproducible: `prisma migrate diff` finds no drift; a fresh database is
      migrated from zero by the production `tools` image.
- [ ] **[CI]** Payment webhooks secure: forged PayMongo webhook refused (401), mock webhook
      disabled in production (404), duplicate/concurrent events applied once.
- [ ] **[CI]** Seller data isolation: route inventory and cross-seller matrix tests.
- [ ] **[CI]** Ledger balances: finance reconciliation all green after the integrity tests and
      after the load test.
- [ ] **[CI]** Backups restorable: encrypted backup → database destroyed → restored → identical.
- [ ] **[CI]** Monitoring operational: every Prometheus target up, 30 alert rules loaded,
      Grafana, Alertmanager and Loki ready, logs arriving.
- [ ] **[CI]** Load test thresholds met (p95 < 2 s, < 1% errors per scenario) with integrity
      checks green ([LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md)).
- [ ] Release tagged (`vX.Y.Z`) and images built by the Release workflow.

## 2. Infrastructure

- [ ] **[Server]** VM sized (≥ 4 vCPU / 8 GB), Docker 27+, firewall 22 (restricted)/80/443,
      automatic security updates, NTP, SSH keys only.
- [ ] **[Server]** DNS A/AAAA (and CAA) records for the five host names; certificates issued
      (Caddy logs "certificate obtained").
- [ ] **[Server]** `.env.production` complete (`grep CHANGE_ME` prints nothing), mode 600, copied
      to the vault; API and worker start (they refuse invalid production settings).
- [ ] **[Server]** Uploads bucket private, versioned; backup bucket in another account/region with
      object lock or versioning; least-privilege keys.
- [ ] **[Server]** `monitoring/prometheus/probes.yml` lists the real URLs; Blackbox probes green.
- [ ] **[Server]** Alert e-mails reach the team and on-call (send a test: stop the worker for 3
      minutes on staging, or `amtool` a test alert).
- [ ] **[Server]** First full backup present (`marketplace-backup info`); **restore drill on the
      real server done and timed** ([BACKUP_AND_RECOVERY.md §6](BACKUP_AND_RECOVERY.md#6-restore-testing)).
- [ ] **[Server]** Grafana: shared admin replaced by named accounts.
- [ ] **[Server]** GitHub `production` environment with required reviewers; deploy key works
      (`./deploy.sh` run once by the workflow).

## 3. Accounts and data

- [ ] **[Server]** Reference data seeded (`pnpm db:seed`), PSGC locations imported, **no demo
      accounts** (`SEED_DEMO_USERS` is ignored in production).
- [ ] **[Server]** First super admin created; two-step verification on; staff invited with
      least-privilege roles, all with two-step verification.
- [ ] Platform settings reviewed: commission, VAT/withholding rules, settlement schedule, minimum
      payout, return window, shipping rate table, bank transfer accounts, notification templates.
- [ ] Categories, brands and storefront banners ready; launch sellers verified and their
      products approved and stocked.

## 4. External services (need the business's credentials)

- [ ] **[Business]** PayMongo account **activated for live payments**; live keys and webhook secret
      in `.env.production`; webhook endpoint registered; **one real low-value payment and refund
      per method** (card, GCash, Maya, QR Ph) completed end to end and reconciled.
- [ ] **[Business]** Optional PayMongo payouts (wallet) configured, or manual payout process agreed
      with finance.
- [ ] **[Business]** Semaphore account and sender name approved; a real OTP received.
- [ ] **[Business]** SMTP provider live; SPF/DKIM/DMARC pass; a real e-mail received in Gmail and
      Outlook without landing in spam.
- [ ] **[Business]** Couriers: sellers know to arrange their own courier and enter tracking
      numbers (no courier API is integrated yet — AUDIT_REPORT.md L1).
- [ ] **[Business]** Error tracking DSNs (Sentry/GlitchTip) set, or consciously skipped.

## 5. Legal and compliance (outside the software)

- [ ] **[Business]** Terms of service, privacy notice, seller agreement, returns and refund policy
      published and linked.
- [ ] **[Business]** Data Privacy Act: Data Protection Officer appointed, registration with the
      National Privacy Commission as required, breach-notification procedure (72 hours).
- [ ] **[Business]** BIR: registration of the marketplace's own receipts/invoices (and any e-invoicing
      requirement) confirmed by the accountant; withholding rules confirmed.
- [ ] **[Business]** DTI e-commerce/consumer-protection requirements (Internet Transactions Act)
      reviewed by counsel, including seller verification and complaint handling.
- [ ] **[Business]** External penetration test scheduled (before or soon after launch).
- [ ] Security contact published (`security@…`, `/.well-known/security.txt`).

## 6. Launch day

- [ ] Deploy the release; health `ok`; smoke-test by hand: sign up, buy with each payment method,
      seller ships, admin sees the order, refund one.
- [ ] Watch Grafana (errors, latency, payments, queues) for the first hours; on-call reachable.
- [ ] Rollback rehearsed (`./deploy.sh --rollback` on staging) and the previous tag noted.

The marketplace is ready for production when **every** box above is ticked. As of the Phase 8
report, sections 1 (CI) are verified; sections 2–6 require the production server, the
business's accounts and legal approvals.
