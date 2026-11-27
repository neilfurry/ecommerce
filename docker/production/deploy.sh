#!/usr/bin/env bash
# Deploys a release on the production server (Linux, bash). Run from this directory:
#
#   ./deploy.sh v1.2.0        deploy that image tag
#   ./deploy.sh --rollback    go back to the previously deployed tag (application only)
#
# Steps: pull images → backup (before any migration) → migrate → roll out API, worker and
# edge → health check. If the new release does not become healthy, the
# previous images are started again. Database migrations are forward-only: a migration that
# must be undone is reverted by a new migration or by a point-in-time restore
# (docs/production/BACKUP_AND_RECOVERY.md, "Migration rollback").
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
STATE=.deployed-tags
DC=(docker compose --env-file "$ENV_FILE")

current_tag() { sed -n 's/^IMAGE_TAG=//p' "$ENV_FILE"; }
set_tag() { sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" "$ENV_FILE"; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
healthy() {
  local url
  url="https://$(sed -n 's/^API_DOMAIN=//p' "$ENV_FILE")/api/v1/health"
  for _ in $(seq 1 40); do
    if curl -fsS --max-time 5 "$url" | grep -q '"status":"ok"'; then return 0; fi
    sleep 3
  done
  return 1
}
rollout() {
  "${DC[@]}" pull api worker edge
  # While API containers restart, the edge holds requests (lb_try_duration) until a healthy
  # replica answers, so a deploy shows up as a short delay rather than errors.
  "${DC[@]}" up -d --no-deps --wait --wait-timeout 120 api
  "${DC[@]}" up -d --no-deps worker
  "${DC[@]}" up -d --no-deps --wait --wait-timeout 60 edge
}

[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing" >&2; exit 1; }
previous="$(current_tag)"

if [ "${1:-}" = "--rollback" ]; then
  target="$(tail -2 "$STATE" | head -1)"
  [ -n "$target" ] && [ "$target" != "$previous" ] || { echo "No earlier release recorded" >&2; exit 1; }
  log "Rolling back $previous -> $target"
  set_tag "$target"
  rollout
  healthy && { echo "$target" >> "$STATE"; log "Rolled back to $target"; exit 0; }
  log "Rollback is not healthy either; investigate (docker compose logs)"
  exit 1
fi

tag="${1:?usage: ./deploy.sh <image-tag> | --rollback}"
log "Deploying $tag (current: $previous)"
set_tag "$tag"
if ! "${DC[@]}" pull; then
  set_tag "$previous"
  echo "Images for $tag could not be pulled" >&2
  exit 1
fi

log "Backup before migrating"
"${DC[@]}" exec -T backup marketplace-backup incr

log "Migrations"
if ! "${DC[@]}" run --rm migrate; then
  set_tag "$previous"
  log "Migration failed; the application was not changed. See BACKUP_AND_RECOVERY.md (Migration rollback) before retrying."
  exit 1
fi

log "Rolling out"
rollout
if healthy; then
  echo "$tag" >> "$STATE"
  "${DC[@]}" up -d
  log "Deployed $tag"
else
  log "Release $tag is not healthy; rolling back the application to $previous"
  set_tag "$previous"
  rollout
  healthy && log "Back on $previous. Migrations of $tag stay applied (they are backward compatible by rule; see DEPLOYMENT_GUIDE.md)." || log "Previous release unhealthy too"
  exit 1
fi
