#!/usr/bin/env bash
# Writes a complete .env.production for the CI stack from .env.production.example: random
# secrets, *.marketplace.test domains with self-signed TLS, MinIO for uploads and backups,
# Mailpit for email. Proves the template is complete: every CHANGE_ME must be replaced here.
set -euo pipefail
cd "$(dirname "$0")/.."
rnd() { openssl rand -hex 32; }
PG_PASSWORD="$(rnd)"
REDIS_PASSWORD="$(rnd)"
S3_SECRET="$(rnd)"
BACKUP_SECRET="$(rnd)"
declare -A V=(
  [IMAGE_REGISTRY]=local
  [IMAGE_TAG]=ci
  [STOREFRONT_DOMAIN]=shop.marketplace.test
  [SELLER_DOMAIN]=seller.marketplace.test
  [ADMIN_DOMAIN]=admin.marketplace.test
  [API_DOMAIN]=api.marketplace.test
  [GRAFANA_DOMAIN]=grafana.marketplace.test
  [ACME_EMAIL]=ops@marketplace.test
  [TLS_MODE]=internal
  [ASSET_ORIGINS]=
  [STOREFRONT_URL]=https://shop.marketplace.test
  [SELLER_PORTAL_URL]=https://seller.marketplace.test
  [ADMIN_PORTAL_URL]=https://admin.marketplace.test
  [API_PUBLIC_URL]=https://api.marketplace.test
  [AUTH_JWT_SECRET]="$(rnd)"
  [AUTH_OTP_SECRET]="$(rnd)"
  [AUTH_MFA_ENCRYPTION_KEY]="$(rnd)"
  [FINANCE_ENCRYPTION_KEY]="$(rnd)"
  [POSTGRES_PASSWORD]="$PG_PASSWORD"
  [DATABASE_URL]="postgresql://marketplace:${PG_PASSWORD}@postgres:5432/marketplace?schema=public&connection_limit=20"
  [REDIS_PASSWORD]="$REDIS_PASSWORD"
  [REDIS_URL]="redis://:${REDIS_PASSWORD}@redis:6379"
  [S3_ENDPOINT]=http://minio:9000
  [S3_PUBLIC_ENDPOINT]=http://minio:9000
  [S3_REGION]=us-east-1
  [S3_ACCESS_KEY_ID]=ciuploads
  [S3_SECRET_ACCESS_KEY]="$S3_SECRET"
  [S3_BUCKET]=marketplace-uploads
  [S3_FORCE_PATH_STYLE]=true
  [MINIO_ROOT_USER]=ciuploads
  [MINIO_ROOT_PASSWORD]="$S3_SECRET"
  [SMTP_HOST]=mailpit
  [SMTP_PORT]=1025
  [SMTP_USER]=
  [SMTP_PASSWORD]=
  [MAIL_FROM]='"Marketplace CI <no-reply@marketplace.test>"'
  [SEMAPHORE_API_KEY]=ci-placeholder-not-used
  [PAYMONGO_SECRET_KEY]=sk_live_ci_placeholder_never_called
  [PAYMONGO_WEBHOOK_SECRET]=whsk_ci_placeholder
  [BACKUP_S3_ENDPOINT]=minio-backup
  [BACKUP_S3_PORT]=9000
  [BACKUP_S3_REGION]=us-east-1
  [BACKUP_S3_BUCKET]=marketplace-db-backups
  [BACKUP_S3_ACCESS_KEY_ID]=cibackups
  [BACKUP_S3_SECRET_ACCESS_KEY]="$BACKUP_SECRET"
  [BACKUP_S3_URI_STYLE]=path
  [BACKUP_S3_VERIFY_TLS]=n
  [BACKUP_ENCRYPTION_PASSPHRASE]="$(rnd)"
  [OBJECT_BACKUP_ENDPOINT]=https://minio-backup:9000
  [OBJECT_BACKUP_BUCKET]=marketplace-uploads-backup
  [OBJECT_BACKUP_ACCESS_KEY_ID]=cibackups
  [OBJECT_BACKUP_SECRET_ACCESS_KEY]=unused
  [GF_SECURITY_ADMIN_PASSWORD]="$(rnd)"
  [ALERT_SMTP_HOST]=mailpit:1025
  [ALERT_SMTP_USER]=
  [ALERT_SMTP_PASSWORD]=
  [ALERT_EMAIL_FROM]=alerts@marketplace.test
  [ALERT_EMAIL_TEAM]=team@marketplace.test
  [ALERT_EMAIL_ONCALL]=oncall@marketplace.test
)
out=""
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]]; then
    key="${BASH_REMATCH[1]}"
    if [[ -v V[$key] ]]; then line="${key}=${V[$key]}"; fi
  fi
  out+="$line"$'\n'
done < .env.production.example
out+="BACKUP_MINIO_ROOT_USER=cibackups"$'\n'
out+="BACKUP_MINIO_ROOT_PASSWORD=${BACKUP_SECRET}"$'\n'
if printf '%s' "$out" | grep -E '^[A-Z_]+=.*CHANGE_ME' ; then
  echo "make-env.sh: the values above are still CHANGE_ME" >&2
  exit 1
fi
printf '%s' "$out"
