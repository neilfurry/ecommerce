# Deployment guide

How to run the marketplace in production: the server, the external services, the first
deployment, releases, rollbacks and scaling. Design: [ADR 0036](../architecture/adr/0036-production-deployment.md).

Command blocks are marked **Windows PowerShell** (your workstation) or **Linux server (bash)**.
On the server, `DC` stands for `docker compose --env-file .env.production`, run from the
deployment directory (`/opt/marketplace` below).

## 1. Architecture

```
                 Internet (HTTPS 443, HTTP 80 → redirect)
                                  │
                 ┌────────────────▼─────────────────┐   optional CDN in front
                 │  edge — Caddy                    │   (CDN_TRUSTED_PROXIES)
                 │  TLS (Let's Encrypt), headers,   │
                 │  storefront / seller / admin SPA │
                 │  /api/* → least-conn LB          │
                 └───────┬───────────────┬──────────┘
                         │               │
              ┌──────────▼───┐   ┌───────▼──────┐        ┌───────────────┐
              │ api replica 1│   │ api replica 2│  ...   │ worker (1..n) │
              └──────┬───────┘   └──────┬───────┘        └──────┬────────┘
                     └────────┬─────────┴────────────────────────┘
          ┌──────────────┬────┴─────────┬─────────────────┬──────────────────┐
   ┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼──────┐  ┌───────▼───────┐  ┌───────▼──────┐
   │ PostgreSQL │ │   Redis    │ │ S3 uploads  │  │ PayMongo, SMTP│  │ backup bucket│
   │ + pgBackRest├─┼─ WAL/backups ─────────────────────────────────▶│ (other region)│
   └────────────┘ └────────────┘ └─────────────┘  │ Semaphore SMS │  └──────────────┘
                                                   └───────────────┘
   Monitoring: Prometheus, Alertmanager, Grafana (grafana.<domain>), Loki + Alloy, exporters
```

| Service                                                             | Image                      | Published            | Purpose                                                        |
| ------------------------------------------------------------------- | -------------------------- | -------------------- | -------------------------------------------------------------- |
| `edge`                                                              | `…/edge:<tag>`             | 80, 443              | Caddy: HTTPS, the three frontends, `/api` load balancing       |
| `api` ×2                                                            | `…/api:<tag>`              | –                    | REST API (NestJS)                                              |
| `worker`                                                            | `…/worker:<tag>`           | –                    | Background jobs (BullMQ)                                       |
| `migrate`                                                           | `…/tools:<tag>`            | –                    | One-off: migrations, reference data, bootstrap (profile `ops`) |
| `postgres`                                                          | `…/postgres:<tag>`         | –                    | PostgreSQL 17 + pgBackRest (WAL archiving)                     |
| `backup`                                                            | `…/postgres:<tag>`         | –                    | Scheduled backups                                              |
| `redis`                                                             | `redis:7.4-alpine`         | –                    | Queues, rate limits, caches                                    |
| `minio`                                                             | `cgr.dev/chainguard/minio` | –                    | Optional self-hosted S3 (profile `storage`)                    |
| `objects-backup`                                                    | `rclone/rclone`            | –                    | Optional uploads backup (profile `storage-backup`)             |
| `prometheus`, `alertmanager`, `grafana`, `loki`, `alloy`, exporters | upstream                   | – (Grafana via edge) | Monitoring                                                     |

## 2. Before the first deployment

### 2.1 Server

- One Linux VM to start: **4 vCPU, 8–16 GB RAM, 100 GB SSD** (Ubuntu 24.04 LTS or Debian 12),
  in or near the Philippines (e.g. AWS `ap-southeast-1` Singapore). Load-test figures for this
  size are in [LOAD_TEST_REPORT.md](LOAD_TEST_REPORT.md).
- Docker Engine 27+ with the Compose plugin; a non-root deploy user in the `docker` group;
  SSH keys only (no passwords); automatic security updates (`unattended-upgrades`).
- Firewall: inbound **22** (from the office/VPN only), **80**, **443** (TCP and UDP for
  HTTP/3); nothing else.
- Time in UTC and NTP on (TLS, JWTs and webhook signatures depend on the clock).

### 2.2 Domains and DNS

Register the domain and create A (and AAAA) records pointing at the server:

| Host (example)       | Variable                        |
| -------------------- | ------------------------------- |
| `shop.example.ph`    | `STOREFRONT_DOMAIN`             |
| `seller.example.ph`  | `SELLER_DOMAIN`                 |
| `admin.example.ph`   | `ADMIN_DOMAIN`                  |
| `api.example.ph`     | `API_DOMAIN` (webhooks, health) |
| `grafana.example.ph` | `GRAFANA_DOMAIN`                |

