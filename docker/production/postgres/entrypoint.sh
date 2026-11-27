#!/usr/bin/env bash
# Renders the pgBackRest configuration on every start (it holds credentials, so it is never
# baked into the image), then hands over to the official PostgreSQL entrypoint.
set -euo pipefail
render-pgbackrest
exec docker-entrypoint.sh "$@"
