#!/usr/bin/env bash
# Smoke test of a running production stack (CI). Fails on the first broken expectation.
set -euo pipefail
cd "$(dirname "$0")/.."
pass() { printf '  ok  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
curlk() { curl -sk --max-time 15 "$@"; }

echo "== Edge, TLS and frontends"
for host in shop seller admin; do
  h="$(curlk -D - -o /tmp/body "https://$host.marketplace.test/")"
  grep -q '^HTTP/[0-9.]* 200' <<<"$h" || fail "$host: $(head -1 <<<"$h")"
  grep -qi '^strict-transport-security: max-age=31536000' <<<"$h" || fail "$host: no HSTS"
  grep -qi "^content-security-policy: default-src 'self'" <<<"$h" || fail "$host: no CSP"
  grep -qi '^x-frame-options: DENY' <<<"$h" || fail "$host: no X-Frame-Options"
  grep -qi '<div id="root">' /tmp/body || fail "$host: not the app's index.html"
  # Client-side routes fall back to index.html.
  [ "$(curlk -o /dev/null -w '%{http_code}' "https://$host.marketplace.test/some/deep/link")" = 200 ] || fail "$host: SPA fallback"
  pass "$host.marketplace.test serves the app with security headers"
done
[ "$(curlk -o /dev/null -w '%{http_code}' http://shop.marketplace.test/)" = 308 ] || fail "http is not redirected to https"
pass "http redirects to https"

echo "== API through the edge"
for i in $(seq 1 20); do
  health="$(curlk https://api.marketplace.test/api/v1/health || true)"
  [ "$(jq -r '.status' <<<"$health" 2>/dev/null)" = ok ] && break
  sleep 3
done
for c in database redis storage worker; do
  [ "$(jq -r --arg c "$c" '.components[] | select(.name == $c) | .status' <<<"$health")" = up ] || fail "health component $c: $health"
done
pass "health: database, redis, storage and worker up"
[ "$(curlk -o /dev/null -w '%{http_code}' https://shop.marketplace.test/api/v1/catalog/products)" = 200 ] || fail "catalog"
pass "public catalog answers on the storefront domain"
for path in /api/docs /api/v1/dev/queues /metrics; do
  code="$(curlk -o /dev/null -w '%{http_code}' "https://api.marketplace.test$path")"
  [[ "$code" =~ ^(401|403|404)$ ]] || fail "$path is reachable ($code)"
done
pass "Swagger, developer tools and metrics are not exposed"
code="$(curlk -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' https://api.marketplace.test/api/v1/payments/webhooks/mock)"
[ "$code" = 404 ] || fail "mock payment webhook is enabled in production ($code)"
code="$(curlk -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'Paymongo-Signature: t=1,te=bad' -d '{"data":{}}' https://api.marketplace.test/api/v1/payments/webhooks/paymongo)"
[ "$code" = 401 ] || fail "unsigned PayMongo webhook not refused ($code)"
pass "mock webhooks disabled; forged PayMongo webhook refused (401)"
cookie="$(curlk -D - -o /dev/null -H 'X-Client-App: storefront' https://shop.marketplace.test/api/v1/auth/csrf | grep -i '^set-cookie: mp_csrf')"
grep -qi 'secure' <<<"$cookie" && grep -qi 'httponly' <<<"$cookie" && grep -qi 'samesite=lax' <<<"$cookie" || fail "csrf cookie flags: $cookie"
pass "cookies are Secure, HttpOnly, SameSite=Lax"
code="$(curlk -o /dev/null -w '%{http_code}' -X POST -H 'X-Client-App: storefront' -H 'Content-Type: application/json' -d '{"email":"x@example.ph","password":"x"}' https://shop.marketplace.test/api/v1/auth/sign-in)"
[ "$code" = 403 ] || fail "state-changing request without CSRF token not refused ($code)"
pass "requests without a CSRF token are refused"

echo "== Monitoring"
# Internal endpoints, queried from a throwaway container on the monitoring network.
incurl() { docker run --rm --network marketplace_monitoring curlimages/curl:8.15.0 -sf --max-time 10 "$@"; }
for i in $(seq 1 36); do
  targets="$(incurl http://prometheus:9090/api/v1/targets || echo '{}')"
  down="$(jq -r '[.data.activeTargets[]? | select(.health != "up" and .labels.job != "blackbox") | "\(.labels.job) \(.lastError)"] | join("; ")' <<<"$targets")"
  up="$(jq '[.data.activeTargets[]? | select(.health == "up")] | length' <<<"$targets")"
  jobs="$(jq -r '[.data.activeTargets[]? | select(.health == "up") | .labels.job] | unique | join(",")' <<<"$targets")"
  [ -z "$down" ] && [ "${up:-0}" -ge 9 ] && break
  sleep 5
done
[ -z "$down" ] || fail "Prometheus targets down: $down"
pass "Prometheus targets up ($up): $jobs"
rules="$(incurl http://prometheus:9090/api/v1/rules | jq '[.data.groups[].rules[]] | length')"
[ "$rules" -ge 25 ] || fail "only $rules alert rules loaded"
pass "$rules alert rules loaded"
incurl 'http://prometheus:9090/api/v1/query?query=marketplace_backlog' | jq -e '.data.result | map(.metric.kind) | index("payments_failed_15m")' >/dev/null || fail "worker backlog metrics missing"
incurl 'http://prometheus:9090/api/v1/query?query=http_request_duration_seconds_count' | jq -e '.data.result | length > 0' >/dev/null || fail "API request metrics missing"
incurl 'http://prometheus:9090/api/v1/query?query=marketplace_queue_jobs' | jq -e '.data.result | length > 0' >/dev/null || fail "queue metrics missing"
pass "application metrics (requests, queues, payment and backlog gauges) present"
incurl http://alertmanager:9093/-/ready >/dev/null || fail "Alertmanager not ready"
incurl http://grafana:3000/api/health | jq -e '.database == "ok"' >/dev/null || fail "Grafana not healthy"
incurl http://loki:3100/ready >/dev/null || fail "Loki not ready"
pass "Alertmanager, Grafana and Loki ready"
for i in $(seq 1 24); do
  n="$(incurl -G http://loki:3100/loki/api/v1/query_range --data-urlencode 'query={service="api"}' --data-urlencode limit=5 | jq '[.data.result[].values[]] | length' || echo 0)"
  [ "${n:-0}" -gt 0 ] && break
  sleep 5
done
[ "${n:-0}" -gt 0 ] || fail "no API logs in Loki"
pass "container logs reach Loki"
echo "Smoke test passed."