Caddy obtains and renews certificates by itself once DNS resolves and ports 80/443 are open.
Add a CAA record allowing `letsencrypt.org`. With a CDN (Cloudflare, CloudFront): set it to
"Full (strict)" TLS, put its IP ranges in `CDN_TRUSTED_PROXIES` and set `TRUST_PROXY=2`.

### 2.3 External accounts (need the business's own credentials)

| Service        | What to prepare                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object storage | A private **uploads** bucket (versioning on, public access blocked) and a key limited to it; a **backup** bucket in another account or region (object lock or versioning) and a key limited to it; optionally a second backup bucket for uploads.                                                                                                                         |
| PayMongo       | An **activated live** account (business verification), live secret key, and a webhook for `https://<API_DOMAIN>/api/v1/payments/webhooks/paymongo` with events `checkout_session.payment.paid`, `payment.paid`, `payment.failed`, `payment.refunded`, `payment.refund.updated` (its secret is `PAYMONGO_WEBHOOK_SECRET`). Optional: wallet details for automatic payouts. |
| Email          | A transactional SMTP provider; SPF, DKIM and DMARC for the sender domain.                                                                                                                                                                                                                                                                                                 |
| SMS            | A Semaphore account with an approved sender name.                                                                                                                                                                                                                                                                                                                         |
| Error tracking | Optional: a Sentry project or a self-hosted GlitchTip (DSNs for the server and the browser).                                                                                                                                                                                                                                                                              |
| Alerts         | A mail relay for Alertmanager; on-call and team addresses; optional Slack/paging webhook.                                                                                                                                                                                                                                                                                 |

### 2.4 GitHub

1. Repository **variables**: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` (`/opt/marketplace`),
   `STOREFRONT_DOMAIN`, optional `VITE_SENTRY_DSN`.
2. Repository **secret** `DEPLOY_SSH_KEY`: a private key whose public half is in the deploy
   user's `~/.ssh/authorized_keys` on the server.
3. **Environment** `production` with required reviewers: every deployment waits for approval.
4. The server must be able to pull from `ghcr.io/<owner>/ecommerce`: make the packages
   private and run once on the server `docker login ghcr.io` with a read-only token
   (`read:packages`).

## 3. First deployment

**Linux server (bash):**

```bash
sudo mkdir -p /opt/marketplace && sudo chown "$USER" /opt/marketplace
cd /opt/marketplace
# Copy docker/production from the repository here (the release workflow does this with rsync).
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production            # replace every CHANGE_ME (ENVIRONMENT_VARIABLES.md)
nano monitoring/prometheus/probes.yml   # your four public URLs
grep -n CHANGE_ME .env.production       # must print nothing
```

Then, with `IMAGE_TAG` set to the release to install:

```bash
DC pull
DC up -d postgres redis
DC run --rm migrate                                   # all migrations
DC run --rm migrate pnpm db:seed                      # reference data: roles, permissions,
                                                      # currencies, categories, PSGC locations,
                                                      # default commission (no demo data in production)
# First super admin. The password is read without echo and passed by name, so it never
# appears in the shell history or the process list.
read -rs -p 'Password for the first super admin: ' BOOTSTRAP_ADMIN_PASSWORD; echo
export BOOTSTRAP_ADMIN_PASSWORD
DC run --rm -e BOOTSTRAP_ADMIN_EMAIL=owner@example.ph \
  -e BOOTSTRAP_ADMIN_FIRST_NAME=Maria -e BOOTSTRAP_ADMIN_LAST_NAME=Santos \
  -e BOOTSTRAP_ADMIN_PASSWORD migrate pnpm db:bootstrap-admin
