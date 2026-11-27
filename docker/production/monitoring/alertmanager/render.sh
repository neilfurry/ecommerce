#!/bin/sh
# Alertmanager has no environment substitution, so the config is rendered at start.
set -eu
: "${ALERT_SMTP_HOST:?}" "${ALERT_EMAIL_FROM:?}" "${ALERT_EMAIL_TEAM:?}" "${ALERT_EMAIL_ONCALL:?}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
out=/tmp/alertmanager.yml
sed \
  -e "s|\${ALERT_SMTP_HOST}|${ALERT_SMTP_HOST}|g" \
  -e "s|\${ALERT_EMAIL_FROM}|${ALERT_EMAIL_FROM}|g" \
  -e "s|\${ALERT_SMTP_USER}|${ALERT_SMTP_USER:-}|g" \
  -e "s|\${ALERT_SMTP_PASSWORD}|${ALERT_SMTP_PASSWORD:-}|g" \
  -e "s|\${ALERT_EMAIL_TEAM}|${ALERT_EMAIL_TEAM}|g" \
  -e "s|\${ALERT_EMAIL_ONCALL}|${ALERT_EMAIL_ONCALL}|g" \
  -e "s|\${ALERT_WEBHOOK_URL}|${ALERT_WEBHOOK_URL}|g" \
  /etc/alertmanager/alertmanager.yml.template > "$out"
if [ -z "$ALERT_WEBHOOK_URL" ]; then
  # Drop the webhook receiver entry when no URL is configured.
  sed -i '/webhook_configs:/,/send_resolved: true/d' "$out"
fi
exec /bin/alertmanager --config.file="$out" --storage.path=/alertmanager
