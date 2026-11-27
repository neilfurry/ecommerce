#!/usr/bin/env bash
# pgBackRest backups of the marketplace database (runs in the "backup" service, which shares
# the data directory and socket with the "postgres" service).
#
#   marketplace-backup full|diff|incr   one backup now
#   marketplace-backup schedule         daily differential, weekly full (BACKUP_HOUR_UTC,
#                                       BACKUP_FULL_WEEKDAY), forever
#   marketplace-backup info             what the repository holds
#   marketplace-backup verify           check the archive and every backup's checksums
#
# Each run writes Prometheus metrics to $BACKUP_METRICS_DIR/backup.prom (read by node-exporter's
# textfile collector), so alerts fire when a backup fails or is overdue.
set -euo pipefail
STANZA=main
METRICS_DIR="${BACKUP_METRICS_DIR:-/metrics}"

render-pgbackrest

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

write_metrics() {
  local type="$1" ok="$2" started="$3" finished
  finished="$(date +%s)"
  mkdir -p "$METRICS_DIR"
  local file="$METRICS_DIR/backup.prom" tmp
  tmp="$(mktemp "$METRICS_DIR/.backup.XXXXXX")"
  # Keep the other backup types' last values.
  if [ -f "$file" ]; then grep -v "type=\"$type\"" "$file" | grep -v '^# ' > "$tmp" || true; fi
  {
    echo "marketplace_backup_last_run_timestamp_seconds{type=\"$type\"} $finished"
    echo "marketplace_backup_last_status{type=\"$type\"} $ok"
    echo "marketplace_backup_last_duration_seconds{type=\"$type\"} $((finished - started))"
    if [ "$ok" = 1 ]; then echo "marketplace_backup_last_success_timestamp_seconds{type=\"$type\"} $finished"; fi
  } >> "$tmp"
  local size
  size="$(pgbackrest --stanza=$STANZA info --output=json 2>/dev/null \
    | sed -n 's/.*"repo":{"delta":[0-9]*,"size":\([0-9]*\).*/\1/p' | tail -1 || true)"
  if [ -n "$size" ]; then
    grep -v '^marketplace_backup_repository_last_size_bytes' "$tmp" > "$tmp.2" || true
    mv "$tmp.2" "$tmp"
    echo "marketplace_backup_repository_last_size_bytes $size" >> "$tmp"
  fi
  sort -u "$tmp" > "$file.new" && mv "$file.new" "$file" && rm -f "$tmp"
}

ensure_stanza() {
  # Idempotent: succeeds when the stanza already exists and matches this cluster. Its
  # output stays visible (pgBackRest logs errors to stdout), and the marker that turns on
  # WAL archiving is only written once it has succeeded. ("set -e" does not apply inside
  # an "if" condition, so every step is checked explicitly.)
  pgbackrest --stanza=$STANZA --log-level-console=warn stanza-create || return 1
  # From now on PostgreSQL archives WAL (archive_command in postgresql.conf).
  touch "${PGDATA:-/var/lib/postgresql/data}/.pgbackrest-stanza" || return 1
}

run_backup() {
  local type="$1" started
  started="$(date +%s)"
  log "Starting $type backup"
  if ensure_stanza && pgbackrest --stanza=$STANZA --type="$type" backup; then
    write_metrics "$type" 1 "$started"
    log "$type backup finished"
  else
    write_metrics "$type" 0 "$started"
    log "$type backup FAILED"
    return 1
  fi
}

schedule() {
  local hour="${BACKUP_HOUR_UTC:-17}" full_day="${BACKUP_FULL_WEEKDAY:-7}"
  log "Backups daily at ${hour}:00 UTC; full on ISO weekday ${full_day}, differential otherwise"
  # A first full backup right away, so a new server is protected from the start.
  if ! pgbackrest --stanza=$STANZA info --output=json 2>/dev/null | grep -q '"label"'; then
    run_backup full || true
  fi
  while true; do
    local now next
    now="$(date -u +%s)"
    next="$(date -u -d "today ${hour}:00" +%s)"
    [ "$next" -le "$now" ] && next="$(date -u -d "tomorrow ${hour}:00" +%s)"
    sleep $((next - now))
    if [ "$(date -u +%u)" = "$full_day" ]; then run_backup full || true; else run_backup diff || true; fi
  done
}

case "${1:-}" in
  full | diff | incr) run_backup "$1" ;;
  schedule) schedule ;;
  info) pgbackrest --stanza=$STANZA info ;;
  verify) pgbackrest --stanza=$STANZA check && pgbackrest --stanza=$STANZA verify ;;
  *) echo "usage: marketplace-backup full|diff|incr|schedule|info|verify" >&2; exit 2 ;;
esac
