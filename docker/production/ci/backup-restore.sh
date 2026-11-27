#!/usr/bin/env bash
# Proves the database backups can be restored (CI, against the running production stack):
#   1. full pgBackRest backup to the encrypted S3 repository;
#   2. new data written AFTER the backup, its WAL archived;
#   3. the database volume destroyed;
#   4. restore from the repository (backup + archived WAL) into a new, empty volume;
#   5. every table's row count, a checksum of key tables and the post-backup row match,
#      the repository verifies, and the application is healthy again.
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose -f compose.yml -f compose.ci.yml --env-file .env.production --profile storage)
psqlc() { "${DC[@]}" exec -T postgres psql -U marketplace -d marketplace -v ON_ERROR_STOP=1 -Atc "$1"; }
step() { printf '\n== %s\n' "$*"; }

snapshot() {
  # Exact row count of every application table, and a checksum of the money and stock tables.
  psqlc "SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
           SELECT c.relname AS t,
                  (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', c.relname), false, true, '')))[1]::text AS n
             FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relkind = 'r') x"
  psqlc "SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) FROM (
           SELECT id::text, status::text, amount::text FROM payments UNION ALL
           SELECT id::text, status::text, debit::text || '/' || credit::text FROM journal_entries UNION ALL
           SELECT id::text, quantity_on_hand::text, reserved_quantity::text FROM stock_levels) x"
}

step "Full backup (encrypted with aes-256-cbc) to the backup bucket"
"${DC[@]}" exec -T backup marketplace-backup full
"${DC[@]}" exec -T backup marketplace-backup info

step "Writing data after the backup (must come back through WAL replay)"
# No other writers from here on, so the snapshot below is the final state.
"${DC[@]}" stop api worker
psqlc "CREATE TABLE IF NOT EXISTS restore_probe (id serial PRIMARY KEY, note text, at timestamptz DEFAULT now())"
psqlc "INSERT INTO restore_probe (note) VALUES ('written after the full backup')"
wal="$(psqlc "SELECT pg_walfile_name(pg_switch_wal())")"
for i in $(seq 1 60); do
  archived="$(psqlc "SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver")"
  [[ "$archived" > "$wal" || "$archived" == "$wal" ]] && break
  sleep 2
done
echo "WAL $wal archived (last archived: $archived)"
before="$(snapshot)"
echo "Before: $(head -c 300 <<<"$before")…"

step "Destroying the database"
"${DC[@]}" stop backup postgres
docker volume rm marketplace_postgres-data
echo "Volume removed."

step "Restoring from the repository into an empty volume"
"${DC[@]}" run --rm --no-deps --user postgres --entrypoint marketplace-restore backup
"${DC[@]}" up -d postgres
for i in $(seq 1 60); do
  "${DC[@]}" exec -T postgres pg_isready -U marketplace -d marketplace >/dev/null 2>&1 && \
    [ "$(psqlc 'SELECT pg_is_in_recovery()' 2>/dev/null)" = f ] && break
  sleep 2
done

step "Comparing"
after="$(snapshot)"
if [ "$before" != "$after" ]; then
  diff <(tr ' ' '\n' <<<"$before") <(tr ' ' '\n' <<<"$after") || true
  echo "Restored data differs from the data before the loss" >&2
  exit 1
fi
probe="$(psqlc "SELECT note FROM restore_probe ORDER BY id DESC LIMIT 1")"
[ "$probe" = "written after the full backup" ] || { echo "post-backup row missing: '$probe'" >&2; exit 1; }
echo "All $(wc -w <<<"$(head -1 <<<"$after")") tables identical; checksum identical; post-backup row restored."
psqlc "DROP TABLE restore_probe"

step "Restarting the application on the restored database"
"${DC[@]}" up -d postgres backup api worker
for i in $(seq 1 40); do
  status="$(curl -sk https://api.marketplace.test/api/v1/health | jq -r .status 2>/dev/null || true)"
  [ "$status" = ok ] && break
  sleep 3
done
[ "$status" = ok ] || { echo "API not healthy after restore: $status" >&2; exit 1; }
"${DC[@]}" exec -T backup marketplace-backup verify
echo "Backup restored and verified."
