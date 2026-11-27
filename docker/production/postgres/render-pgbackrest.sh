#!/usr/bin/env bash
# Writes /etc/pgbackrest/pgbackrest.conf from the template and the environment.
set -euo pipefail
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?}" "${BACKUP_ENCRYPTION_PASSPHRASE:?}"
export BACKUP_S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
export BACKUP_S3_PORT="${BACKUP_S3_PORT:-443}"
export BACKUP_S3_URI_STYLE="${BACKUP_S3_URI_STYLE:-host}"
export BACKUP_S3_VERIFY_TLS="${BACKUP_S3_VERIFY_TLS:-y}"
export BACKUP_STANZA_PATH="${BACKUP_STANZA_PATH:-marketplace}"
export POSTGRES_USER="${POSTGRES_USER:-postgres}"
export POSTGRES_DB="${POSTGRES_DB:-$POSTGRES_USER}"
export BACKUP_RETENTION_FULL="${BACKUP_RETENTION_FULL:-4}"
export BACKUP_RETENTION_DIFF="${BACKUP_RETENTION_DIFF:-7}"
if [ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -lt 32 ]; then
  echo "BACKUP_ENCRYPTION_PASSPHRASE must be at least 32 characters" >&2
  exit 1
fi
umask 077
envsubst < /etc/pgbackrest/pgbackrest.conf.template > /etc/pgbackrest/pgbackrest.conf
chown postgres:postgres /etc/pgbackrest/pgbackrest.conf 2>/dev/null || true
chmod 600 /etc/pgbackrest/pgbackrest.conf
