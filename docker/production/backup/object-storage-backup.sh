#!/bin/sh
# Nightly copy of the uploads bucket (product photos, documents, payment proofs) to a backup
# bucket at another provider or region. Files are only ever added or updated there; anything
# deleted or changed in the source is moved to deleted/<date>/ first, and that folder is
# pruned after OBJECT_BACKUP_RETENTION_DAYS. Turn on versioning on the backup bucket as well.
#
# Remotes come from the environment (rclone's RCLONE_CONFIG_<NAME>_* convention):
#   source: the application bucket (S3_* settings);  dest: OBJECT_BACKUP_* settings.
set -eu
export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER="${S3_PROVIDER:-Other}" \
  RCLONE_CONFIG_SRC_ENDPOINT="${S3_ENDPOINT:-}" RCLONE_CONFIG_SRC_REGION="${S3_REGION:-us-east-1}" \
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}"
export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER="${OBJECT_BACKUP_PROVIDER:-Other}" \
  RCLONE_CONFIG_DST_ENDPOINT="${OBJECT_BACKUP_ENDPOINT:-}" RCLONE_CONFIG_DST_REGION="${OBJECT_BACKUP_REGION:-us-east-1}" \
  RCLONE_CONFIG_DST_ACCESS_KEY_ID="${OBJECT_BACKUP_ACCESS_KEY_ID}" \
  RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="${OBJECT_BACKUP_SECRET_ACCESS_KEY}" \
  RCLONE_CONFIG_DST_SERVER_SIDE_ENCRYPTION="${OBJECT_BACKUP_SSE:-AES256}"
BUCKET="${OBJECT_BACKUP_BUCKET:?set OBJECT_BACKUP_BUCKET}"
HOUR="${OBJECT_BACKUP_HOUR_UTC:-18}"
KEEP="${OBJECT_BACKUP_RETENTION_DAYS:-90}"

metrics() {
  mkdir -p /metrics
  f=/metrics/backup-objects.prom
  {
    echo "marketplace_backup_last_run_timestamp_seconds{type=\"objects\"} $(date +%s)"
    echo "marketplace_backup_last_status{type=\"objects\"} $1"
    [ "$1" = 1 ] && echo "marketplace_backup_last_success_timestamp_seconds{type=\"objects\"} $(date +%s)"
  } > "$f.tmp" && mv "$f.tmp" "$f"
}

run() {
  day="$(date -u +%Y-%m-%d)"
  if rclone sync "src:${S3_BUCKET}" "dst:${BUCKET}/current" \
      --backup-dir "dst:${BUCKET}/deleted/${day}" --checksum --transfers 8 --log-level INFO \
    && rclone delete "dst:${BUCKET}/deleted" --min-age "${KEEP}d" --rmdirs; then
    metrics 1
  else
    metrics 0
  fi
}

[ "${1:-}" = "once" ] && { run; exit 0; }
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  run
done
