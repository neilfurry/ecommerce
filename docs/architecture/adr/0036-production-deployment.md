# ADR 0036: Production deployment on Docker Compose behind Caddy

- Status: Accepted
- Date: 2026-11-27

## Context

Phase 8 prepares the marketplace for launch. The user chose Docker Compose on one or a few
Linux VMs (over Kubernetes or a managed AWS stack), self-hosted open-source monitoring,
pgBackRest backups to S3 and placeholder domains.

## Decision

- One multi-stage `docker/production/Dockerfile` builds four images from the monorepo: `api`
  and `worker` (Node 24 on Debian slim, production dependencies only via `pnpm deploy`, run as
  the unprivileged `node` user under `tini`), `edge` (Caddy with the three built frontends) and
  `tools` (the full workspace for migrations, reference data and the first super admin). A
  fifth image adds pgBackRest to PostgreSQL 17. Tags are release versions or commit SHAs,
  never `latest`.
- Caddy is the edge: automatic Let's Encrypt certificates, HTTP→HTTPS, HSTS, CSP and other
  security headers, compression, JSON access logs with tokens stripped, and `/api/*` load
  balanced (`least_conn`, active health checks, retries while replicas restart) across every
  API replica found through Docker DNS. Each frontend calls `/api` on its own domain, so the
  browser never makes cross-origin requests and `CORS_ORIGINS` stays empty.
- Networks: `public` (edge, outbound), `app`, `data` (never published) and `monitoring`
  (internal only). Only ports 80/443 are published.
- Configuration is one `.env.production` on the server (from `.env.production.example`). The
  API and worker refuse to start in production with development secrets, PayMongo test keys
  (unless `ALLOW_TEST_PAYMENTS` for staging), mock payments/shipping/SMS, http public URLs,
  insecure cookies, Mailpit-style SMTP or optional staff two-step verification.
- `SHIPPING_PROVIDER=rate_table` is the production shipping provider: the admin-managed rate
  table, with sellers booking their own courier (the API could not start in production before:
  only `mock` existed and production refused it).
- Releases: `.github/workflows/release.yml` builds and pushes the images (with SBOM and
  provenance) for a `v*` tag; deployment waits for approval of the `production` environment
  and runs `deploy.sh` on the server: backup → migrations → roll out → health check →
  automatic application rollback if unhealthy.

## Consequences

- One VM runs everything for launch; the same Compose file scales API replicas and workers.
  PostgreSQL and Redis are single nodes (no automatic failover); the recovery path is the
  backup (ADR 0038). Moving PostgreSQL to a managed service changes only `DATABASE_URL`.
- CI starts this exact stack with `NODE_ENV=production` on every pull request (smoke test,
  backup and restore) and a load-test variant (ADR 0037, LOAD_TEST_REPORT.md).