unset BOOTSTRAP_ADMIN_PASSWORD
DC up -d                                              # everything else
DC ps                                                 # all "healthy"
curl -fsS https://api.example.ph/api/v1/health        # {"status":"ok", ...}
```

First sign-in to the Admin Console with that e-mail and password: **turn on two-step
verification** (required), then follow the [Admin guide](../user/ADMIN_GUIDE.md) "First
day": platform settings (bank transfer accounts, return window, shipping rate table, tax
rules, commission), staff accounts, and the go-live checklist.

Check the backup service took its first full backup:

```bash
DC exec backup marketplace-backup info
```

## 4. Releases

1. Merge to `main`; CI must be green (unit, API e2e, worker integration, browser tests,
   production stack smoke test, backup/restore test, load test).
2. Tag the release: **Windows PowerShell** `git tag v1.0.0; git push origin v1.0.0`.
3. The **Release** workflow builds the five images (with SBOM and provenance) and pushes them
   to GHCR as `:v1.0.0`.
4. A reviewer approves the `production` environment; the workflow copies `docker/production`
   to the server (never `.env.production`) and runs `./deploy.sh v1.0.0`, which:
   - pulls the images (stops if a tag is missing);
   - takes an incremental **backup**;
   - runs **migrations** (stops, leaving the old release running, if one fails);
   - recreates the API (the edge holds requests until a healthy replica answers), worker and edge;
   - checks `/api/v1/health`; if not healthy within two minutes, **rolls the application back**
     to the previous tag automatically.

Manual deployment of a tag (**Linux server**): `./deploy.sh v1.0.1`.
Manual rollback to the previous release: `./deploy.sh --rollback`.

### Migration rules

Every migration must work with the previous application release (expand → migrate code →
contract in a later release); see [BACKUP_AND_RECOVERY.md §5](BACKUP_AND_RECOVERY.md#5-migration-rollback).

## 5. Operations

| Task                     | Linux server (bash)                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Status                   | `DC ps`                                                                                                  |
| Logs of one service      | `DC logs -f --tail 200 api` (or Grafana › Explore › Loki: `{service="api"}`)                             |
| Restart a service        | `DC restart worker`                                                                                      |
| Scale the API            | set `API_REPLICAS=4` in `.env.production`, `DC up -d api`                                                |
| More workers             | `WORKER_REPLICAS=2`, `DC up -d worker` (jobs are safe to run concurrently)                               |
| Database shell           | `DC exec postgres psql -U marketplace -d marketplace`                                                    |
| Migration status         | `DC run --rm migrate pnpm db:status`                                                                     |
| Re-import PSGC locations | `DC run --rm migrate pnpm db:import-locations`                                                           |
| Backups                  | see [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md)                                                     |
| Rotate a secret          | change it in `.env.production` and the vault, `DC up -d` (see ENVIRONMENT_VARIABLES.md for side effects) |
| Free disk                | `docker image prune -a --filter "until=720h"` (keeps recent releases for rollback)                       |

### Monitoring

- **Grafana** at `https://<GRAFANA_DOMAIN>` (admin password from `.env.production`; create
  named accounts and turn off the shared admin): dashboard _Marketplace overview_; logs in
  _Explore › Loki_.
- **Alerts** arrive by e-mail (warning → team, critical → on-call). Each alert names what to
  check; the runbook column in [SECURITY_GUIDE.md §7](SECURITY_GUIDE.md#7-incident-response)
  covers incidents.
- **Errors** appear in Sentry/GlitchTip when a DSN is configured.
- Prometheus and Alertmanager are not exposed. To open one temporarily, forward it to the
  server's loopback interface and tunnel over SSH:

  ```bash
  # Linux server (bash): Prometheus on 127.0.0.1:9090 until Ctrl+C
  docker run --rm --network marketplace_monitoring -p 127.0.0.1:9090:9090 alpine/socat \
    tcp-listen:9090,fork,reuseaddr tcp-connect:prometheus:9090
  ```

  ```powershell
  # Windows PowerShell (workstation), then browse http://localhost:9090
  ssh -N -L 9090:127.0.0.1:9090 deploy@your-server
  ```

## 6. Scaling beyond one server

1. Move PostgreSQL to a managed service (Amazon RDS / Cloud SQL / DigitalOcean) with
   automated backups and a standby; set `DATABASE_URL` (with `sslmode=require`) and stop the
   `postgres` and `backup` services. Keep `pg_stat_statements` on.
2. Move Redis to a managed service (with persistence) and set `REDIS_URL`.
3. Run the same Compose file on two or more application servers (API + worker + edge), behind
   a cloud load balancer or DNS with health checks. Workers can run anywhere; BullMQ
   distributes jobs.
4. Put a CDN in front for static assets and DDoS protection (`CDN_TRUSTED_PROXIES`).

## 7. Staging

A staging server uses the same files with its own `.env.production`: staging domains, a
separate database and buckets, PayMongo **test** keys with `ALLOW_TEST_PAYMENTS=true`, and
Semaphore/SMTP sandboxes. Never point staging at production data or keys.

## 8. Local and CI stacks

- Local development: `docs/development/WINDOWS_SETUP.md` (`.\scripts\start.ps1`).
- CI starts this production stack on every pull request with self-signed TLS
  (`TLS_MODE=internal`), MinIO for uploads and backups, and Mailpit: see
  `docker/production/compose.ci.yml`, `ci/make-env.sh`, `ci/smoke.sh`, `ci/backup-restore.sh`.
