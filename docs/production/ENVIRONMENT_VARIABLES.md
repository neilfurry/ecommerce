# Production environment variables

All settings live in one file on the server, `docker/production/.env.production`, created from
[`docker/production/.env.production.example`](../../docker/production/.env.production.example).
Keep it at `chmod 600`, owned by the deploy user, and never commit it. Copy every secret into
the team's password vault as well: some of them (marked **vault**) cannot be recovered and
losing them loses data.

The API and worker validate their settings at start-up and refuse to run in production with:

- development secrets copied from `.env.example` (`dev-only…`, `change-me`, `marketplace_dev…`);
- PayMongo test keys (`sk_test_…`) unless `ALLOW_TEST_PAYMENTS=true` (staging only);
- mock payments, mock shipping or mock SMS;
- `http://` public URLs, `COOKIE_SECURE=false`, `STAFF_MFA_REQUIRED=false`;
- Mailpit/localhost SMTP or a `.local` sender address;
- developer tools enabled or automatic bucket creation.

Generate secrets on a trusted machine. Windows PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

Linux (bash): `openssl rand -base64 48`.

"Used by": **E** edge, **A** API, **W** worker, **P** PostgreSQL/backup, **M** monitoring,
**C** Compose itself.

## Release and scale

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `IMAGE_REGISTRY` | C | `ghcr.io/neilfurry/ecommerce` | Where the release workflow pushes images. |
| `IMAGE_TAG` | C | e.g. `v1.0.0` | Set by `deploy.sh`; never `latest`. |
| `NODE_ENV` | A W | `production` | Turns on every production check above. |
| `API_REPLICAS` / `WORKER_REPLICAS` | C | `2` / `1` | More replicas for more traffic (see LOAD_TEST_REPORT.md). |
| `API_CPUS`, `API_MEMORY`, `WORKER_CPUS`, `WORKER_MEMORY` | C | `1.0`, `768M` | Per-container limits. |

## Domains, TLS and public URLs

| Variable | Used by | Example | Notes |
|---|---|---|---|
| `STOREFRONT_DOMAIN`, `SELLER_DOMAIN`, `ADMIN_DOMAIN`, `API_DOMAIN`, `GRAFANA_DOMAIN` | E C | `shop.example.ph` … | DNS A/AAAA records point at the server (DEPLOYMENT_GUIDE.md §2). |
| `ACME_EMAIL` | E | `ops@example.ph` | Let's Encrypt contact. |
| `TLS_MODE` | E | same as `ACME_EMAIL` | `internal` only for local/CI stacks (self-signed). |
| `CDN_TRUSTED_PROXIES` | E | `private_ranges` | With a CDN in front: its published IP ranges, so client IPs (rate limits, audit log) are right. |
| `ASSET_ORIGINS` | E | `https://files.example.ph https://o0.ingest.sentry.io` | Added to the frontends' CSP `img-src`/`connect-src`. |
| `STOREFRONT_URL`, `SELLER_PORTAL_URL`, `ADMIN_PORTAL_URL` | A W | `https://shop.example.ph` | Links in emails; must be `https://`. |
| `API_PUBLIC_URL` | A | `https://api.example.ph` | Shown to admins as the webhook base URL. |

