# ADR 0037: Metrics, logs, error tracking and alerts

- Status: Accepted
- Date: 2026-11-27

## Context

The brief asks for error tracking, API, database, queue and resource monitoring and alerts for
payment failures, worker failures and backups. The user chose self-hosted open-source tools.

## Decision

- **Metrics (Prometheus)**: the API and worker serve `/metrics` on an internal port
  (`METRICS_PORT`, never routed by the edge). API: request duration histogram by route
  template (bounded labels), unhandled errors, webhook signature rejections. Worker: job
  duration and failures by queue and job (final = dead-lettered), queue depth by state, and
  business backlog read from the database at scrape time (failed and paid payments in 15
  minutes, failed or stuck provider events, delayed notifications, overdue stock holds, failed
  payouts and refunds), so the numbers are global, not per process. Exporters cover
  PostgreSQL (with `pg_stat_statements`), Redis, the host, containers and Caddy; Blackbox
  probes the public URLs and certificate expiry.
- **Alerts**: `monitoring/prometheus/alerts.yml` (availability, API errors and latency,
  payments, worker and queues, database, Redis, backups, host). Alertmanager e-mails the team
  (warning) and on-call (critical, plus an optional webhook).
- **Logs**: JSON logs (pino; secrets redacted at the source) from every container are shipped
  by Grafana Alloy to Loki (30 days). The edge drops query strings' tokens, cookies and
  authorization headers from access logs.
- **Error tracking**: the Sentry SDK in the API, worker and the three frontends, enabled only
  when a DSN is configured (Sentry or a self-hosted, Sentry-compatible GlitchTip). No request
  bodies, cookies, auth headers, user identities, query strings or performance tracing.
- **Dashboards**: Grafana with Prometheus and Loki provisioned and a "Marketplace overview"
  dashboard; Grafana is the only monitoring UI exposed (own sign-in, own domain).

## Consequences

- No paid account is needed; the cost is running seven small monitoring containers on the VM
  (or a separate monitoring VM). CI checks the configuration (`promtool`, `caddy validate`)
  and that every target is scraped and logs reach Loki.
