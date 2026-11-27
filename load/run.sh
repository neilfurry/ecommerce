#!/usr/bin/env bash
# Runs the load test against the production-image stack started by CI (see load/README.md):
# synthetic data, k6, resource sampling, then integrity checks and a database analysis.
# Results land in load/results/.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
PROD="$ROOT/docker/production"
DC=(docker compose -f "$PROD/compose.yml" -f "$PROD/compose.ci.yml" -f "$PROD/compose.loadtest.yml" --env-file "$PROD/.env.production" --profile storage)
mkdir -p results
psqlc() { "${DC[@]}" exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 "$@"; }

echo "== Synthetic data"
"${DC[@]}" run --rm -e LOAD_DATA_FILE=/repo/load/data.json \
  -e LOAD_SELLERS="${LOAD_SELLERS:-40}" -e LOAD_PRODUCTS_PER_SELLER="${LOAD_PRODUCTS_PER_SELLER:-125}" \
  -e LOAD_CUSTOMERS="${LOAD_CUSTOMERS:-60}" migrate \
  pnpm --filter @marketplace/database exec tsx --conditions=source load-test-data.ts
psqlc -Atc "ANALYZE"
psqlc -Atc "SELECT 'products', count(*) FROM products UNION ALL SELECT 'variants', count(*) FROM product_variants
            UNION ALL SELECT 'stock levels', count(*) FROM stock_levels UNION ALL SELECT 'users', count(*) FROM users
            UNION ALL SELECT 'sellers', count(*) FROM sellers" | tee results/dataset.txt

echo "== Resource sampling (every 5 s)"
since="$(date -u +%FT%TZ)"
psqlc -Atc "SELECT pg_stat_statements_reset()" >/dev/null
( while true; do
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.NetIO}},{{.BlockIO}}' \
      | sed "s/^/$(date -u +%T),/"
    sleep 5
  done ) > results/docker-stats.csv &
sampler=$!
trap 'kill $sampler 2>/dev/null || true' EXIT

echo "== k6"
set +e
k6 run --quiet \
  -e BASE_URL=https://shop.marketplace.test \
  -e DATA="$PWD/data.json" \
  -e RESULTS_DIR="$PWD/results" \
  -e MOCK_WEBHOOK_SECRET="${MOCK_WEBHOOK_SECRET:-ci-load-test-mock-webhook-secret}" \
  -e SCALE="${SCALE:-1}" \
  k6/marketplace.js
k6_status=$?
set -e
kill $sampler 2>/dev/null || true
# Let the worker drain what the test queued before measuring background processing.
sleep 30

echo "== Peak resource use per container"
awk -F, 'function mib(v) { if (v ~ /GiB/) return v * 1024; if (v ~ /KiB/) return v / 1024; return v + 0 }
  { gsub("%", "", $3); split($4, m, " / "); c = $2; if ($3 + 0 > cpu[c]) cpu[c] = $3 + 0; if (mib(m[1]) > mem[c]) mem[c] = mib(m[1]) }
  END { printf "%-40s %10s %14s\n", "container", "peak CPU %", "peak mem MiB"; for (c in cpu) printf "%-40s %10.1f %14.0f\n", c, cpu[c], mem[c] }' \
  results/docker-stats.csv | sort | tee results/resources.txt

echo "== Integrity after the load"
psqlc -f /dev/stdin < verify.sql | tee results/integrity.txt
echo "== Database analysis"
psqlc -v since="$since" -f /dev/stdin < analysis.sql | tee results/database.txt
echo "== Worker metrics"
docker run --rm --network marketplace_app curlimages/curl:8.15.0 -sf http://worker:9464/metrics \
  | grep -E '^marketplace_(job_duration_seconds_(count|sum)|job_failures_total|queue_jobs)' | tee results/worker-metrics.txt || true

if grep -q '| f$' results/integrity.txt; then
  echo "Integrity check failed" >&2
  exit 1
fi
exit $k6_status