## HTTP, sessions and security

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `API_PORT` | A | `3000` | Inside the container. |
| `TRUST_PROXY` | A | `1` | One proxy (the edge) in front; `2` if a CDN sits in front of the edge **and** is in `CDN_TRUSTED_PROXIES`. Wrong values break per-client rate limits. |
| `CORS_ORIGINS` | A | empty | Frontends are same-origin. |
| `LOG_LEVEL` | A W | `info` | `debug` only temporarily. |
| `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_MAX_REQUESTS` | A | `60`, `300` | Per client IP. Raise if many shoppers share one address (mobile carrier NAT). Sign-in, OTP and invitation routes have their own stricter limits. |
| `SWAGGER_ENABLED` | A | `false` | API docs UI; keep off on the internet. |
| `COOKIE_SECURE` | A | `true` | Required in production. |
| `COOKIE_DOMAIN` | A | empty | Host-only cookies (each app's own domain). |
| `STAFF_MFA_REQUIRED` | A | `true` | Required in production (ADR 0039). |
| `AUTH_JWT_SECRET`, `AUTH_OTP_SECRET` | A W | 48 random bytes each, different | Rotating `AUTH_JWT_SECRET` invalidates every access token: everyone signs in again. |
| `AUTH_MFA_ENCRYPTION_KEY` | A | random, **vault** | Changing it disables every authenticator app. |
| `FINANCE_ENCRYPTION_KEY` | A | random, **vault** | Encrypts seller bank account numbers; losing it makes them unreadable. |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS` | A | `900` | 15-minute access tokens. |
| `AUTH_CUSTOMER_SESSION_DAYS`, `AUTH_STAFF_SESSION_HOURS` | A | `30`, `12` | Refresh-token lifetimes. |
| `AUTH_MAX_FAILED_SIGN_INS`, `AUTH_LOCKOUT_MINUTES` | A | `5`, `15` | Account lockout. |

## PostgreSQL and Redis

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `POSTGRES_USER`, `POSTGRES_DB` | P M | `marketplace` | |
| `POSTGRES_PASSWORD` | P M | random | Also inside `DATABASE_URL`. |
| `DATABASE_URL` | A W tools | `postgresql://marketplace:…@postgres:5432/marketplace?schema=public&connection_limit=20` | `connection_limit` per process: replicas × limit + worker must stay below `max_connections` (200). A managed database: its URL with `sslmode=require`. |
| `REDIS_PASSWORD`, `REDIS_MAXMEMORY` | Redis | random, `512mb` | `noeviction`: alerts at 85%. |
| `REDIS_URL` | A W | `redis://:…@redis:6379` | |

## Object storage

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `S3_ENDPOINT`, `S3_REGION` | A W | provider's endpoint and region | AWS S3, Cloudflare R2, DigitalOcean Spaces, or the optional MinIO. |
| `S3_PUBLIC_ENDPOINT` | A | as seen by browsers | Signed download links (documents, proofs) use it. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A | a key limited to the uploads bucket | |
| `S3_BUCKET` | A | private bucket, versioning on | Created beforehand (`S3_AUTO_CREATE_BUCKET=false`). |
| `S3_FORCE_PATH_STYLE` | A | `false` (AWS), `true` (MinIO) | |
| `STORAGE_SIGNED_URL_TTL_SECONDS`, `UPLOAD_MAX_BYTES` | A | `300`, `5242880` | |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | MinIO | only with the `storage` profile | |

## Email, SMS and payments

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | W | transactional mail provider | SPF, DKIM and DMARC set up for the sender domain. |
| `MAIL_FROM` | W | `"Marketplace <no-reply@example.ph>"` | |
| `SMS_PROVIDER`, `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME` | W | `semaphore`, key, approved sender name | The sender name must be registered with Semaphore. |
| `PAYMENT_PROVIDER` | A | `paymongo` | |
| `PAYMONGO_SECRET_KEY` | A W | `sk_live_…` | **Live** key from the activated PayMongo account. |
| `PAYMONGO_WEBHOOK_SECRET` | A W | `whsk_…` | From the webhook created for `https://<API_DOMAIN>/api/v1/payments/webhooks/paymongo`. |
| `PAYMONGO_CHECKOUT_VERSION` | A | `v2` | |
| `PAYMONGO_WALLET_ACCOUNT_NUMBER`, `…_NAME`, `…_BIC` | A | optional | Automatic seller payouts through PayMongo; empty = manual payouts. |
| `ALLOW_TEST_PAYMENTS` | A W | `false` | `true` only on a staging server with test keys. |
| `SHIPPING_PROVIDER` | A | `rate_table` | Admin rate table; sellers arrange couriers and enter tracking numbers. |

## Worker, error tracking

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `WORKER_HEARTBEAT_INTERVAL_SECONDS` | W | `15` | The API reports the worker down after a missed heartbeat. |
| `DEV_TOOLS_ENABLED` | A W | `false` | Refused `true` in production. |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | A W | DSN or empty | Server error tracking. |
| `METRICS_PORT` | A W | `9464` (set by Compose) | Internal only. |
| `VITE_SENTRY_DSN` | build | repository variable | Browser error tracking, baked into the `edge` image at build time (public by nature). |

## Backups

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PORT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET` | P | a bucket in another account or region | Object lock or versioning on. Host name only in `BACKUP_S3_ENDPOINT` (no `https://`). |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | P | a key limited to that bucket | |
| `BACKUP_S3_URI_STYLE`, `BACKUP_S3_VERIFY_TLS` | P | `host`, `y` | `path` for MinIO. |
| `BACKUP_STANZA_PATH` | P | `marketplace` | Folder in the bucket. |
| `BACKUP_ENCRYPTION_PASSPHRASE` | P | 32+ random characters, **vault** | Without it no backup can be restored. |
| `BACKUP_RETENTION_FULL`, `BACKUP_RETENTION_DIFF` | P | `4`, `7` | 4 weekly fulls = 28 days of point-in-time recovery. |
| `BACKUP_HOUR_UTC`, `BACKUP_FULL_WEEKDAY` | P | `17` (01:00 PHT), `7` (Sunday) | |
| `OBJECT_BACKUP_*` | objects-backup | backup bucket for uploads | Profile `storage-backup`. |

## Monitoring

| Variable | Used by | Production value | Notes |
|---|---|---|---|
| `PROMETHEUS_RETENTION` | M | `30d` | |
| `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD` | Grafana | random password | Create named accounts after first sign-in. |
| `ALERT_SMTP_HOST`, `ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD`, `ALERT_EMAIL_FROM` | Alertmanager | mail relay (`host:port`) | |
| `ALERT_EMAIL_TEAM`, `ALERT_EMAIL_ONCALL` | Alertmanager | distribution lists | Warnings to the team, critical to on-call. |
| `ALERT_WEBHOOK_URL` | Alertmanager | optional | Slack-compatible or paging webhook for critical alerts. |

Also edit `monitoring/prometheus/probes.yml`: the four public URLs probed from inside.

## Local development

Development uses the repository-root `.env` (from `.env.example`, created by
`.\scripts\setup.ps1`); see `docs/development/WINDOWS_SETUP.md`. None of its values are valid in
production.
